import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPhpEmbeddedSql, PHP_SQL_FUNCTIONS, PHP_SQL_METHODS, sqlOperands } from "../../src/index.js";

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
