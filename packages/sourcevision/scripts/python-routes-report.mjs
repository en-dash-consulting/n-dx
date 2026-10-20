#!/usr/bin/env node
/**
 * Measure the Python pack's FastAPI, Flask and Django route rules over the
 * Python drift corpus.
 *
 *   node packages/sourcevision/scripts/python-routes-report.mjs [<repository>...] [--json]
 *
 * Reads ~/.cache/ndx-python-corpus/ (override with NDX_PYTHON_CORPUS_DIR)
 * and, per repository (all of them, or those named), parses every `.py`/`.pyi`
 * file with the Python queries and every framework's, prepares the resolver
 * as the pack entry does, and runs each framework on its own. It prints the
 * route count by framework and method, the routes whose path keeps a
 * `${…}` placeholder, each framework's notices, and 15 random routes with
 * file:line for a hand check. The sample is seeded by the repository name,
 * so a rerun prints the same routes. Directories the Python inventory skips
 * are skipped here too. Exits 2 when the corpus, the build or the grammar is
 * missing. Never touches the network; clone with python-corpus-clone.mjs.
 * Not part of the test run.
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
const { preparePythonImports, pythonGrammarPath, pythonPack, readPythonResolveProjects } = await importWorkspacePack("@n-dx/lang-python");
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

// The parse the pack entry runs when routes are wanted: the Python queries and every framework's.
const frameworks = pythonPack.frameworks ?? [];
const runner = createTreeSitterRunner();
const target = { pack: { ...pythonPack, queries: [...pythonPack.queries, ...frameworks.flatMap((f) => f.queries)] }, grammarPath: wasm };
const results = [];

try {
  for (const repo of corpus) {
    const dir = join(root, repo.name);
    const parsed = [];
    const unparsed = [];
    for (const file of walkPython(dir)) {
      const path = relative(dir, file).split(sep).join("/");
      const result = await runner.parseFile(target, file);
      if (result.status === "parsed") parsed.push({ path, captures: result.captures });
      else unparsed.push(path);
    }
    const projects = await readPythonResolveProjects(dir, [...parsed.map((f) => f.path), ...unparsed].sort());
    const prepared = preparePythonImports(projects, parsed, unparsed);

    const routes = [];
    const notices = [];
    for (const framework of frameworks) {
      const read = framework.read(parsed, ["routes"], prepared);
      notices.push(...read.notices);
      for (const [file, facts] of read.facts) {
        for (const route of facts.routes ?? []) routes.push({ framework: framework.id, file, ...route });
      }
    }
    routes.sort((a, b) => a.file.localeCompare(b.file) || a.position.line - b.position.line || a.path.localeCompare(b.path));
    results.push({
      name: repo.name,
      pinnedSha: repo.sha,
      sha: checkedOutSha(dir),
      files: parsed.length + unparsed.length,
      unparsed: unparsed.length,
      routes: routes.length,
      byFramework: countBy(routes, (r) => r.framework),
      byFrameworkAndMethod: countBy(routes, (r) => `${r.framework} ${r.method ?? "ANY"}`),
      placeholderPaths: routes.filter((r) => r.path.includes("${")).map((r) => `${r.file}:${r.position.line} ${r.path}`),
      notices,
      sample: sample(routes, SAMPLE, seededRandom(repo.name)),
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
    console.log(`  .py/.pyi files: ${r.files} (not parsed: ${r.unparsed})`);
    console.log(`  routes:         ${r.routes}  (${counts(r.byFramework)})`);
    for (const [key, n] of Object.entries(r.byFrameworkAndMethod)) console.log(`    ${key}: ${n}`);
    console.log(`  paths with a \${…} placeholder: ${r.placeholderPaths.length}`);
    for (const p of r.placeholderPaths.slice(0, 20)) console.log(`    ${p}`);
    if (r.placeholderPaths.length > 20) console.log(`    ... and ${r.placeholderPaths.length - 20} more`);
    console.log(`  notices (${r.notices.length}):`);
    for (const n of r.notices) console.log(`    ${n}`);
    console.log(`  route sample (${r.sample.length}):`);
    for (const f of r.sample) console.log(`    ${f.file}:${f.position.line}  [${f.framework}] ${f.method ?? "ANY"} ${f.path} -> ${f.handler ?? "-"}`);
  }
}
