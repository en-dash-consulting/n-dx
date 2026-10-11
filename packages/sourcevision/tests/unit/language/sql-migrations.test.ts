/**
 * Migration-tool detection on one fixture project per tool, and table-name
 * extraction through the tree-sitter-sql grammar built by
 * scripts/build-grammars.mjs (those tests skip when it is not built).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { detectMigrationTools, sqlcPaths } from "../../../src/language/sql-migrations.js";
import { extractSqlTables, splitSqlName, sqlTarget } from "../../../src/language/sql-schema.js";
import { createTreeSitterRunner, type TreeSitterRunner } from "../../../src/language/runner.js";
import { grammarWasmPath } from "../../../scripts/build-grammars.mjs";
import { skipUnlessGrammar } from "../../helpers/grammar.js";

type Fixture = Record<string, string>;

function detect(fixture: Fixture) {
  return detectMigrationTools(Object.keys(fixture), (path) => fixture[path]);
}

const tools = (fixture: Fixture) => detect(fixture).map((finding) => finding.tool);

const FIXTURES: Record<string, Fixture> = {
  flyway: {
    "src/main/resources/db/migration/V1__init.sql": "CREATE TABLE owners (id int);",
    "src/main/resources/db/migration/V2.1__add_pets.sql": "CREATE TABLE pets (id int);",
    "src/main/resources/db/migration/R__views.sql": "CREATE VIEW v AS SELECT 1;",
  },
  liquibase: {
    "src/main/resources/db/changelog/db.changelog-master.xml": '<databaseChangeLog xmlns="x"></databaseChangeLog>',
    "src/main/resources/db/changelog/0001.sql": "--liquibase formatted sql\n--changeset a:1\nCREATE TABLE t (id int);",
  },
  "golang-migrate": {
    "migrations/000001_create_users.up.sql": "CREATE TABLE users (id int);",
    "migrations/000001_create_users.down.sql": "DROP TABLE users;",
  },
  goose: {
    "db/20240101_init.sql": "-- +goose Up\nCREATE TABLE accounts (id int);\n-- +goose Down\nDROP TABLE accounts;",
  },
  atlas: {
    "atlas.hcl": 'env "local" {}',
    "migrations/atlas.sum": "h1:abc",
    "migrations/20240101.sql": "CREATE TABLE a (id int);",
  },
  prisma: {
    "prisma/schema.prisma": "model User { id Int @id }",
    "prisma/migrations/20240101_init/migration.sql": 'CREATE TABLE "User" (id int);',
  },
  sqlc: {
    "sqlc.yaml": 'version: "2"\nsql:\n  - engine: postgresql\n    queries: "query/"\n    schema: "schema.sql"\n',
    "query/users.sql": "-- name: GetUser :one\nSELECT * FROM users;",
    "schema.sql": "CREATE TABLE users (id int);",
  },
};

describe("detectMigrationTools", () => {
  for (const [tool, fixture] of Object.entries(FIXTURES)) {
    it(`detects ${tool} and nothing else`, () => {
      expect(tools(fixture)).toEqual([tool]);
    });
  }

  it("lists the tool's SQL files apart from its markers", () => {
    const [flyway] = detect(FIXTURES.flyway!);
    expect(flyway?.sqlFiles).toEqual([
      "src/main/resources/db/migration/R__views.sql",
      "src/main/resources/db/migration/V1__init.sql",
      "src/main/resources/db/migration/V2.1__add_pets.sql",
    ]);
    const [sqlc] = detect(FIXTURES.sqlc!);
    expect(sqlc?.files).toEqual(["query/users.sql", "schema.sql", "sqlc.yaml"]);
    expect(sqlc?.sqlFiles).toEqual(["schema.sql"]);
  });

  it("resolves a sqlc schema directory or list relative to the config", () => {
    const [dir] = detect({
      "db/sqlc.yaml": 'sql:\n  - schema: "./schema"\n    queries: "q"\n',
      "db/schema/a.sql": "CREATE TABLE a (id int);",
      "db/q/a.sql": "-- name: A :one\nSELECT 1;",
    });
    expect(dir?.sqlFiles).toEqual(["db/schema/a.sql"]);
    const [list] = detect({
      "sqlc.yaml": "sql:\n  - schema:\n      - one.sql\n      - ../two.sql\n",
      "one.sql": "CREATE TABLE one (id int);",
    });
    expect(list?.sqlFiles).toEqual(["one.sql"]);
  });

  it("lists Atlas migrations from the directory holding atlas.sum", () => {
    const [atlas] = detect(FIXTURES.atlas!);
    expect(atlas?.sqlFiles).toEqual(["migrations/20240101.sql"]);
  });

  it("detects Liquibase in JHipster's config/liquibase layout", () => {
    const fixture = {
      "src/main/resources/config/liquibase/master.xml": "<databaseChangeLog></databaseChangeLog>",
      "src/main/resources/config/liquibase/changelog/20240101000000_added_entity_Owner.xml":
        "<databaseChangeLog><changeSet/></databaseChangeLog>",
    };
    expect(detect(fixture)).toEqual([{ tool: "liquibase", files: Object.keys(fixture).sort(), sqlFiles: [] }]);
  });

  it("detects flyway from its config alone", () => {
    expect(tools({ "flyway.toml": "[flyway]" })).toEqual(["flyway"]);
  });

  it("does not take a sqlc config with no queries, or a plain .sql file, for a tool", () => {
    expect(tools({ "sqlc.yaml": "version: 2\nsql: []\n" })).toEqual([]);
    expect(tools({ "db/schema.sql": "CREATE TABLE t (id int);", "migrations/V1__x.sql": "SELECT 1;" })).toEqual([]);
  });

  it("does not take an unrelated changelog for Liquibase", () => {
    expect(tools({ "db/changelog/notes.yaml": "title: release notes" })).toEqual([]);
  });

  it("detects several tools in one repository", () => {
    expect(tools({ ...FIXTURES.flyway!, ...FIXTURES.prisma! })).toEqual(["flyway", "prisma"]);
  });
});

describe("sqlcPaths", () => {
  it("reads scalar, flow-list and block-list forms relative to the config", () => {
    expect(sqlcPaths("a/sqlc.yaml", 'queries: "./q"', "queries")).toEqual(["a/q"]);
    expect(sqlcPaths("sqlc.yaml", "queries: [q1, 'q2']", "queries")).toEqual(["q1", "q2"]);
    expect(sqlcPaths("sqlc.yaml", "sql:\n  - queries:\n      - one.sql\n      - ../two.sql\n", "queries")).toEqual([
      "one.sql",
      "two.sql",
    ]);
    expect(sqlcPaths("sqlc.json", '{\n  "sql": [{\n    "queries": "db/q",\n    "engine": "postgresql"\n  }]\n}', "queries")).toEqual(["db/q"]);
  });

  it("reads the schema key and ignores the other", () => {
    const yaml = 'queries: "q"\nschema: "s.sql"\n';
    expect(sqlcPaths("sqlc.yaml", yaml, "schema")).toEqual(["s.sql"]);
    expect(sqlcPaths("sqlc.yaml", yaml, "queries")).toEqual(["q"]);
  });
});

describe("splitSqlName", () => {
  it("strips quoting and splits on dots outside quotes", () => {
    expect(splitSqlName('public."Own.ers"')).toEqual(["public", "Own.ers"]);
    expect(splitSqlName("`db`.`t`")).toEqual(["db", "t"]);
    expect(splitSqlName("[dbo].[t]")).toEqual(["dbo", "t"]);
    expect(splitSqlName("plain")).toEqual(["plain"]);
  });
});

describe("extractSqlTables", () => {
  const wasm = grammarWasmPath("tree-sitter-sql");
  let runner: TreeSitterRunner;

  beforeAll(() => {
    runner = createTreeSitterRunner();
  });
  afterAll(() => runner?.dispose());

  it("names tables from CREATE and ALTER statements", async (ctx) => {
    skipUnlessGrammar(ctx, wasm);
    const source = [
      "CREATE TABLE IF NOT EXISTS public.owners (id int PRIMARY KEY);",
      'ALTER TABLE ONLY "pets" ADD COLUMN age int;',
      "create table `shop`.`orders` (id int);",
      "CREATE TABLE copy AS SELECT 1;",
    ].join("\n");
    const result = await extractSqlTables(runner, sqlTarget(wasm), "schema.sql", source);
    expect(result.hasErrors).toBe(false);
    expect(result.tables).toEqual([
      { name: "owners", schema: "public", statement: "create", line: 1 },
      { name: "pets", statement: "alter", line: 2 },
      { name: "orders", schema: "shop", statement: "create", line: 3 },
      { name: "copy", statement: "create", line: 4 },
    ]);
  });

  it("reports a file the grammar cannot fully parse instead of assuming it did", async (ctx) => {
    skipUnlessGrammar(ctx, wasm);
    const result = await extractSqlTables(runner, sqlTarget(wasm), "x.sql", "CREATE TABLE ok (id int);\nCREATE ??? ;;");
    expect(result.hasErrors).toBe(true);
    expect(result.tables.map((t) => t.name)).toContain("ok");
  });

  it("reports an oversized file as not parsed", async (ctx) => {
    skipUnlessGrammar(ctx, wasm);
    const small = createTreeSitterRunner({ maxFileBytes: 4 });
    try {
      const result = await extractSqlTables(small, sqlTarget(wasm), "big.sql", "CREATE TABLE t (id int);");
      expect(result).toEqual({ path: "big.sql", parsed: false, hasErrors: false, tables: [] });
    } finally {
      small.dispose();
    }
  });
});
