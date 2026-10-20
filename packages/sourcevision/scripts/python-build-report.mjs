#!/usr/bin/env node
/**
 * Run lang-kit's Python build readers over the drift corpus.
 *
 *   node packages/sourcevision/scripts/python-build-report.mjs [--json]
 *
 * Reads ~/.cache/ndx-python-corpus/ (override with NDX_PYTHON_CORPUS_DIR)
 * and, per repository, prints each project directory the readers find
 * (pyproject.toml, setup.cfg, setup.py or requirements files), its name,
 * source roots, listed packages, dependency count by scope, and notices. The
 * inventory is every file outside the directories the Python inventory skips,
 * as the readers expect. Exits 2 when the corpus or the lang-kit build is
 * missing. Never touches the network; clone with python-corpus-clone.mjs. Not
 * part of the test run.
 *
 * Needs `pnpm --filter @n-dx/lang-kit build`.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { performance } from "node:perf_hooks";

import { CLONE_COMMAND, CORPUS_DIR_ENV, checkedOutSha, corpusDir, loadCorpus } from "./python-corpus.mjs";
import { importWorkspacePack } from "./workspace-pack.mjs";

const json = process.argv.includes("--json");
const root = corpusDir();
const corpus = loadCorpus();

const missing = corpus.filter((repo) => checkedOutSha(join(root, repo.name)) === undefined);
if (missing.length > 0) {
  console.error(`Corpus incomplete in ${root} (${CORPUS_DIR_ENV} overrides). Missing: ${missing.map((r) => r.name).join(", ")}`);
  console.error(`Clone it with: ${CLONE_COMMAND}`);
  process.exit(2);
}

const { pythonConfig, readPythonProjects, skipsDirectory } = await importWorkspacePack("@n-dx/lang-kit");
const SKIP = { ...pythonConfig, skipDirectories: new Set([".git", "node_modules", ...pythonConfig.skipDirectories]) };

function* walk(dir, base) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const sub = join(dir, entry.name);
      if (!skipsDirectory(SKIP, entry.name, (file) => existsSync(join(sub, file)))) yield* walk(sub, base);
    } else if (entry.isFile()) {
      yield relative(base, join(dir, entry.name)).split(sep).join("/");
    }
  }
}

const countBy = (items, key) => {
  const out = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
};

const results = [];
for (const repo of corpus) {
  const dir = join(root, repo.name);
  const files = [...walk(dir, dir)];
  const start = performance.now();
  const projects = await readPythonProjects(dir, files);
  results.push({
    name: repo.name,
    sha: checkedOutSha(dir),
    pinnedSha: repo.sha,
    seconds: (performance.now() - start) / 1000,
    projects: projects.map((p) => ({
      dir: p.dir,
      name: p.name,
      files: p.files,
      sourceRoots: p.sourceRoots,
      packages: p.packages,
      dependencies: p.dependencies.length,
      byScope: countBy(p.dependencies, (d) => d.scope.replace(/:.*/, "")),
      references: p.references.length,
      workspaceMembers: p.workspaceMembers,
      notices: p.notices,
    })),
  });
}

if (json) {
  console.log(JSON.stringify({ corpusDir: root, results }, null, 2));
} else {
  console.log(`corpus: ${root}`);
  for (const r of results) {
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    const deps = r.projects.reduce((n, p) => n + p.dependencies, 0);
    const notices = r.projects.reduce((n, p) => n + p.notices.length, 0);
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${drift}`);
    console.log(`  projects: ${r.projects.length}, dependencies: ${deps}, notices: ${notices}, ${r.seconds.toFixed(2)} s`);
    for (const p of r.projects) {
      const roots = p.sourceRoots.map((s) => `${s.dir || "."}${s.package ? `=${s.package}` : ""} (${s.via})`).join(", ");
      console.log(`  ${p.dir || "."}${p.name ? ` [${p.name}]` : ""}: ${p.files.join(" ")}`);
      console.log(`    roots: ${roots}`);
      if (p.packages.length > 0) console.log(`    packages: ${p.packages.join(" ")}`);
      const scopes = Object.entries(p.byScope).map(([s, n]) => `${s}=${n}`).join(" ");
      console.log(`    dependencies: ${p.dependencies}${scopes ? ` (${scopes})` : ""}, references: ${p.references}`);
      if (p.workspaceMembers) console.log(`    workspace members: ${p.workspaceMembers.join(" ") || "none"}`);
      for (const n of p.notices) console.log(`    notice: ${n}`);
    }
  }
}
