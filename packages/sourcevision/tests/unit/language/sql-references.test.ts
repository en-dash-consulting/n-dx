import { describe, expect, it } from "vitest";

import { extractSqlTableReferences, extractSqlcTables, looksLikeSql } from "../../../src/language/sql-references.js";

const names = (sql: string): string[] =>
  extractSqlTableReferences(sql).map((ref) => (ref.schema ? `${ref.schema}.${ref.name}` : ref.name));

describe("extractSqlTableReferences", () => {
  it("reads FROM lists, joins, aliases and qualified or quoted names", () => {
    expect(names("SELECT * FROM owners o, pets AS p JOIN visits v ON v.pet_id = p.id")).toEqual([
      "owners",
      "pets",
      "visits",
    ]);
    expect(names('select 1 from public."Owners" left outer join `db`.`pets` using (id)')).toEqual([
      "public.Owners",
      "db.pets",
    ]);
  });

  it("reads write statements", () => {
    expect(names("INSERT INTO owners (id, name) VALUES (1, 'a')")).toEqual(["owners"]);
    expect(names("UPDATE ONLY pets SET name = 'x'")).toEqual(["pets"]);
    expect(names("DELETE FROM visits WHERE id = 1")).toEqual(["visits"]);
    expect(names("TRUNCATE TABLE types")).toEqual(["types"]);
    expect(names("MERGE INTO t USING s ON t.id = s.id")).toEqual(["t"]);
  });

  it("ignores what only looks like a table", () => {
    expect(names("select extract(year from born) from owners")).toEqual(["owners"]);
    expect(names("select trim(both 'x' from name) from owners")).toEqual(["owners"]);
    expect(names("select * from owners for update")).toEqual(["owners"]);
    expect(names("select * from owners where a is not distinct from b")).toEqual(["owners"]);
    expect(names("insert into t (id) values (1) on conflict (id) do update set id = 2")).toEqual(["t"]);
    expect(names("select * from generate_series(1, 3) g")).toEqual([]);
    expect(names("select * from (select * from inner_t) x")).toEqual(["inner_t"]);
    expect(names("select 1 from dual")).toEqual([]);
    expect(names("select * from t where note = 'from nowhere' -- from comment\n/* join ghost */")).toEqual(["t"]);
    expect(names('{"from": "x"}')).toEqual([]);
  });

  it("does not count CTE names as tables", () => {
    expect(
      names("with recent as (select * from visits), pet_ids(id) as (select id from pets) select * from recent join pet_ids"),
    ).toEqual(["visits", "pets"]);
  });

  it("reads JPQL entities and skips paths from an alias", () => {
    expect(names("select o from Owner o left join fetch o.pets p where p.name = :n")).toEqual(["Owner"]);
    expect(names("select p from com.example.Pet p, in(p.visits) v")).toEqual(["example.Pet"]);
  });

  it("reads the table inside sqlc.embed", () => {
    expect(names("SELECT sqlc.embed(authors), b.* FROM books b")).toEqual(["authors", "books"]);
  });

  it("reports the file line, given the line the statement starts on", () => {
    const lines = extractSqlTableReferences("select *\nfrom a\njoin b", 10).map((ref) => [ref.name, ref.line]);
    expect(lines).toEqual([
      ["a", 11],
      ["b", 12],
    ]);
  });
});

describe("looksLikeSql", () => {
  it("accepts statements and rejects other strings", () => {
    expect(looksLikeSql("  -- c\nSELECT 1")).toBe(true);
    expect(looksLikeSql("(select 1) union (select 2)")).toBe(true);
    expect(looksLikeSql("with x as (select 1) select * from x")).toBe(true);
    expect(looksLikeSql("https://example.com/select")).toBe(false);
    expect(looksLikeSql("from Owner")).toBe(false);
  });
});

describe("extractSqlcTables", () => {
  it("reads each named query, with its file line", () => {
    const content = [
      "-- name: GetAuthor :one",
      "SELECT * FROM authors",
      "WHERE id = $1;",
      "",
      "-- name: ListBooks :many",
      "SELECT sqlc.embed(authors), b.*",
      "FROM books b JOIN authors a ON a.id = b.author_id;",
    ].join("\n");
    expect(extractSqlcTables("db/query.sql", content).map((t) => [t.name, t.line, t.via])).toEqual([
      ["authors", 2, "sqlc GetAuthor"],
      ["authors", 6, "sqlc ListBooks"],
      ["books", 7, "sqlc ListBooks"],
    ]);
  });

  it("ignores SQL before the first named query", () => {
    expect(extractSqlcTables("q.sql", "select * from ghost;\n-- name: A :one\nselect 1 from t;")).toHaveLength(1);
  });
});
