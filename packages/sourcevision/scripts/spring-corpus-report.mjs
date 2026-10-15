#!/usr/bin/env node
/**
 * Measure the Java pack's Spring Boot rules over the Java drift corpus.
 *
 *   node packages/sourcevision/scripts/spring-corpus-report.mjs [<repository>...] [--json]
 *
 * Reads ~/.cache/ndx-java-corpus/ (override with NDX_JAVA_CORPUS_DIR) and,
 * per repository (all of them, or those named), prints the route count, the
 * outbound call count by kind and client and by confidence, the request
 * mapping values skipped because they are not literals, and 15 random routes
 * and 15 random outbound calls with file:line for a hand check. The sample is
 * seeded by the repository name, so a rerun prints the same facts. Exits 2
 * when the corpus, the build or the grammar is missing. Never touches the
 * network; clone with java-corpus-clone.mjs. Not part of the test run.
 *
 * Needs `pnpm --filter @n-dx/lang-java build` and `pnpm --filter
 * @n-dx/lang-java build:grammars`; the pack is imported from the workspace.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { CLONE_COMMAND, CORPUS_DIR_ENV, checkedOutSha, corpusDir, loadCorpus } from "./java-corpus.mjs";
import { importWorkspacePack } from "./workspace-pack.mjs";

const SAMPLE = 15;
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

/** A small seeded generator (mulberry32), so a sample is the same on every run. */
function seededRandom(seedText) {
  let seed = [...seedText].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Up to `n` of `items`, drawn without replacement, in their original order. */
function sample(items, n, random) {
  const picked = new Set();
  while (picked.size < Math.min(n, items.length)) picked.add(Math.floor(random() * items.length));
  return [...picked].sort((a, b) => a - b).map((i) => items[i]);
}

const countBy = (items, key) => {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};

const json = process.argv.includes("--json");
const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const root = corpusDir();
const corpus = loadCorpus().filter((repo) => named.length === 0 || named.includes(repo.name));
const unknown = named.filter((name) => !corpus.some((repo) => repo.name === name));
if (unknown.length > 0) {
  console.error(`Not in java-corpus.json: ${unknown.join(", ")}`);
  process.exit(2);
}

const missing = corpus.filter((repo) => checkedOutSha(join(root, repo.name)) === undefined);
if (missing.length > 0) {
  console.error(`Corpus incomplete in ${root} (${CORPUS_DIR_ENV} overrides). Missing: ${missing.map((r) => r.name).join(", ")}`);
  console.error(`Clone it with: ${CLONE_COMMAND}`);
  process.exit(2);
}

const { javaGrammarPath, javaPack, readSpringFile, springBoot } = await importWorkspacePack("@n-dx/lang-java");
const wasm = javaGrammarPath();
if (!existsSync(wasm)) {
  console.error(`${wasm} is not built — run \`pnpm --filter @n-dx/lang-java build:grammars\``);
  process.exit(2);
}
const runtimeDist = new URL("../../lang-runtime/dist/index.js", import.meta.url);
if (!existsSync(runtimeDist)) {
  console.error("lang-runtime is not built — run `pnpm --filter @n-dx/lang-runtime build`");
  process.exit(2);
}
const { createTreeSitterRunner } = await import(runtimeDist.href);

// The parse the pack entry runs when routes or outbound calls are wanted: the Java queries and Spring Boot's.
const runner = createTreeSitterRunner();
const target = { pack: { ...javaPack, queries: [...javaPack.queries, ...springBoot.queries] }, grammarPath: wasm };
const results = [];

try {
  for (const repo of corpus) {
    const dir = join(root, repo.name);
    const routes = [];
    const outbound = [];
    const skipped = [];
    let files = 0;
    let unparsed = 0;
    for (const file of walkJava(dir)) {
      files++;
      const path = relative(dir, file).split(sep).join("/");
      const result = await runner.parseFile(target, file);
      if (result.status !== "parsed") {
        unparsed++;
        continue;
      }
      const facts = readSpringFile({ path, captures: result.captures });
      routes.push(...facts.routes.map((fact) => ({ file: path, ...fact })));
      outbound.push(...facts.outboundCalls.map((fact) => ({ file: path, ...fact })));
      skipped.push(...facts.skipped);
    }
    const random = seededRandom(repo.name);
    results.push({
      name: repo.name,
      pinnedSha: repo.sha,
      sha: checkedOutSha(dir),
      files,
      unparsed,
      routes: routes.length,
      routesByMethod: countBy(routes, (r) => r.method ?? "ANY"),
      outbound: outbound.length,
      outboundByKindAndClient: countBy(outbound, (o) => `${o.kind} ${o.client}`),
      outboundByConfidence: countBy(outbound, (o) => o.confidence),
      outboundByTargetSource: countBy(outbound, (o) => o.targetSource),
      skipped,
      routeSample: sample(routes, SAMPLE, random),
      outboundSample: sample(outbound, SAMPLE, random),
    });
  }
} finally {
  runner.dispose();
}

const counts = (record) => Object.entries(record).map(([k, n]) => `${k}=${n}`).join(", ") || "none";

if (json) {
  console.log(JSON.stringify({ corpusDir: root, results }, null, 2));
} else {
  console.log(`corpus: ${root}`);
  for (const r of results) {
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${drift}`);
    console.log(`  .java files: ${r.files} (not parsed: ${r.unparsed})`);
    console.log(`  routes:      ${r.routes}  (${counts(r.routesByMethod)})`);
    console.log(`  outbound:    ${r.outbound}`);
    for (const [key, n] of Object.entries(r.outboundByKindAndClient)) console.log(`    ${key}: ${n}`);
    console.log(`  confidence:  ${counts(r.outboundByConfidence)}`);
    console.log(`  target:      ${counts(r.outboundByTargetSource)}`);
    console.log(`  skipped mapping values (not literals): ${r.skipped.length}`);
    for (const s of r.skipped.slice(0, 20)) console.log(`    ${s.path}:${s.position.line} ${s.what} ${s.text}`);
    if (r.skipped.length > 20) console.log(`    ... and ${r.skipped.length - 20} more`);
    console.log(`  route sample (${r.routeSample.length}):`);
    for (const f of r.routeSample) console.log(`    ${f.file}:${f.position.line}  ${f.method ?? "ANY"} ${f.path} -> ${f.handler}`);
    console.log(`  outbound sample (${r.outboundSample.length}):`);
    for (const f of r.outboundSample) {
      console.log(`    ${f.file}:${f.position.line}  ${f.kind} ${f.client} ${f.targetSource}:${f.target} (${f.confidence})`);
    }
  }
}
