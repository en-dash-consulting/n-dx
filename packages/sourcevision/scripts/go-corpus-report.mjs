#!/usr/bin/env node
/**
 * Measure the Go pack over the drift corpus.
 *
 *   node packages/sourcevision/scripts/go-corpus-report.mjs [--json]
 *
 * Reads ~/.cache/ndx-go-corpus/ (override with NDX_GO_CORPUS_DIR) and, per
 * repository, prints the `.go` file count, the share parsed without ERROR or
 * MISSING nodes, capture counts per query, and import parity: for each file,
 * the import paths the pack's `imports` query captured against those the
 * regex parser (`analyzers/go-imports.ts`) extracted. Files that differ are
 * listed with the paths and a reason. Then edge parity: the imports phase run
 * twice over the repository, once through the pack and once through the regex
 * fallback (no grammar), with the edges and (importer, external package)
 * pairs only one side produced. Exits 1 when a repository is below the
 * clean-parse gate (98%), 2 when the corpus, the build or the grammar is
 * missing. Never touches the network; clone with go-corpus-clone.mjs. Not
 * part of the test run.
 *
 * Needs `pnpm --filter @n-dx/sourcevision build` and `build-grammars.mjs`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";

import { grammarWasmPath } from "./build-grammars.mjs";
import { CLONE_COMMAND, CORPUS_DIR_ENV, checkedOutSha, corpusDir, loadCorpus } from "./go-corpus.mjs";

/** Share of files that must parse without ERROR or MISSING nodes. */
const CLEAN_SHARE_GATE = 0.98;
/** Large enough that no corpus file is skipped: the gate measures the grammar, not the size limit. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules"]);
const LISTED = 20;

function* walkGo(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkGo(join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith(".go")) {
      yield join(dir, entry.name);
    }
  }
}

/** Sorted copy, so duplicate imports in one file still have to match in count. */
const sorted = (paths) => [...paths].sort();

/** `a` minus `b` as multisets. */
function minus(a, b) {
  const rest = [...b];
  const out = [];
  for (const p of a) {
    const i = rest.indexOf(p);
    if (i === -1) out.push(p);
    else rest.splice(i, 1);
  }
  return out;
}

/** Why the two parsers disagree on a file. */
function reason(parseClean, onlyPack, onlyRegex) {
  if (!parseClean) return "file does not parse cleanly";
  if (onlyPack.length > 0 && onlyRegex.length > 0) return "paths differ";
  if (onlyPack.length > 0) return "regex parser missed imports";
  return "pack missed imports";
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

const wasm = grammarWasmPath("tree-sitter-go");
if (!existsSync(wasm)) {
  console.error(`${wasm} is not built — run \`node packages/sourcevision/scripts/build-grammars.mjs\``);
  process.exit(2);
}
const distRunner = new URL("../dist/language/runner.js", import.meta.url);
if (!existsSync(distRunner)) {
  console.error("sourcevision is not built — run `pnpm --filter @n-dx/sourcevision build`");
  process.exit(2);
}
const { createTreeSitterRunner } = await import(distRunner.href);
const { goPack } = await import(new URL("../dist/language/go-pack.js", import.meta.url).href);
const { extractGoImports } = await import(new URL("../dist/analyzers/go-imports.js", import.meta.url).href);
const { analyzeInventory } = await import(new URL("../dist/analyzers/inventory.js", import.meta.url).href);
const { analyzeImports } = await import(new URL("../dist/analyzers/imports.js", import.meta.url).href);
const { goConfig } = await import(new URL("../dist/language/go.js", import.meta.url).href);

/** A grammar directory that does not exist, so the imports phase takes the regex fallback. */
const NO_GRAMMAR_DIR = join(tmpdir(), `ndx-go-corpus-no-grammar-${process.pid}`);

/** `a` minus `b` as sets. */
const setMinus = (a, b) => [...a].filter((k) => !b.has(k)).sort();

/** Imports-phase output through the pack and through the regex fallback, and what only one side has. */
async function edgeParity(dir) {
  const inventory = await analyzeInventory(dir, { languageConfig: goConfig });
  const notices = [];
  const pack = await analyzeImports(dir, inventory, { language: "go", packs: { warn: (m) => notices.push(m) } });
  const regex = await analyzeImports(dir, inventory, { language: "go", packs: { grammarDir: NO_GRAMMAR_DIR, warn: () => undefined } });
  const edges = (imports) => new Set(imports.edges.map((e) => `${e.from} -> ${e.to} [${[...e.symbols].sort().join(",")}]`));
  const pairs = (imports) => new Set(imports.external.flatMap((x) => x.importedBy.map((f) => `${f} -> ${x.package}`)));
  const [packEdges, regexEdges, packPairs, regexPairs] = [edges(pack), edges(regex), pairs(pack), pairs(regex)];
  return {
    notices,
    pack: { edges: packEdges.size, external: packPairs.size },
    regex: { edges: regexEdges.size, external: regexPairs.size },
    edgesOnlyPack: setMinus(packEdges, regexEdges),
    edgesOnlyRegex: setMinus(regexEdges, packEdges),
    externalOnlyPack: setMinus(packPairs, regexPairs),
    externalOnlyRegex: setMinus(regexPairs, packPairs),
  };
}

const runner = createTreeSitterRunner({ maxFileBytes: MAX_FILE_BYTES });
const target = { pack: goPack, grammarPath: wasm };
const results = [];

try {
  for (const repo of corpus) {
    const dir = join(root, repo.name);
    const captures = Object.fromEntries(goPack.queries.map((q) => [q.name, 0]));
    const failing = [];
    const differing = [];
    let files = 0;
    let clean = 0;
    let skipped = 0;
    let compared = 0;
    const start = performance.now();
    for (const file of walkGo(dir)) {
      files++;
      const rel = relative(dir, file);
      const result = await runner.parseFile(target, file);
      if (result.status === "skipped") {
        skipped++;
        continue;
      }
      const parseClean = !result.hasErrorNodes && !result.hasMissingNodes;
      if (parseClean) clean++;
      else failing.push({ file: rel, error: result.hasErrorNodes, missing: result.hasMissingNodes });
      for (const [name, found] of Object.entries(result.captures)) captures[name] += found.length;

      compared++;
      const pack = sorted((result.captures.imports ?? []).filter((c) => c.name === "import.name").map((c) => c.text));
      const regex = sorted(extractGoImports(readFileSync(file, "utf8"), rel, null).raw.map((i) => i.path));
      const onlyPack = minus(pack, regex);
      const onlyRegex = minus(regex, pack);
      if (onlyPack.length > 0 || onlyRegex.length > 0) {
        differing.push({ file: rel, reason: reason(parseClean, onlyPack, onlyRegex), onlyPack, onlyRegex });
      }
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
      compared,
      differing,
      edgeParity: await edgeParity(dir),
    });
  }
} finally {
  runner.dispose();
}

