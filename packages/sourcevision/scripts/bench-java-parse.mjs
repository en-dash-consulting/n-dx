#!/usr/bin/env node
/**
 * Benchmark Java parse throughput with web-tree-sitter and the built grammar.
 *
 *   node packages/sourcevision/scripts/bench-java-parse.mjs <directory> [--json]
 *
 * Walks every `.java` file under <directory> (skipping `.git` and
 * `node_modules`), parses each, and reports file count, total and per-file
 * time, files per second, peak resident memory, and the share of files whose
 * tree contains ERROR or MISSING nodes. Each tree is freed after use.
 *
 * Not part of the test run: it needs a large input and lives outside
 * `tests/`. Build the grammar first with `build-grammars.mjs`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Language, Parser } from "web-tree-sitter";

import { grammarWasmPath } from "./build-grammars.mjs";

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

/** True when the tree holds an ERROR or MISSING node. `hasError` covers both. */
function hasSyntaxProblem(tree) {
  return tree.rootNode.hasError;
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("usage: bench-java-parse.mjs <directory> [--json]");
    process.exit(2);
  }
  const root = resolve(target);
  const wasm = grammarWasmPath("tree-sitter-java");
  if (!existsSync(wasm)) {
    console.error(`${wasm} is not built — run \`node packages/sourcevision/scripts/build-grammars.mjs\``);
    process.exit(2);
  }

  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load(wasm));

  const perFileMs = [];
  let bytes = 0;
  let withErrors = 0;
  let peakRss = process.memoryUsage().rss;
  let nullTrees = 0;

  const start = performance.now();
  for (const file of walkJava(root)) {
    const source = readFileSync(file, "utf8");
    bytes += Buffer.byteLength(source);
    const t0 = performance.now();
    const tree = parser.parse(source);
    if (tree === null) {
      nullTrees++;
      continue;
    }
    const problem = hasSyntaxProblem(tree);
    perFileMs.push(performance.now() - t0);
    tree.delete();
    if (problem) withErrors++;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const totalMs = performance.now() - start;
  parser.delete();

  const files = perFileMs.length;
  if (files === 0) {
    console.error(`no parsable .java files under ${root}`);
    process.exit(1);
  }
  const parseMs = perFileMs.reduce((a, b) => a + b, 0);
  const sorted = [...perFileMs].sort((a, b) => a - b);
  const result = {
    root,
    files,
    nullTrees,
    megabytes: +(bytes / 1e6).toFixed(2),
    totalMs: +totalMs.toFixed(0),
    parseMs: +parseMs.toFixed(0),
    meanMsPerFile: +(parseMs / files).toFixed(3),
    p50Ms: +percentile(sorted, 0.5).toFixed(3),
    p95Ms: +percentile(sorted, 0.95).toFixed(3),
    maxMs: +sorted[files - 1].toFixed(3),
    filesPerSecond: +(files / (totalMs / 1000)).toFixed(1),
    peakRssMb: +(peakRss / 1048576).toFixed(0),
    filesWithErrorsOrMissing: withErrors,
    errorSharePercent: +((withErrors / files) * 100).toFixed(2),
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`directory        ${result.root}`);
  console.log(`files            ${result.files} (${result.megabytes} MB, ${result.nullTrees} null trees)`);
  console.log(`total time       ${result.totalMs} ms (parse only: ${result.parseMs} ms)`);
  console.log(
    `per file         mean ${result.meanMsPerFile} ms, p50 ${result.p50Ms}, p95 ${result.p95Ms}, max ${result.maxMs}`,
  );
  console.log(`files / second   ${result.filesPerSecond}`);
  console.log(`peak memory      ${result.peakRssMb} MB RSS`);
  console.log(
    `ERROR/MISSING    ${result.filesWithErrorsOrMissing} of ${result.files} files (${result.errorSharePercent}%)`,
  );
}

await main();
