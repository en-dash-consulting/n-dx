#!/usr/bin/env node
/**
 * Measure the Python pack over the drift corpus.
 *
 *   node packages/sourcevision/scripts/python-corpus-report.mjs [--json]
 *
 * Reads ~/.cache/ndx-python-corpus/ (override with NDX_PYTHON_CORPUS_DIR)
 * and, per repository, prints the `.py`/`.pyi` file count, the share parsed
 * without ERROR or MISSING nodes, capture counts per query, the imports as
 * written (with how many are TYPE_CHECKING or ImportError guarded), the
 * dynamic imports the pack counts in its notices, and the parse time.
 * Directories the Python inventory skips (virtualenvs, caches, build output)
 * are skipped here too. Exits 1 when a repository is below the 99.5% clean
 * gate, 2 when the corpus, the build or the grammar is missing. Never touches
 * the network; clone with python-corpus-clone.mjs. Not part of the test run.
 *
 * Needs `pnpm --filter @n-dx/lang-python build` and `pnpm --filter
 * @n-dx/lang-python build:grammars`; the pack is imported from the workspace.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { performance } from "node:perf_hooks";

import { CLONE_COMMAND, CORPUS_DIR_ENV, checkedOutSha, corpusDir, loadCorpus } from "./python-corpus.mjs";
import { importWorkspacePack } from "./workspace-pack.mjs";

/** Share of files that must parse without ERROR or MISSING nodes. */
const CLEAN_GATE = 0.995;
/** Large enough that no corpus file is skipped: the gate measures the grammar, not the size limit. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

const json = process.argv.includes("--json");
const root = corpusDir();
const corpus = loadCorpus();

const missing = corpus.filter((repo) => checkedOutSha(join(root, repo.name)) === undefined);
if (missing.length > 0) {
  console.error(`Corpus incomplete in ${root} (${CORPUS_DIR_ENV} overrides). Missing: ${missing.map((r) => r.name).join(", ")}`);
  console.error(`Clone it with: ${CLONE_COMMAND}`);
  process.exit(2);
}

const { pythonConfig } = await importWorkspacePack("@n-dx/lang-kit");
const { dynamicImportsNotice, findDynamicImports, pythonGrammarPath, pythonPack, readWrittenImports } =
  await importWorkspacePack("@n-dx/lang-python");
const wasm = pythonGrammarPath();
if (!existsSync(wasm)) {
  console.error(`${wasm} is not built — run \`pnpm --filter @n-dx/lang-python build:grammars\``);
  process.exit(2);
}
const runtimeDist = new URL("../../lang-runtime/dist/index.js", import.meta.url);
if (!existsSync(runtimeDist)) {
  console.error("lang-runtime is not built — run `pnpm --filter @n-dx/lang-runtime build`");
  process.exit(2);
}
const { createTreeSitterRunner } = await import(runtimeDist.href);

const SKIP_DIRS = new Set([".git", "node_modules", ...pythonConfig.skipDirectories]);

function* walkPython(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkPython(join(dir, entry.name));
    } else if (entry.isFile() && [...pythonConfig.extensions].some((ext) => entry.name.endsWith(ext))) {
      yield join(dir, entry.name);
    }
  }
}

const runner = createTreeSitterRunner({ maxFileBytes: MAX_FILE_BYTES });
const target = { pack: pythonPack, grammarPath: wasm };
const results = [];

try {
  for (const repo of corpus) {
    const dir = join(root, repo.name);
    const captures = Object.fromEntries(pythonPack.queries.map((q) => [q.name, 0]));
    const imports = { written: 0, typeChecking: 0, optional: 0 };
    const dynamic = [];
    const failing = [];
    let files = 0;
    let clean = 0;
    let skipped = 0;
    const start = performance.now();
    for (const file of walkPython(dir)) {
      files++;
      const result = await runner.parseFile(target, file);
      if (result.status === "skipped") {
        skipped++;
        continue;
      }
      const path = relative(dir, file).split(sep).join("/");
      if (result.hasErrorNodes || result.hasMissingNodes) {
        failing.push({ file: path, error: result.hasErrorNodes, missing: result.hasMissingNodes });
      } else {
        clean++;
      }
      for (const [name, found] of Object.entries(result.captures)) captures[name] += found.length;
      const parsed = { path, captures: result.captures };
      for (const w of readWrittenImports(parsed)) {
        imports.written++;
        if (w.guard === "type-checking") imports.typeChecking++;
        if (w.guard === "optional") imports.optional++;
      }
      dynamic.push(...findDynamicImports(parsed));
    }
    results.push({
      name: repo.name,
      sha: checkedOutSha(dir),
      pinnedSha: repo.sha,
      files,
      clean,
      skipped,
      cleanShare: files === 0 ? 0 : clean / files,
      seconds: (performance.now() - start) / 1000,
      captures,
      imports,
      dynamicImports: dynamic.length,
      notice: dynamicImportsNotice(dynamic),
      failing,
    });
  }
} finally {
  runner.dispose();
}

const failedGate = results.filter((r) => r.cleanShare < CLEAN_GATE);

if (json) {
  console.log(JSON.stringify({ corpusDir: root, results }, null, 2));
} else {
  console.log(`corpus: ${root}`);
  for (const r of results) {
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${drift}`);
    console.log(`  .py/.pyi files: ${r.files}`);
    console.log(`  clean parse:    ${r.clean}/${r.files} = ${(r.cleanShare * 100).toFixed(2)}%  (skipped oversized: ${r.skipped})`);
    console.log(`  parse time:     ${r.seconds.toFixed(1)} s`);
    console.log(`  captures:       ${Object.entries(r.captures).map(([n, c]) => `${n}=${c}`).join(" ")}`);
    console.log(`  imports:        ${r.imports.written} written, ${r.imports.typeChecking} TYPE_CHECKING, ${r.imports.optional} ImportError-guarded`);
    console.log(`  notices:        ${r.notice ?? "none"}`);
    for (const f of r.failing.slice(0, 20)) {
      console.log(`  not clean:      ${f.file} (${[f.error && "ERROR", f.missing && "MISSING"].filter(Boolean).join("+")})`);
    }
    if (r.failing.length > 20) console.log(`  ... and ${r.failing.length - 20} more`);
  }
  const verdict = failedGate.length === 0 ? "met" : `NOT met by ${failedGate.map((r) => r.name).join(", ")}`;
  console.log(`\nclean-parse gate (>= ${CLEAN_GATE * 100}%): ${verdict}`);
}
process.exit(failedGate.length === 0 ? 0 : 1);
