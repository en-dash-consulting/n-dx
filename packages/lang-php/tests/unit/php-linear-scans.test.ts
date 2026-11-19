/**
 * The scans that replaced the regexes CodeQL flagged as polynomial
 * (js/polynomial-redos #127–#134): the same results, linear time on the
 * pathological input, and configuration lines past 64 KiB skipped and counted.
 */

import { describe, expect, it } from "vitest";
import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../../../lang-kit/tests/helpers/call-within-budget.js";
import { parsePhpIncludeConfig } from "../../src/index.js";
import { MAX_CONFIG_LINE_LENGTH } from "../../src/php-line-cap.js";

const INCLUDES = new URL("../../src/php-includes.ts", import.meta.url);

/**
 * Sizes at which each replaced regex overruns the call budget (5 s by default)
 * many times over, so restoring one fails its test. One configuration line
 * stays under the 64 KiB cap, where a regex took 2.6–4.4 s, inside the budget,
 * so the line tests repeat it {@link LINES} times.
 */
const LONG = 60_000;
const LINES = 10;

/** `line` as {@link LINES} lines of one file. */
const repeated = (line: string): string => Array.from({ length: LINES }, () => line).join("\n");

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
      const text = repeated(`php_value include_path ${value}`);
      const out = await callWithinBudget<typeof parsePhpIncludeConfig>(INCLUDES, "parsePhpIncludeConfig", ".htaccess", ".htaccess", text);
      expect(out.settings.map((s) => s.value)).toEqual(Array(LINES).fill(value));
    },
    BOUNDED_TEST_TIMEOUT_MS,
  );

  // #132: white space, a character, then a line terminator the value cannot hold.
  it(
    "runs in linear time on a long ini line that is not a setting",
    async () => {
      const text = repeated(`include_path =${" ".repeat(LONG)}x\r!`);
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
      const text = repeated(`include_path = ${value}`);
      const out = await callWithinBudget<typeof parsePhpIncludeConfig>(INCLUDES, "parsePhpIncludeConfig", "php.ini", "php.ini", text);
      expect(out.settings.map((s) => s.value)).toEqual(Array(LINES).fill(value));
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
