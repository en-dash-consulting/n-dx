#!/usr/bin/env node
/**
 * Measure the Python pack's outbound-call rules (python-clients) over the
 * Python drift corpus.
 *
 *   node packages/sourcevision/scripts/python-outbound-report.mjs [<repository>...] [--json]
 *
 * Reads ~/.cache/ndx-python-corpus/ (override with NDX_PYTHON_CORPUS_DIR)
 * and, per repository (all of them, or those named), parses every `.py`/`.pyi`
 * file with the Python queries and the python-clients query, and prints the
 * outbound call count by kind, by client and by confidence, the targets by
 * source, and 15 random calls with file:line for a hand check. The sample is
 * seeded by the repository name, so a rerun prints the same calls.
 * Directories the Python inventory skips are skipped here too; files of
 * every role are counted (analyze drops test, docs and asset files). Exits 2
 * when the corpus, the build or the grammar is missing. Never touches the
 * network; clone with python-corpus-clone.mjs. Not part of the test run.
 *
 * Needs `pnpm --filter @n-dx/lang-python build` and `pnpm --filter
 * @n-dx/lang-python build:grammars`; the pack is imported from the workspace.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { countBy, sample, seededRandom } from "./corpus-sample.mjs";
import { CLONE_COMMAND, CORPUS_DIR_ENV, checkedOutSha, corpusDir, loadCorpus } from "./python-corpus.mjs";
import { importWorkspacePack } from "./workspace-pack.mjs";

const SAMPLE = 15;

const json = process.argv.includes("--json");
const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const root = corpusDir();
const corpus = loadCorpus().filter((repo) => named.length === 0 || named.includes(repo.name));
const unknown = named.filter((name) => !corpus.some((repo) => repo.name === name));
if (unknown.length > 0) {
  console.error(`Not in python-corpus.json: ${unknown.join(", ")}`);
  process.exit(2);
}

const missing = corpus.filter((repo) => checkedOutSha(join(root, repo.name)) === undefined);
if (missing.length > 0) {
  console.error(`Corpus incomplete in ${root} (${CORPUS_DIR_ENV} overrides). Missing: ${missing.map((r) => r.name).join(", ")}`);
  console.error(`Clone it with: ${CLONE_COMMAND}`);
  process.exit(2);
}

const { pythonConfig, skipsDirectory } = await importWorkspacePack("@n-dx/lang-kit");
const { pythonClients, pythonGrammarPath, pythonPack } = await importWorkspacePack("@n-dx/lang-python");
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

const SKIP = { ...pythonConfig, skipDirectories: new Set([".git", "node_modules", ".sourcevision", ...pythonConfig.skipDirectories]) };

function* walkPython(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const sub = join(dir, entry.name);
      if (!skipsDirectory(SKIP, entry.name, (file) => existsSync(join(sub, file)))) yield* walkPython(sub);
    } else if (entry.isFile() && [...pythonConfig.extensions].some((ext) => entry.name.endsWith(ext))) {
      yield join(dir, entry.name);
    }
  }
}

// The parse the pack entry runs when outbound calls are wanted: the Python queries and python-clients'.
const runner = createTreeSitterRunner();
const target = { pack: { ...pythonPack, queries: [...pythonPack.queries, ...pythonClients.queries] }, grammarPath: wasm };
const results = [];

try {
  for (const repo of corpus) {
    const dir = join(root, repo.name);
    const parsed = [];
    let unparsed = 0;
    for (const file of walkPython(dir)) {
      const path = relative(dir, file).split(sep).join("/");
      const result = await runner.parseFile(target, file);
      if (result.status === "parsed") parsed.push({ path, captures: result.captures });
      else unparsed++;
    }
    const started = performance.now();
    const read = pythonClients.read(parsed, ["outboundCalls"]);
    const readMs = Math.round(performance.now() - started);
    const calls = [];
    for (const [file, facts] of read.facts) for (const call of facts.outboundCalls ?? []) calls.push({ file, ...call });
    calls.sort((a, b) => a.file.localeCompare(b.file) || a.position.line - b.position.line || a.position.column - b.position.column);
    results.push({
      name: repo.name,
      pinnedSha: repo.sha,
      sha: checkedOutSha(dir),
      files: parsed.length + unparsed,
      unparsed,
      readMs,
      calls: calls.length,
      byKind: countBy(calls, (c) => c.kind),
      byClient: countBy(calls, (c) => `${c.kind} ${c.client}`),
      byConfidence: countBy(calls, (c) => c.confidence),
      byTargetSource: countBy(calls, (c) => c.targetSource),
      notices: read.notices,
      sample: sample(calls, SAMPLE, seededRandom(repo.name)),
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
    console.log(`  .py/.pyi files: ${r.files} (not parsed: ${r.unparsed}); rules read in ${r.readMs} ms`);
    console.log(`  outbound calls: ${r.calls}  (${counts(r.byKind)})`);
    for (const [key, n] of Object.entries(r.byClient)) console.log(`    ${key}: ${n}`);
    console.log(`  confidence:     ${counts(r.byConfidence)}`);
    console.log(`  target source:  ${counts(r.byTargetSource)}`);
    if (r.notices.length > 0) {
      console.log(`  notices (${r.notices.length}):`);
      for (const n of r.notices) console.log(`    ${n}`);
    }
    console.log(`  call sample (${r.sample.length}):`);
    for (const c of r.sample) {
      console.log(`    ${c.file}:${c.position.line}  ${c.kind} ${c.client} ${c.confidence} ${c.targetSource}${c.target === "" ? "" : ` ${c.target}`}`);
    }
  }
}
