import { describe, expect, it } from "vitest";

import { TomlSyntaxError, parseToml, parseTomlLocated } from "../../src/toml-lite.js";

describe("toml-lite: pyproject forms", () => {
  it("reads arrays of tables, and a later table header under the last one", () => {
    expect(parseToml('[[tool.mypy.overrides]]\nmodule = "a"\n[[tool.mypy.overrides]]\nmodule = "b"\n[tool.mypy.overrides.x]\ny = 1\n')).toEqual({
      tool: { mypy: { overrides: [{ module: "a" }, { module: "b", x: { y: 1 } }] } },
    });
  });

  it.each(["a = [{ x = 1 }]\n[[a]]\n", "a = [1]\n[[a]]\nx = 1\n", "a = [{x = 1}]\n[a]\ny = 2\n"])(
    "refuses to extend a static array or its inline table: %j",
    (src) => {
      expect(() => parseToml(src)).toThrow(TomlSyntaxError);
    },
  );

  it.each(['x = "\\UFFFFFFFF"', 'x = "\\u12zz"', 'x = "\\uD800"', 'x = """\\U00110000"""'])("rejects the escape in %s as a syntax error", (src) => {
    expect(() => parseToml(src)).toThrow(TomlSyntaxError);
  });

  it("still reads valid unicode escapes", () => {
    expect(parseToml('x = "\\u00e9\\U0001F600"')).toEqual({ x: "é😀" });
  });

  it("reads multi-line basic and literal strings", () => {
    const doc = parseToml('a = """\nline one\nline \\\n   two"""\nb = \'\'\'\nraw \\n\'\'\'\nc = """say ""hi"""""\nd = 1\n');
    expect(doc).toEqual({ a: "line one\nline two", b: "raw \\n", c: 'say ""hi""', d: 1 });
  });

  it("reads digit separators", () => {
    expect(parseToml("n = 1_000\nf = 3.141_5\n")).toEqual({ n: 1000, f: 3.1415 });
  });

  it("reports the line each value and array item starts on, after multi-line strings", () => {
    const doc = parseTomlLocated('description = """\nmany\nlines"""\n[project]\ndependencies = [\n  "a",\n\n  "b",\n]\n[[t]]\nk = { v = 1 }\n');
    expect(doc.lineOf(["project", "dependencies"])).toBe(5);
    expect(doc.lineOf(["project", "dependencies", 0])).toBe(6);
    expect(doc.lineOf(["project", "dependencies", 1])).toBe(8);
    expect(doc.lineOf(["t", 0])).toBe(10);
    expect(doc.lineOf(["t", 0, "k", "v"])).toBe(11);
    expect(doc.lineOf(["missing"])).toBeUndefined();
  });
});
