/**
 * The scans that replaced the regexes CodeQL flagged as polynomial
 * (js/polynomial-redos #127–#134): the same results, linear time on the
 * pathological input, and configuration lines past 64 KiB skipped and counted.
 */

import { describe, expect, it } from "vitest";
import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../../../lang-kit/tests/helpers/call-within-budget.js";
import { connectionKeyValues, htaccessWords, isCliCheck, parseHtaccess, parsePhpIncludeConfig, splitComparison } from "../../src/index.js";
import { MAX_CONFIG_LINE_LENGTH } from "../../src/php-line-cap.js";

const HTACCESS = new URL("../../src/php-htaccess.ts", import.meta.url);
const INCLUDES = new URL("../../src/php-includes.ts", import.meta.url);
const ENTRY_POINTS = new URL("../../src/php-entry-points.ts", import.meta.url);
const OUTBOUND = new URL("../../src/php-outbound.ts", import.meta.url);

/** Long enough to stall a quadratic pattern, short enough to stay under the line cap. */
const LONG = 60_000;

describe("htaccessWords", () => {
  it("splits on white space, keeps a quoted word whole and unescapes only \\\"", () => {
    expect(htaccessWords('RewriteRule ^(.*)$ "a \\"b\\" \\d" [L]')).toEqual(["RewriteRule", "^(.*)$", 'a "b" \\d', "[L]"]);
    expect(htaccessWords('<Files "*.ini">')).toEqual(["<Files", "*.ini", ">"]);
    expect(htaccessWords('x"a b"y')).toEqual(['x"a', 'b"y']);
  });

  it("reads a quote with no closing quote as the start of a plain word", () => {
    expect(htaccessWords('Deny "from all')).toEqual(["Deny", '"from', "all"]);
    expect(htaccessWords('"a "b "c')).toEqual(["a ", "b", '"c']);
  });

  // #127, #128: CodeQL's input, a quote then a long `\"!` run with no closing quote; and many unclosed quotes.
  it(
    "runs in linear time on long unclosed quoted words",
    async () => {
      const escaped = `"${'\\"!'.repeat(LONG / 3)}`;
      expect(await callWithinBudget<typeof htaccessWords>(HTACCESS, "htaccessWords", escaped)).toEqual([escaped]);
      const unclosed = `${'"a\\\r '.repeat(LONG / 5)}`;
      expect((await callWithinBudget<typeof htaccessWords>(HTACCESS, "htaccessWords", unclosed)).length).toBe(LONG / 5);
    },
    BOUNDED_TEST_TIMEOUT_MS,
  );
});

