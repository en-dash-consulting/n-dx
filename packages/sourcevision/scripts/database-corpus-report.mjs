#!/usr/bin/env node
/**
 * Run database-engine detection over the corpus checkouts: spring-petclinic
 * and thingsboard (java-corpus.json), gitea and microservices-demo
 * (go-corpus.json).
 *
 *   node packages/sourcevision/scripts/database-corpus-report.mjs [--json]
 *
 * Reads ~/.cache/ndx-java-corpus/ and ~/.cache/ndx-go-corpus/ (override with
 * NDX_JAVA_CORPUS_DIR and NDX_GO_CORPUS_DIR). Dependencies come from the same
 * build-model readers the packs use (Maven, Gradle, go.mod), plus
 * `package.json`. Per repository prints each engine candidate, its grade, the
 * signals that found it, image versions and up to five evidence lines. Never
 * touches the network and writes nothing; not part of the test run. It has no
 * pass/fail gate: the candidates are the result, for the rex log.
 *
 * Needs `pnpm --filter @n-dx/sourcevision build`. Exits 2 when a checkout or
 * the build is missing.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import * as goCorpus from "./go-corpus.mjs";
import * as javaCorpus from "./java-corpus.mjs";

const REPOSITORIES = [
  [javaCorpus, "spring-petclinic"],
  [javaCorpus, "thingsboard"],
  [goCorpus, "gitea"],
  [goCorpus, "microservices-demo"],
];
const SKIP_DIRS = new Set([".git", "node_modules", "target", "build", "vendor", "dist"]);
/** Config and manifest files larger than this are not read; none of the corpus's are. */
const MAX_FILE_BYTES = 1024 * 1024;
const LISTED = 5;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}

const json = process.argv.includes("--json");
const repos = REPOSITORIES.map(([corpus, name]) => ({
  name,
  dir: join(corpus.corpusDir(), name),
  pinnedSha: corpus.loadCorpus().find((r) => r.name === name).sha,
  clone: corpus.CLONE_COMMAND,
  checkedOutSha: corpus.checkedOutSha,
}));

const missing = repos.filter((repo) => repo.checkedOutSha(repo.dir) === undefined);
if (missing.length > 0) {
  for (const repo of missing) console.error(`${repo.name}: no checkout at ${repo.dir}\n  clone it with: ${repo.clone}`);
  process.exit(2);
}

const dist = (name) => new URL(`../dist/language/${name}.js`, import.meta.url);
if (!existsSync(dist("database-engines"))) {
  console.error("sourcevision is not built — run `pnpm --filter @n-dx/sourcevision build`");
  process.exit(2);
}
const { detectDatabaseEngines } = await import(dist("database-engines").href);
const { discoverJavaModules } = await import(dist("java-modules").href);
const { readMavenBuildModels } = await import(dist("java-maven-build").href);
const { readGradleBuildModels } = await import(dist("java-gradle-build").href);
const { readGoBuildModels } = await import(dist("go-build").href);

async function buildModels(dir) {
  const layout = await discoverJavaModules(dir);
  const java =
    layout.buildSystem === "maven"
      ? await readMavenBuildModels(dir, layout.modules)
      : layout.buildSystem === "gradle"
        ? await readGradleBuildModels(dir, layout.modules)
        : [];
  return [...java, ...(await readGoBuildModels(dir))];
}

function readSmall(dir, file) {
  const path = join(dir, file);
  if (statSync(path).size > MAX_FILE_BYTES) return undefined;
  return readFileSync(path, "utf8");
}

const results = [];
for (const repo of repos) {
  const files = [...walk(repo.dir)].map((file) => relative(repo.dir, file).split("\\").join("/"));
  const report = detectDatabaseEngines({ buildModels: await buildModels(repo.dir), files, read: (file) => readSmall(repo.dir, file) });
  results.push({ name: repo.name, sha: repo.checkedOutSha(repo.dir), pinnedSha: repo.pinnedSha, ...report });
}

if (json) {
  console.log(JSON.stringify({ results }, null, 2));
} else {
  for (const r of results) {
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${drift}`);
    if (r.candidates.length === 0) console.log("  no candidates");
    for (const c of r.candidates) {
      const versions = c.versions.length > 0 ? `, versions ${c.versions.join(" ")}` : "";
      console.log(`  ${c.engine.padEnd(12)} ${c.grade.padEnd(6)} ${c.signals.join("+")}, ${c.evidence.length} evidence${versions}`);
      for (const e of c.evidence.slice(0, LISTED)) {
        console.log(`    ${e.signal.padEnd(10)} ${e.grade.padEnd(6)} ${e.file}${e.line ? `:${e.line}` : ""}  ${e.text}`);
      }
      if (c.evidence.length > LISTED) console.log(`    ... and ${c.evidence.length - LISTED} more`);
    }
    for (const notice of r.notices) console.log(`  notice: ${notice}`);
  }
}
