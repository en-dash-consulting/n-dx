import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../../../lang-kit/tests/helpers/call-within-budget.js";
import { extractPhpEmbeddedSql, PHP_SQL_FUNCTIONS, PHP_SQL_METHODS, scrubPlaceholders, selectColumns, sqlOperands } from "../../src/index.js";

const SQL = new URL("../../src/php-sql.ts", import.meta.url);
const MIB = 1024 * 1024;

const query = readFileSync(join(import.meta.dirname, "..", "..", "queries", "php", "sql.scm"), "utf8");

/** Every `#match?` regex the query gives `@sql.name`, as tree-sitter compiles them. */
const predicates = [...query.matchAll(/\(#match\? @sql\.name "((?:[^"\\]|\\.)*)"\)/g)].map((m) => new RegExp(JSON.parse(`"${m[1]}"`) as string));

describe("php sql query", () => {
  it("matches every query function, in any case and with a leading \\", () => {
    const [functions] = predicates;
    for (const name of PHP_SQL_FUNCTIONS) {
      expect(functions!.test(name), name).toBe(true);
      expect(functions!.test(name.toUpperCase()), name).toBe(true);
      expect(functions!.test(`\\${name}`), name).toBe(true);
    }
    expect(functions!.test("mysql_connect")).toBe(false);
  });

  it("matches every query method on member, nullsafe and scoped calls alike, in any case", () => {
    const methods = predicates.slice(1);
    expect(methods).toHaveLength(3);
    for (const re of methods) {
      expect(re.source).toBe(methods[0]!.source);
      for (const name of PHP_SQL_METHODS) {
        expect(re.test(name), name).toBe(true);
        expect(re.test(name.toUpperCase()), name).toBe(true);
      }
      expect(re.test("execute")).toBe(false);
    }
  });
});

describe("sqlOperands", () => {
  it("splits a concatenation, keeping strings and heredocs whole", () => {
    expect(sqlOperands("'SELECT a.b' . $x . \"c.d\"")?.map((o) => o.text)).toEqual(["'SELECT a.b'", "$x", '"c.d"']);
    expect(sqlOperands("<<<SQL\nSELECT 'x.y' FROM t\nSQL . ' LIMIT 1'")?.map((o) => o.text)).toEqual(["<<<SQL\nSELECT 'x.y' FROM t\nSQL", "' LIMIT 1'"]);
  });

  it("gives each operand's offset", () => {
    expect(sqlOperands("'a' .\n  'b'")?.map((o) => o.offset)).toEqual([0, 8]);
  });

  it("is undefined for another operator at the top level", () => {
    expect(sqlOperands("$a ?: 'SELECT 1'")).toBeUndefined();
    expect(sqlOperands("'SELECT ' + 1")).toBeUndefined();
    expect(sqlOperands("'unterminated")).toBeUndefined();
  });
});

describe("extractPhpEmbeddedSql", () => {
  it("reads nothing from a file without query calls", () => {
    expect(extractPhpEmbeddedSql([{ path: "a.php", captures: {} }])).toEqual([]);
  });
});

describe("scrubPlaceholders", () => {
  const P = "\u0000";
  // The regex it replaced, which was quadratic in a run of name characters.
  const byRegex = (text: string): string => text.replace(/[\w$.`{}]*\u0000[\w$.`{}]*/g, " ? ");

  it.each([
    "SELECT * FROM users",
    `SELECT * FROM users_${P}`,
    `SELECT * FROM {${P}}.orders WHERE id = 1`,
    `INSERT INTO archive_${P}_x (a) VALUES (1)`,
    `SELECT ${P}`,
    P,
    `${P}${P}`,
    `a${P}b${P}c`,
    `a${P}b c${P}d e`,
    `x.\`y\`$${P}-z`,
    `SELECT a FROM t WHERE b = 'é${P}é'`,
  ])("replaces each placeholder and the name it touches as the regex did: %j", (text) => {
    expect(scrubPlaceholders(text)).toBe(byRegex(text));
  });

  it.each([
    ["without a placeholder", `INSERT INTO blobs (b) VALUES (0x${"a".repeat(MIB)})`],
    ["with a placeholder", `INSERT INTO blobs (b) VALUES (0x${"a".repeat(MIB)}${P}${"b".repeat(MIB)})`],
  ])("stays linear on a 1 MiB run of word characters %s", async (_, text) => {
    const out = await callWithinBudget<typeof scrubPlaceholders>(SQL, "scrubPlaceholders", text);
    expect(out.startsWith("INSERT INTO blobs (b) VALUES (")).toBe(true);
  }, BOUNDED_TEST_TIMEOUT_MS);
});

describe("selectColumns", () => {
  const columns = (sql: string, ...tables: string[]) => selectColumns(sql, tables.map((name) => ({ name })));

  it("names plain columns of a literal SELECT list by their table", () => {
    expect(columns("SELECT handler FROM pages WHERE slug = 'x'", "pages")).toEqual(["pages.handler"]);
    expect(columns("select distinct `p`.`handler` as h, p.title t FROM pages p", "pages")).toEqual(["pages.handler", "pages.title"]);
    // Two tables: an alias names neither, so nothing is guessed.
    expect(columns("SELECT p.handler, u.name FROM pages p JOIN users u ON u.id = p.owner", "pages", "users")).toEqual([]);
    expect(columns("SELECT pages.handler, users.name, id FROM pages JOIN users ON users.id = pages.owner", "pages", "users")).toEqual(["pages.handler", "users.name"]);
  });

  it("names none for *, functions, expressions, a list holding a placeholder or a statement with no list", () => {
    expect(columns("SELECT * FROM menu_router", "menu_router")).toEqual([]);
    expect(columns("SELECT p.*, COUNT(*), a + b FROM pages p", "pages")).toEqual([]);
    expect(columns("SELECT  ?  FROM pages", "pages")).toEqual([]);
    expect(columns("UPDATE pages SET handler = 'x'", "pages")).toEqual([]);
    expect(columns("SELECT handler", "pages")).toEqual([]);
  });

  it("stays linear on a 1 MiB SELECT list", async () => {
    const sql = `SELECT ${"a, ".repeat(MIB / 4)}b FROM t`;
    const out = await callWithinBudget<typeof selectColumns>(SQL, "selectColumns", sql, [{ name: "t" }]);
    expect(out).toEqual(["t.a", "t.b"]);
  }, BOUNDED_TEST_TIMEOUT_MS);
});
