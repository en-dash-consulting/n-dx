import { describe, expect, it } from "vitest";
import { dynamicImportsNotice, type DynamicImport } from "../../src/python-notices.js";
import { stringLiteralValue } from "../../src/python-symbols.js";

const at = (line: number): DynamicImport => ({ path: "a.py", position: { line, column: 0 }, callee: "__import__" });

describe("dynamicImportsNotice", () => {
  it("says nothing when there are none", () => {
    expect(dynamicImportsNotice([])).toBeUndefined();
  });

  it("names one", () => {
    expect(dynamicImportsNotice([at(3)])).toBe(
      "Python: 1 dynamic import names its module at run time and is not an import fact: a.py:3 (__import__).",
    );
  });

  it("names five and counts the rest", () => {
    expect(dynamicImportsNotice([1, 2, 3, 4, 5, 6, 7].map(at))).toBe(
      "Python: 7 dynamic imports name their module at run time and are not import facts: " +
        "a.py:1 (__import__), a.py:2 (__import__), a.py:3 (__import__), a.py:4 (__import__), a.py:5 (__import__), and 2 more.",
    );
  });
});

describe("stringLiteralValue", () => {
  it.each([
    ['"a"', "a"],
    ["'a'", "a"],
    ['u"a"', "a"],
    ["r'a'", "a"],
    ['"""a"""', "a"],
    ['""', ""],
  ])("reads %s", (text, value) => {
    expect(stringLiteralValue(text)).toBe(value);
  });

  it.each(['f"a"', 'b"a"', '"a\\n"', "name", '"a" "b"'])("refuses %s", (text) => {
    expect(stringLiteralValue(text)).toBeUndefined();
  });
});