describe("parsePhpIncludeConfig", () => {
  it("reads a blank .htaccess value as empty, and rejects a name with no value", () => {
    const values = (kind: Parameters<typeof parsePhpIncludeConfig>[1], text: string): string[] =>
      parsePhpIncludeConfig("x", kind, text).settings.map((c) => c.value);
    expect(values(".htaccess", "php_value include_path   ")).toEqual([""]);
    expect(values(".htaccess", "php_value include_path ")).toEqual([]);
    expect(values(".htaccess", "php_value include_pathx lib")).toEqual([]);
    expect(values("php.ini", "include_path=\"a;b\" ; c")).toEqual(["a;b"]);
    expect(values("php.ini", "include_path = 'a ; b")).toEqual(["'a"]);
    expect(values("php.ini", "include_path_x = a")).toEqual([]);
  });

  // #131: a value holding a long run of spaces, then a character that is not one.
  it(
    "runs in linear time on a long .htaccess value",
    async () => {
      const value = `x${" ".repeat(LONG)}y`;
      const out = await callWithinBudget<typeof parsePhpIncludeConfig>(INCLUDES, "parsePhpIncludeConfig", ".htaccess", ".htaccess", `php_value include_path ${value}`);
      expect(out.settings.map((s) => s.value)).toEqual([value]);
    },
    BOUNDED_TEST_TIMEOUT_MS,
  );

  // #132: white space, a character, then a line terminator the value cannot hold.
  it(
    "runs in linear time on a long ini line that is not a setting",
    async () => {
      const text = `include_path =${" ".repeat(LONG)}x\r!`;
      const out = await callWithinBudget<typeof parsePhpIncludeConfig>(INCLUDES, "parsePhpIncludeConfig", "php.ini", "php.ini", text);
      expect(out.settings).toEqual([]);
    },
    BOUNDED_TEST_TIMEOUT_MS,
  );

  // #133: a long run of white space inside an unquoted value with no `;`.
  it(
    "runs in linear time on a long unquoted ini value",
    async () => {
      const value = `a${" ".repeat(LONG)}b`;
      const out = await callWithinBudget<typeof parsePhpIncludeConfig>(INCLUDES, "parsePhpIncludeConfig", "php.ini", "php.ini", `include_path = ${value}`);
      expect(out.settings.map((s) => s.value)).toEqual([value]);
    },
    BOUNDED_TEST_TIMEOUT_MS,
  );

  it("skips a line longer than 64 KiB and counts it in a notice", () => {
    const long = `include_path = "${"a".repeat(MAX_CONFIG_LINE_LENGTH)}"`;
    const out = parsePhpIncludeConfig("conf/php.ini", "php.ini", `${long}\ninclude_path = lib\n${long}\n`);
    expect(out.settings.map((s) => s.value)).toEqual(["lib"]);
    expect(out.notices).toEqual(["conf/php.ini: skipped 2 lines longer than 64 KiB; any include_path settings there are not read."]);
  });
});

describe("parseHtaccess", () => {
  it("skips a line longer than 64 KiB and counts it in a notice", () => {
    const h = parseHtaccess("a/.htaccess", `Deny from all ${"x".repeat(MAX_CONFIG_LINE_LENGTH)}\nOptions -Indexes\n`);
    expect(h.access).toBeUndefined();
    expect(h.notices).toEqual(["a/.htaccess: skipped 1 line longer than 64 KiB; any access and rewrite rules there are not read."]);
  });
});

describe("splitComparison", () => {
  it("splits at the first operator, the longer one where two start together", () => {
    expect(splitComparison("PHP_SAPI !== 'cli'")).toEqual(["PHP_SAPI", "'cli'"]);
    expect(splitComparison("a == b === c")).toEqual(["a", "b === c"]);
    expect(splitComparison("a <> b")).toEqual(["a", "b"]);
    expect(splitComparison("a . b")).toBeUndefined();
  });

  // #129: a long run of white space between operands that never reaches an operator.
  it(
    "runs in linear time on a long run of white space",
    async () => {
      const text = `PHP_SAPI${" ".repeat(LONG)}x=`;
      expect(await callWithinBudget<typeof isCliCheck>(ENTRY_POINTS, "isCliCheck", text)).toBe(false);
    },
    BOUNDED_TEST_TIMEOUT_MS,
  );
});

describe("connectionKeyValues", () => {
  it("reads key=value pairs separated by ; or white space, the first of a key kept", () => {
    const pairs = (text: string) => Object.fromEntries(connectionKeyValues(text));
    expect(pairs("host=db port=5432 dbname='app'")).toEqual({ host: "db", port: "5432", dbname: "app" });
    expect(pairs("Data Source = srv;Initial Catalog=x;host=a;HOST=b")).toEqual({ "data source": "srv", "initial catalog": "x", host: "a" });
    // A tab breaks a key: it starts at the next letter.
    expect(pairs("a\tb c=1")).toEqual({ "b c": "1" });
    expect(pairs("x=\"unclosed y=2")).toEqual({ x: '"unclosed', y: "2" });
  });

  // #134: a long run of key characters with no `=`.
  it(
    "runs in linear time on a long run of key characters",
    async () => {
      const text = `${"a ".repeat(LONG / 2)};host=db`;
      const out = await callWithinBudget<typeof connectionKeyValues>(OUTBOUND, "connectionKeyValues", text);
      expect([...out]).toEqual([["host", "db"]]);
    },
    BOUNDED_TEST_TIMEOUT_MS,
  );
});
