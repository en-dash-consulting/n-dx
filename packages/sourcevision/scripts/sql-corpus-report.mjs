#!/usr/bin/env node
/**
 * Measure the tree-sitter-sql grammar over the `.sql` files of the Java corpus
 * (spring-petclinic and thingsboard; see java-corpus.json).
 *
 *   node packages/sourcevision/scripts/sql-corpus-report.mjs [--json]
 *
 * Reads ~/.cache/ndx-java-corpus/ (override with NDX_JAVA_CORPUS_DIR). Per
 * repository and per dialect prints the `.sql` file count, the share parsed
 * without ERROR or MISSING nodes, the tables found, the migration tools
 * detected and the files that did not parse cleanly. The grammar is generic, so
 * the dialect of a file is read from its path (a `mysql/` or `postgres/`
 * directory or file name) — the evidence a repository gives without parsing —
 * and files that name none are `unlabelled`. Never touches the network and
 * writes nothing; not part of the test run. It has no pass/fail gate: the
 * rates are the result, for the rex log.
 *
 * Needs `pnpm --filter @n-dx/sourcevision --filter @n-dx/lang-sql build` and
 * `pnpm --filter @n-dx/lang-sql build:grammars`.
 * Exits 2 when a checkout, the build or the grammar is missing.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";

import { checkedOutSha, CLONE_COMMAND, corpusDir, loadCorpus } from "./java-corpus.mjs";

/** Large enough that no corpus file is skipped: the report measures the grammar, not the size limit. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", "target", "build"]);
const REPOSITORIES = new Set(["spring-petclinic", "thingsboard"]);
const LISTED = 10;

/** Order matters: `postgres` before the `sql` suffix of `mysql`, `mariadb` before `mysql`. */
const DIALECT_HINTS = [
  ["timescaledb", /timescale/i],
  ["postgresql", /postgres|pgsql|psql/i],
  ["mariadb", /mariadb/i],
  ["mysql", /mysql/i],
  ["oracle", /oracle/i],
  ["sqlserver", /sqlserver|mssql/i],
  ["hsqldb", /hsqldb/i],
  ["h2", /(^|[/_.-])h2([/_.-]|$)/i],
  ["sqlite", /sqlite/i],
];

function dialectOf(path) {
  return DIALECT_HINTS.find(([, pattern]) => pattern.test(path))?.[0] ?? "unlabelled";
}

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
const corpus = loadCorpus().filter((repo) => REPOSITORIES.has(repo.name));
const root = corpusDir();

const missing = corpus.filter((repo) => checkedOutSha(join(root, repo.name)) === undefined);
if (missing.length > 0) {
  for (const repo of missing) console.error(`${repo.name}: no checkout at ${join(root, repo.name)}`);
  console.error(`  clone the corpus with: ${CLONE_COMMAND}`);
  process.exit(2);
}

const dist = (name) => new URL(`../dist/language/${name}.js`, import.meta.url);
if (!existsSync(dist("sql-migrations"))) {
  console.error("sourcevision is not built — run `pnpm --filter @n-dx/sourcevision build`");
  process.exit(2);
}
const runtimeDist = new URL("../../lang-runtime/dist/index.js", import.meta.url);
if (!existsSync(runtimeDist)) {
  console.error("lang-runtime is not built — run `pnpm --filter @n-dx/lang-runtime build`");
  process.exit(2);
}
const sqlDist = new URL("../../lang-sql/dist/index.js", import.meta.url);
if (!existsSync(sqlDist)) {
  console.error("lang-sql is not built — run `pnpm --filter @n-dx/lang-sql build`");
  process.exit(2);
}
const { createTreeSitterRunner } = await import(runtimeDist.href);
const { extractSqlTables, sqlGrammarPath, sqlTarget } = await import(sqlDist.href);
const { detectMigrationTools } = await import(dist("sql-migrations").href);

const wasm = sqlGrammarPath();
if (!existsSync(wasm)) {
  console.error(`${wasm} is not built — run \`pnpm --filter @n-dx/lang-sql build:grammars\``);
  process.exit(2);
}

const runner = createTreeSitterRunner({ maxFileBytes: MAX_FILE_BYTES });
const target = sqlTarget(wasm);
const results = [];

try {
  for (const repo of corpus) {
    const dir = join(root, repo.name);
    const files = [...walk(dir)].map((file) => relative(dir, file).split("\\").join("/"));
    const sqlFiles = files.filter((file) => file.endsWith(".sql"));
    const contents = new Map(sqlFiles.map((file) => [file, readFileSync(join(dir, file), "utf8")]));
    const dialects = {};
    const failing = [];
    const start = performance.now();
    for (const file of sqlFiles) {
      const stats = (dialects[dialectOf(file)] ??= { files: 0, clean: 0, tables: 0 });
      stats.files++;
      const result = await extractSqlTables(runner, target, file, contents.get(file));
      stats.tables += result.tables.length;
      if (!result.hasErrors) stats.clean++;
      else failing.push(file);
    }
    results.push({
      name: repo.name,
      sha: checkedOutSha(dir),
      pinnedSha: repo.sha,
      sqlFiles: sqlFiles.length,
      dialects,
      tools: detectMigrationTools(files, (file) => contents.get(file) ?? readSmall(dir, file)).map((f) => ({
        tool: f.tool,
        files: f.files.length,
      })),
      seconds: (performance.now() - start) / 1000,
      failing,
    });
  }
} finally {
  runner.dispose();
}

/** Non-SQL candidates (changelogs, configs) are read on demand; unreadable ones are absent. */
function readSmall(dir, file) {
  try {
    return readFileSync(join(dir, file), "utf8");
  } catch {
    return undefined;
  }
}

const pct = (n, d) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

if (json) {
  console.log(JSON.stringify({ results }, null, 2));
} else {
  for (const r of results) {
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${drift}`);
    console.log(`  .sql files:  ${r.sqlFiles}`);
    for (const [dialect, s] of Object.entries(r.dialects).sort()) {
      console.log(`  ${dialect.padEnd(12)} clean parse ${s.clean}/${s.files} = ${pct(s.clean, s.files)}, ${s.tables} tables`);
    }
    console.log(`  tools:       ${r.tools.map((t) => `${t.tool} (${t.files} files)`).join(", ") || "none"}`);
    console.log(`  parse time:  ${r.seconds.toFixed(1)} s`);
    for (const file of r.failing.slice(0, LISTED)) console.log(`  not clean:   ${file}`);
    if (r.failing.length > LISTED) console.log(`  ... and ${r.failing.length - LISTED} more not clean`);
  }
}
