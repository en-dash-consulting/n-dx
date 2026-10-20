/** Migration-tool detection on one fixture project per tool. */

import { describe, expect, it } from "vitest";

import { detectMigrationTools, sqlcPaths } from "../../../src/language/sql-migrations.js";

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

  it("reads every schema and query path of a pretty-printed sqlc.json with arrays", () => {
    const config = {
      version: "2",
      sql: [{ engine: "postgresql", schema: ["db/schema.sql", "db/more.sql"], queries: ["db/q/users.sql"] }],
    };
    const [sqlc] = detect({
      "sqlc.json": JSON.stringify(config, null, 2),
      "db/schema.sql": "CREATE TABLE a (id int);",
      "db/more.sql": "CREATE TABLE b (id int);",
      "db/q/users.sql": "-- name: A :one\nSELECT 1;",
    });
    expect(sqlc?.tool).toBe("sqlc");
    expect(sqlc?.sqlFiles).toEqual(["db/more.sql", "db/schema.sql"]);
    expect(sqlc?.queryFiles).toEqual(["db/q/users.sql"]);
  });

  it("lists sqlc query files for the scalar, directory and list forms of queries:", () => {
    const q = (queries: string, extra: Record<string, string>) =>
      detect({ "sqlc.yaml": `sql:\n  - schema: s.sql\n    queries: ${queries}\n`, "s.sql": "CREATE TABLE t (id int);", ...extra })[0];
    expect(q("a.sql", { "a.sql": "-- name: A :one\nSELECT 1;", "b.sql": "x" })?.queryFiles).toEqual(["a.sql"]);
    expect(q("q", { "q/b.sql": "x", "q/a.sql": "x", "q/note.txt": "x" })?.queryFiles).toEqual(["q/a.sql", "q/b.sql"]);
    const list = q("\n      - b.sql\n      - a.sql\n      - missing.sql", { "a.sql": "x", "b.sql": "x" });
    expect(list?.queryFiles).toEqual(["a.sql", "b.sql"]);
    expect(list?.sqlFiles).toEqual(["s.sql"]);
    expect(detect(FIXTURES.flyway!)[0]?.queryFiles).toBeUndefined();
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

  it("drops a trailing YAML comment outside quotes", () => {
    expect(sqlcPaths("sqlc.yaml", 'schema: "schema.sql"  # tables', "schema")).toEqual(["schema.sql"]);
    expect(sqlcPaths("sqlc.yaml", "queries: query/ # sql", "queries")).toEqual(["query"]);
    expect(sqlcPaths("sqlc.yaml", "queries: [q1, q2] # both", "queries")).toEqual(["q1", "q2"]);
    expect(sqlcPaths("sqlc.yaml", "queries: # list\n  - one.sql # first\n  - 'two.sql'  # second\n", "queries")).toEqual([
      "one.sql",
      "two.sql",
    ]);
  });

  it("skips a block-list item that is only a comment instead of naming the config directory", () => {
    expect(sqlcPaths("db/sqlc.yaml", "queries:\n  - # none yet\n  - q.sql\n", "queries")).toEqual(["db/q.sql"]);
  });

  it("continues a block list past a comment-only or blank line", () => {
    expect(sqlcPaths("sqlc.yaml", "queries:\n  # main\n  - q.sql\n", "queries")).toEqual(["q.sql"]);
    expect(sqlcPaths("sqlc.yaml", "queries:\n  - a.sql\n\n  # more\n  - b.sql\nengine: x\n", "queries")).toEqual(["a.sql", "b.sql"]);
  });

  it("parses a .json config and walks sql[] and packages[] for scalars and arrays", () => {
    const json = JSON.stringify(
      {
        version: "2",
        sql: [
          { engine: "postgresql", schema: ["db/schema.sql", "db/more.sql"], queries: "db/q" },
          { engine: "mysql", schema: "other/s.sql", queries: ["other/q1.sql", "other/q2.sql"] },
        ],
      },
      null,
      2,
    );
    expect(sqlcPaths("sqlc.json", json, "schema")).toEqual(["db/schema.sql", "db/more.sql", "other/s.sql"]);
    expect(sqlcPaths("sqlc.json", json, "queries")).toEqual(["db/q", "other/q1.sql", "other/q2.sql"]);
    const v1 = '{"version": "1", "packages": [{"path": "db", "schema": ["./s.sql"], "queries": "./q/"}]}';
    expect(sqlcPaths("cfg/sqlc.json", v1, "schema")).toEqual(["cfg/s.sql"]);
    expect(sqlcPaths("cfg/sqlc.json", v1, "queries")).toEqual(["cfg/q"]);
  });

  it("reads a flow array written on one line in a .json config", () => {
    const json = '{\n  "sql": [{\n    "schema": ["db/schema.sql", "db/more.sql"],\n    "queries": "db/q"\n  }]\n}';
    expect(sqlcPaths("sqlc.json", json, "schema")).toEqual(["db/schema.sql", "db/more.sql"]);
  });

  it("names nothing for a .json config that does not parse or is not an object", () => {
    expect(sqlcPaths("sqlc.json", '{"sql": [{"schema": "s.sql"', "schema")).toEqual([]);
    expect(sqlcPaths("sqlc.json", '["s.sql"]', "schema")).toEqual([]);
    expect(sqlcPaths("sqlc.json", '{"sql": [{"schema": 3}, "x"]}', "schema")).toEqual([]);
  });

  it("reads a YAML flow list followed by a comma", () => {
    expect(sqlcPaths("sqlc.yaml", '  "schema": ["db/schema.sql", "db/more.sql"],', "schema")).toEqual([
      "db/schema.sql",
      "db/more.sql",
    ]);
    expect(sqlcPaths("sqlc.yaml", 'schema: "s.sql",', "schema")).toEqual(["s.sql"]);
  });

  it("reads a YAML flow list that spans several lines", () => {
    const yaml = 'sql:\n  - schema: [\n      "db/schema.sql",  # tables\n      db/more.sql,\n    ]\n    queries: [q1,\n      q2]\n';
    expect(sqlcPaths("sqlc.yaml", yaml, "schema")).toEqual(["db/schema.sql", "db/more.sql"]);
    expect(sqlcPaths("sqlc.yaml", yaml, "queries")).toEqual(["q1", "q2"]);
  });

  it("keeps a # inside quotes or not preceded by whitespace", () => {
    expect(sqlcPaths("sqlc.yaml", 'schema: "a #b.sql"', "schema")).toEqual(["a #b.sql"]);
    expect(sqlcPaths("sqlc.yaml", "schema: a#b.sql", "schema")).toEqual(["a#b.sql"]);
  });
});
