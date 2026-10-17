/**
 * Table names from sqlc query files found the way the migration detector
 * finds them. SQL embedded in Java and Go sources is tested in the
 * `@n-dx/lang-java` and `@n-dx/lang-go` packs.
 */

import { describe, expect, it } from "vitest";

import { extractSqlcTables, type EmbeddedSqlTable } from "@n-dx/lang-kit";
import { detectMigrationTools } from "../../src/language/sql-migrations.js";

const summary = (tables: readonly EmbeddedSqlTable[]): string[] =>
  tables.map((t) => `${t.schema ? `${t.schema}.` : ""}${t.name} ${t.via} ${t.path}:${t.line}`);

describe("sqlc query files", () => {
  it("reads the query files the sqlc config names", () => {
    const project: Record<string, string> = {
      "sqlc.yaml": "version: '2'\nsql:\n  - queries: db/query\n    schema: db/schema.sql\n    engine: postgresql\n",
      "db/query/authors.sql": "-- name: GetAuthor :one\nSELECT * FROM authors WHERE id = $1;\n",
      "db/query/books.sql": "-- name: ListBooks :many\nSELECT * FROM books b JOIN authors a ON a.id = b.author_id;\n",
      "db/schema.sql": "CREATE TABLE authors (id int);",
    };
    const sqlc = detectMigrationTools(Object.keys(project), (path) => project[path]).find((f) => f.tool === "sqlc");
    expect(sqlc?.sqlFiles).toEqual(["db/schema.sql"]);
    expect(sqlc?.queryFiles).toEqual(["db/query/authors.sql", "db/query/books.sql"]);
    const tables = sqlc!.queryFiles!.flatMap((path) => extractSqlcTables(path, project[path]!));
    expect(summary(tables)).toEqual([
      "authors sqlc GetAuthor db/query/authors.sql:2",
      "books sqlc ListBooks db/query/books.sql:2",
      "authors sqlc ListBooks db/query/books.sql:2",
    ]);
  });
});
