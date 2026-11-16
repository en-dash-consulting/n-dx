/**
 * Database and cache outbound calls (`src/php-outbound.ts`) through the pack
 * entry, and table names from embedded SQL (`src/php-sql.ts`) through the real
 * PHP parse, over `php-data-access`: a PHP 5 mysql_* application, a PDO
 * application with prepared statements and heredoc SQL, the other database
 * extensions and Doctrine DBAL, and Memcache, Memcached, Redis and Predis
 * clients. Skips when the grammar is not built.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { EmbeddedSqlTable } from "@n-dx/lang-kit";
import { createTreeSitterRunner, listFixtureFiles, skipUnlessGrammar, type ParsedFile } from "@n-dx/lang-runtime";
import { extractPhpEmbeddedSql, pack, phpGrammarPath, phpPack } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-data-access");
const files = (): string[] => listFixtureFiles(dir, [...phpPack.config.extensions]).sort();

const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

async function parseFixture(): Promise<ParsedFile[]> {
  const parsed: ParsedFile[] = [];
  for (const path of files()) {
    const result = await runner.parseSource({ pack: phpPack, grammarPath: phpGrammarPath() }, path, readFileSync(join(dir, path), "utf8"));
    if (result.status !== "parsed") throw new Error(`expected ${path} to parse`);
    expect(result.hasErrorNodes || result.hasMissingNodes, path).toBe(false);
    parsed.push(result);
  }
  return parsed;
}

const summary = (tables: readonly EmbeddedSqlTable[]): string[] =>
  tables.map((t) => `${t.path}:${t.line} ${t.schema ? `${t.schema}.` : ""}${t.name} ${t.via}`);

describe("php database and cache outbound calls", () => {
  it("reports database connections and cache clients", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const result = await pack.analyzeProject({ projectDir: dir, files: files(), kinds: ["outboundCalls"] });
    expect(result.degraded).toBeUndefined();
    const calls = result.facts
      .slice()
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .flatMap((f) =>
        (f.outboundCalls ?? [])
          .filter((c) => c.kind === "database" || c.kind === "cache")
          .map((c) => `${f.path}:${c.position.line} ${c.kind} ${c.client} ${JSON.stringify(c.target)} (${c.targetSource}, ${c.confidence})`),
      );
    expect(calls).toEqual([
      'cache.php:3 cache memcache "memcache.internal:11211" (literal, certain)',
      'cache.php:5 cache memcached "mc1.internal:11211" (literal, certain)',
      // A host that is not literal keeps its own target, without the port.
      'cache.php:6 cache memcached "MC2_HOST" (env, certain)',
      'cache.php:8 cache redis "redis.internal:6379" (literal, certain)',
      // A socket path takes no port.
      'cache.php:9 cache redis "/var/run/redis.sock" (literal, certain)',
      // The password is dropped.
      'cache.php:10 cache predis "tcp://redis-cache.internal:6380" (literal, certain)',
      'cache.php:11 cache predis "redis-sessions.internal:6381" (literal, certain)',
      'connections.php:4 database mysqli "mysqli.internal:3306" (literal, certain)',
      'connections.php:5 database mysqli "crm-db.internal" (literal, certain)',
      'connections.php:6 database pgsql "pg.internal:5432" (literal, certain)',
      'connections.php:9 database oci8 "//oracle.internal:1521/ORCL" (literal, certain)',
      'connections.php:11 database sqlsrv "tcp:mssql.internal,1433" (literal, certain)',
      'connections.php:13 database odbc "sql.legacy" (literal, certain)',
      // `use Doctrine\DBAL\DriverManager`; the user and password are dropped from the URL.
      'connections.php:15 database doctrine-dbal "mysql://dbal.internal/app" (literal, certain)',
      'connections.php:16 database doctrine-dbal "DBAL_HOST" (env, certain)',
      // A constant the file defines.
      'legacy/db.php:5 database mysql "mysql.internal:3306" (literal, certain)',
      'legacy/db.php:18 database mysql "db_host" (config, certain)',
      'pdo/app.php:3 database pdo_mysql "db.example.com:3307" (literal, certain)',
      // The part that fills the DSN's open host key.
      'pdo/app.php:6 database pdo_pgsql "PG_HOST" (env, certain)',
      'pdo/app.php:7 database pdo_sqlite "/var/data/cache.db" (literal, certain)',
      'pdo/app.php:8 database pdo_odbc "LegacyDSN" (literal, certain)',
      // The driver is not known.
      'pdo/app.php:9 database pdo "dsn" (config, certain)',
    ]);
    // Not reported: connect() on a receiver that is not a cache client (cache.php).
  });

});

describe("php embedded SQL", () => {
  it("reads table names from SQL passed to query and prepare calls", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect(summary(extractPhpEmbeddedSql(await parseFixture()))).toEqual([
      "connections.php:7 shipments pg_query",
      "connections.php:8 warehouse.stock pg_prepare",
      "connections.php:10 ledger oci_parse",
      "connections.php:12 employees sqlsrv_query",
      "connections.php:14 payroll odbc_exec",
      "connections.php:17 invoices fetchAllAssociative",
      "legacy/db.php:7 customers mysql_query",
      // A variable: its assignment, with the unknown id left out.
      "legacy/db.php:8 orders mysql_query",
      "legacy/db.php:8 order_items mysql_query",
      "legacy/db.php:10 customers mysql_query",
      // A constant the repository defines once joins the table name.
      "legacy/db.php:11 shop_settings mysql_query",
      // Built with `.=`: the table is on the appending line.
      "legacy/db.php:16 sales_totals mysql_query",
      // Drupal's prefix braces dropped.
      "legacy/db.php:20 node db_query",
      "pdo/app.php:4 products prepare",
      "pdo/app.php:10 audit_log exec",
      // A heredoc held in a variable, each table on its own line.
      "pdo/app.php:13 customers query",
      "pdo/app.php:14 orders query",
      // A nowdoc passed in place, its closing marker indented.
      "pdo/app.php:20 sessions query",
    ]);
    // Not read: an interpolated table (`{$table}`, `archive_$year`) and SQL that names no table (`SHOW TABLES`).
  });

});
