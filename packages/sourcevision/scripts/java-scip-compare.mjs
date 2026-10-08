#!/usr/bin/env node
/**
 * Measure the Java resolver against scip-java (gate G2).
 *
 *   node packages/sourcevision/scripts/java-scip-compare.mjs [--json]
 *
 * For each drift-corpus repository with `<corpus>/<name>/index.scip`, reduces
 * the SCIP index to file-to-file type-reference edges inside the repository,
 * runs the resolver over the same `.java` files, and prints precision, recall
 * and the top unmatched targets in each direction. Repositories without an
 * index are listed and skipped. Reads ~/.cache/ndx-java-corpus/ (override with
 * NDX_JAVA_CORPUS_DIR) and never clones, builds or downloads. Exits 2 and
 * prints the operator commands when no index is present. Not part of the test
 * run; see java-scip-compare.md for producing the indexes.
 *
 * Needs `pnpm --filter @n-dx/sourcevision build` and `build-grammars.mjs`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { grammarWasmPath } from "./build-grammars.mjs";
import { CLONE_COMMAND, CORPUS_DIR_ENV, checkedOutSha, corpusDir, loadCorpus } from "./java-corpus.mjs";
import { compareEdges, edgeKey, proposeThreshold, readScipDocuments, scipEdges } from "./java-scip.mjs";

const INDEX_FILE = "index.scip";
const SKIP_DIRS = new Set([".git", "node_modules"]);

const OPERATOR_COMMANDS = [
  CLONE_COMMAND,
  "# install scip-java once (needs a JDK and coursier `cs`), then per repository:",
  "cs install --contrib scip-java",
  "cd ~/.cache/ndx-java-corpus/<repo> && scip-java index --output index.scip",
  "node packages/sourcevision/scripts/java-scip-compare.mjs",
  "Per-repository notes: packages/sourcevision/scripts/java-scip-compare.md",
];

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

const present = corpus.filter((repo) => existsSync(join(root, repo.name, INDEX_FILE)));
const absent = corpus.filter((repo) => !present.includes(repo));
if (present.length === 0) {
  console.error(`No ${INDEX_FILE} under ${root}/<repo> (${CORPUS_DIR_ENV} overrides). Operator commands:`);
  for (const line of OPERATOR_COMMANDS) console.error(`  ${line}`);
  process.exit(2);
}
const notCloned = present.filter((repo) => checkedOutSha(join(root, repo.name)) === undefined);
if (notCloned.length > 0) {
  console.error(`Not a checkout in ${root}: ${notCloned.map((r) => r.name).join(", ")}. Clone with: ${CLONE_COMMAND}`);
  process.exit(2);
}
if (!existsSync(grammarWasmPath("tree-sitter-java"))) {
  console.error("Java grammar is not built — run `node packages/sourcevision/scripts/build-grammars.mjs`");
  process.exit(2);
}
const distGraph = new URL("../dist/analyzers/pack-imports.js", import.meta.url);
if (!existsSync(distGraph)) {
  console.error("sourcevision is not built — run `pnpm --filter @n-dx/sourcevision build`");
  process.exit(2);
}
const { buildPackImportGraph } = await import(distGraph.href);

const results = [];
for (const repo of present) {
  const dir = join(root, repo.name);
  const files = [...walkJava(dir)].map((f) => relative(dir, f).split("\\").join("/"));
  const fileSet = new Set(files);
  const graph = await buildPackImportGraph(
    files.map((path) => ({ path })),
    dir,
  );
  const resolver = new Set(graph.edges.filter((e) => fileSet.has(e.to) && e.to !== e.from).map((e) => edgeKey(e.from, e.to)));
  const scip = scipEdges(readScipDocuments(readFileSync(join(dir, INDEX_FILE))), files);
  results.push({ name: repo.name, sha: checkedOutSha(dir), pinnedSha: repo.sha, files: files.length, ...compareEdges(resolver, scip) });
}

const thresholds = {
  precision: proposeThreshold(results.map((r) => r.precision)),
  recall: proposeThreshold(results.map((r) => r.recall)),
};

if (json) {
  console.log(JSON.stringify({ corpusDir: root, results, noIndex: absent.map((r) => r.name), proposedG2: thresholds }, null, 2));
} else {
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  console.log(`corpus: ${root}`);
  for (const r of results) {
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${drift}`);
    console.log(`  .java files: ${r.files}   edges: resolver ${r.resolver}, scip-java ${r.scip}, matched ${r.matched}`);
    console.log(`  precision ${pct(r.precision)}   recall ${pct(r.recall)}`);
    for (const [label, side] of [
      ["resolver-only (false positive)", r.extra],
      ["scip-only (missed)", r.missed],
    ]) {
      console.log(`  ${label}: ${side.total} ${JSON.stringify(side.byKind)}`);
      for (const t of side.topTargets) console.log(`    ${String(t.count).padStart(5)}  -> ${t.target}   e.g. from ${t.sampleFrom}`);
    }
  }
  if (absent.length > 0) console.log(`\nno ${INDEX_FILE} (skipped): ${absent.map((r) => r.name).join(", ")}`);
  console.log(`\nproposed G2 floors: precision >= ${pct(thresholds.precision)}, recall >= ${pct(thresholds.recall)} (lowest measured less 2 points)`);
}
