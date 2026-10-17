#!/usr/bin/env node
/**
 * Measure the Python resolver over the drift corpus.
 *
 *   node packages/sourcevision/scripts/python-resolve-report.mjs [--json] [--sample N] [repo...]
 *
 * Reads ~/.cache/ndx-python-corpus/ (override with NDX_PYTHON_CORPUS_DIR)
 * and, per repository, resolves every `.py`/`.pyi` file's imports as the
 * pack does in `analyze`, then prints:
 * - internal imports resolved / internal total. An import is internal when
 *   it is relative or its top-level module is a package under one of the
 *   repository's source roots; one resolved to a namespace-package directory
 *   counts as resolved (it gives no edge);
 * - externals matched to a declared dependency / externals total, and the
 *   most-imported unmatched names (`yaml` is never matched to `PyYAML`);
 * - stdlib imports, and unresolved imports by reason;
 * - a sample of N resolved and N unresolved imports (default 15) with
 *   file:line and the line as written, spread evenly over the repository,
 *   for checking by hand.
 * Directories the Python inventory skips are skipped here too. Exits 2 when
 * the corpus, the build or the grammar is missing. Never touches the
 * network; clone with python-corpus-clone.mjs. Not part of the test run.
 *
 * Needs `pnpm --filter @n-dx/lang-python build` and `pnpm --filter
 * @n-dx/lang-python build:grammars`; the pack is imported from the workspace.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { performance } from "node:perf_hooks";

import { CLONE_COMMAND, CORPUS_DIR_ENV, checkedOutSha, corpusDir, loadCorpus } from "./python-corpus.mjs";
import { importWorkspacePack } from "./workspace-pack.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const sampleAt = args.indexOf("--sample");
const SAMPLE = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 15;
const only = args.filter((a, i) => !a.startsWith("--") && !(sampleAt >= 0 && i === sampleAt + 1));
const root = corpusDir();
const corpus = loadCorpus().filter((repo) => only.length === 0 || only.includes(repo.name));

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

/** `n` items spread evenly over `items`, in order. */
const spread = (items, n) => (items.length <= n ? items : Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]));

const runner = createTreeSitterRunner();
const target = { pack: pythonPack, grammarPath: wasm };
const results = [];

try {
  for (const repo of corpus) {
    const dir = join(root, repo.name);
    const start = performance.now();
    const parsed = [];
    const unparsed = [];
    for (const file of walkPython(dir)) {
      const path = relative(dir, file).split(sep).join("/");
      const result = await runner.parseFile(target, file);
      if (result.status === "parsed") parsed.push({ path, captures: result.captures });
      else unparsed.push(path);
    }
    const parseSeconds = (performance.now() - start) / 1000;
    const t1 = performance.now();
    const paths = [...parsed.map((f) => f.path), ...unparsed].sort();
    const projects = await readPythonResolveProjects(dir, paths);
    const prepared = preparePythonImports(projects, parsed, unparsed);
    const resolveSeconds = (performance.now() - t1) / 1000;

    const counts = { written: 0, internal: 0, internalResolved: 0, namespace: 0, stdlib: 0, external: 0, matched: 0 };
    const unresolved = {};
    const unmatched = new Map();
    const resolvedList = [];
    const unresolvedList = [];
    for (const file of parsed) {
      for (const { written, outcome } of prepared.outcomes(file.path)) {
        counts.written++;
        const at = { file: file.path, line: written.position.line, specifier: written.specifier, names: written.names };
        switch (outcome.kind) {
          case "internal":
          case "namespace":
            counts.internal++;
            counts.internalResolved++;
            if (outcome.kind === "namespace") counts.namespace++;
            resolvedList.push({ ...at, to: outcome.kind === "internal" ? outcome.targets : [`${outcome.dir}/ (namespace)`] });
            break;
          case "unresolved":
            counts.internal++;
            unresolved[outcome.reason] = (unresolved[outcome.reason] ?? 0) + 1;
            unresolvedList.push({ ...at, reason: outcome.reason });
            break;
          case "stdlib":
            counts.stdlib++;
            break;
          case "external":
            counts.external++;
            if (outcome.dependency) counts.matched++;
            else unmatched.set(outcome.module, (unmatched.get(outcome.module) ?? 0) + 1);
            break;
        }
      }
    }
    const lineOf = (s) => readFileSync(join(dir, s.file), "utf8").split("\n")[s.line - 1]?.trim();
    results.push({
      name: repo.name,
      sha: checkedOutSha(dir),
      pinnedSha: repo.sha,
      files: parsed.length + unparsed.length,
      projects: projects.length,
      roots: [...new Set(projects.flatMap((p) => p.sourceRoots.map((r) => `${r.dir || "."}${r.package ? `=${r.package}` : ""}`)))],
      parseSeconds,
      resolveSeconds,
      counts,
      unresolved,
      topUnmatched: [...unmatched.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 15),
      notices: prepared.notices(),
      sampleResolved: spread(resolvedList, SAMPLE).map((s) => ({ ...s, text: lineOf(s) })),
      sampleUnresolved: spread(unresolvedList, SAMPLE).map((s) => ({ ...s, text: lineOf(s) })),
    });
  }
} finally {
  runner.dispose();
}

const pct = (a, b) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);

if (json) {
  console.log(JSON.stringify({ corpusDir: root, results }, null, 2));
} else {
  console.log(`corpus: ${root}`);
  for (const r of results) {
    const c = r.counts;
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${drift}`);
    console.log(`  files: ${r.files}, projects: ${r.projects}, roots: ${r.roots.join(" ") || ". (no project)"}`);
    console.log(`  imports written: ${c.written}`);
    console.log(`  internal resolved: ${c.internalResolved}/${c.internal} = ${pct(c.internalResolved, c.internal)} (namespace directories: ${c.namespace})`);
    console.log(`  externals matched to a declared dependency: ${c.matched}/${c.external} = ${pct(c.matched, c.external)}`);
    console.log(`  stdlib: ${c.stdlib}`);
    console.log(`  unresolved: ${Object.entries(r.unresolved).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`);
    console.log(`  most-imported unmatched externals: ${r.topUnmatched.map(([m, n]) => `${m}(${n})`).join(" ") || "none"}`);
    console.log(`  time: parse ${r.parseSeconds.toFixed(1)} s, projects and resolution ${r.resolveSeconds.toFixed(2)} s`);
    for (const n of r.notices) console.log(`  notice: ${n}`);
    console.log("  sample, resolved:");
    for (const s of r.sampleResolved) console.log(`    ${s.file}:${s.line}  ${s.text}  ->  ${s.to.join(", ")}`);
    console.log("  sample, unresolved:");
    for (const s of r.sampleUnresolved) console.log(`    ${s.file}:${s.line}  ${s.text}  [${s.reason}]`);
  }
}