const failedGate = results.filter((r) => r.cleanShare < CLEAN_SHARE_GATE);

if (json) {
  console.log(JSON.stringify({ corpusDir: root, results }, null, 2));
} else {
  console.log(`corpus: ${root}`);
  for (const r of results) {
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${drift}`);
    console.log(`  .go files:   ${r.files}`);
    console.log(`  clean parse: ${r.clean}/${r.files} = ${(r.cleanShare * 100).toFixed(2)}%  (skipped oversized: ${r.skipped})`);
    console.log(`  parse time:  ${r.seconds.toFixed(1)} s`);
    console.log(`  captures:    ${Object.entries(r.captures).map(([n, c]) => `${n}=${c}`).join(" ")}`);
    console.log(`  import parity: ${r.compared - r.differing.length}/${r.compared} files identical, ${r.differing.length} differ`);
    for (const f of r.failing.slice(0, LISTED)) {
      console.log(`  not clean:   ${f.file} (${[f.error && "ERROR", f.missing && "MISSING"].filter(Boolean).join("+")})`);
    }
    if (r.failing.length > LISTED) console.log(`  ... and ${r.failing.length - LISTED} more not clean`);
    for (const d of r.differing.slice(0, LISTED)) {
      console.log(`  differs:     ${d.file} — ${d.reason}`);
      if (d.onlyPack.length > 0) console.log(`                 pack only:  ${d.onlyPack.join(", ")}`);
      if (d.onlyRegex.length > 0) console.log(`                 regex only: ${d.onlyRegex.join(", ")}`);
    }
    if (r.differing.length > LISTED) console.log(`  ... and ${r.differing.length - LISTED} more differ`);
    const p = r.edgeParity;
    console.log(`  edge parity: pack ${p.pack.edges} edges, ${p.pack.external} external pairs; regex ${p.regex.edges} edges, ${p.regex.external} external pairs`);
    for (const notice of p.notices) console.log(`    notice: ${notice}`);
    for (const [label, list] of [
      ["edges only from the pack", p.edgesOnlyPack],
      ["edges only from the regex parser", p.edgesOnlyRegex],
      ["external pairs only from the pack", p.externalOnlyPack],
      ["external pairs only from the regex parser", p.externalOnlyRegex],
    ]) {
      console.log(`    ${label}: ${list.length}`);
      for (const key of list.slice(0, LISTED)) console.log(`      ${key}`);
      if (list.length > LISTED) console.log(`      ... and ${list.length - LISTED} more`);
    }
  }
  const verdict = failedGate.length === 0 ? "met" : `NOT met by ${failedGate.map((r) => r.name).join(", ")}`;
  console.log(`\nClean-parse gate (>= ${CLEAN_SHARE_GATE * 100}%): ${verdict}`);
}
process.exit(failedGate.length === 0 ? 0 : 1);
