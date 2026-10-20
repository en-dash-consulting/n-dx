/**
 * Table-name extraction through the tree-sitter-sql grammar built by
 * `pnpm --filter @n-dx/lang-sql build:grammars` (those tests skip when it is
 * not built).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTreeSitterRunner, skipUnlessGrammar, type TreeSitterRunner } from "@n-dx/lang-runtime";
import { sqlGrammarPath } from "../../src/sql-pack.js";
import { extractSqlTables, splitSqlName, sqlTarget } from "../../src/sql-schema.js";

describe("splitSqlName", () => {
  it("strips quoting and splits on dots outside quotes", () => {
    expect(splitSqlName('public."Own.ers"')).toEqual(["public", "Own.ers"]);
    expect(splitSqlName("`db`.`t`")).toEqual(["db", "t"]);
    expect(splitSqlName("[dbo].[t]")).toEqual(["dbo", "t"]);
    expect(splitSqlName("plain")).toEqual(["plain"]);
  });
});

describe("extractSqlTables", () => {
  const wasm = sqlGrammarPath();
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
