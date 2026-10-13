#!/usr/bin/env node
/**
 * Measure the Java pack over the drift corpus.
 *
 *   node packages/sourcevision/scripts/java-corpus-report.mjs [--json]
 *
 * Reads ~/.cache/ndx-java-corpus/ (override with NDX_JAVA_CORPUS_DIR) and,
 * per repository, prints the `.java` file count, the share parsed without
 * ERROR or MISSING nodes, and capture counts per query. Exits 1 when a
 * repository is below gate G1 (98% clean), 2 when the corpus, the build or the
 * grammar is missing. Never touches the network; clone with
 * java-corpus-clone.mjs. Not part of the test run.
 *
 * Needs `pnpm --filter @n-dx/sourcevision build` and `build-grammars.mjs`.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";

import { grammarWasmPath } from "../../lang-runtime/scripts/build-grammars.mjs";
import { CLONE_COMMAND, CORPUS_DIR_ENV, checkedOutSha, corpusDir, loadCorpus } from "./java-corpus.mjs";

/** Gate G1: share of files that must parse without ERROR or MISSING nodes. */
const G1_CLEAN_SHARE = 0.98;
/** Large enough that no corpus file is skipped: the gate measures the grammar, not the size limit. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules"]);

function* walkJava(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkJava(join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith(".java")) {
      yield join(dir, entry.name);
    }
  }
}

const json = process.argv.includes("--json");
const root = corpusDir();
const corpus = loadCorpus();

const missing = corpus.filter((repo) => checkedOutSha(join(root, repo.name)) === undefined);
if (missing.length > 0) {
  console.error(`Corpus incomplete in ${root} (${CORPUS_DIR_ENV} overrides). Missing: ${missing.map((r) => r.name).join(", ")}`);
  console.error(`Clone it with: ${CLONE_COMMAND}`);
  process.exit(2);
}

const wasm = grammarWasmPath("tree-sitter-java");
if (!existsSync(wasm)) {
  console.error(`${wasm} is not built — run \`node packages/lang-runtime/scripts/build-grammars.mjs\``);
  process.exit(2);
}
const distPack = new URL("../dist/language/java-pack.js", import.meta.url);
if (!existsSync(distPack)) {
  console.error("sourcevision is not built — run `pnpm --filter @n-dx/sourcevision build`");
  process.exit(2);
}
const runtimeDist = new URL("../../lang-runtime/dist/index.js", import.meta.url);
if (!existsSync(runtimeDist)) {
  console.error("lang-runtime is not built — run `pnpm --filter @n-dx/lang-runtime build`");
  process.exit(2);
}
const { createTreeSitterRunner } = await import(runtimeDist.href);
const { javaPack } = await import(new URL("../dist/language/java-pack.js", import.meta.url).href);

const runner = createTreeSitterRunner({ maxFileBytes: MAX_FILE_BYTES });
const target = { pack: javaPack, grammarPath: wasm };
const results = [];

try {
  for (const repo of corpus) {
    const dir = join(root, repo.name);
    const captures = Object.fromEntries(javaPack.queries.map((q) => [q.name, 0]));
    const failing = [];
    let files = 0;
    let clean = 0;
    let skipped = 0;
    const start = performance.now();
    for (const file of walkJava(dir)) {
      files++;
      const result = await runner.parseFile(target, file);
      if (result.status === "skipped") {
        skipped++;
        continue;
      }
      if (result.hasErrorNodes || result.hasMissingNodes) {
        failing.push({ file: relative(dir, file), error: result.hasErrorNodes, missing: result.hasMissingNodes });
      } else {
        clean++;
      }
      for (const [name, found] of Object.entries(result.captures)) captures[name] += found.length;
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
      failing,
    });
  }
} finally {
  runner.dispose();
}

const failedGate = results.filter((r) => r.cleanShare < G1_CLEAN_SHARE);

if (json) {
  console.log(JSON.stringify({ corpusDir: root, results }, null, 2));
} else {
  console.log(`corpus: ${root}`);
  for (const r of results) {
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${drift}`);
    console.log(`  .java files: ${r.files}`);
    console.log(`  clean parse: ${r.clean}/${r.files} = ${(r.cleanShare * 100).toFixed(2)}%  (skipped oversized: ${r.skipped})`);
    console.log(`  parse time:  ${r.seconds.toFixed(1)} s`);
    console.log(`  captures:    ${Object.entries(r.captures).map(([n, c]) => `${n}=${c}`).join(" ")}`);
    for (const f of r.failing.slice(0, 20)) {
      console.log(`  not clean:   ${f.file} (${[f.error && "ERROR", f.missing && "MISSING"].filter(Boolean).join("+")})`);
    }
    if (r.failing.length > 20) console.log(`  ... and ${r.failing.length - 20} more`);
  }
  const verdict = failedGate.length === 0 ? "met" : `NOT met by ${failedGate.map((r) => r.name).join(", ")}`;
  console.log(`\nG1 (>= ${G1_CLEAN_SHARE * 100}% clean): ${verdict}`);
}
process.exit(failedGate.length === 0 ? 0 : 1);
