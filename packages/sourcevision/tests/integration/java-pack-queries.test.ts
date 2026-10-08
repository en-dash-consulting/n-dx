/**
 * The Java pack's queries, asserted directly on small sources so each rule
 * is pinned independently of the regenerable goldens.
 */

import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

import { grammarWasmPath } from "../../scripts/build-grammars.mjs";
import { javaPack } from "../../src/language/java-pack.js";
import { createTreeSitterRunner, type Capture, type ParsedFile } from "../../src/language/runner.js";
import { skipUnlessGrammar } from "../helpers/grammar.js";

const JAVA_WASM = grammarWasmPath("tree-sitter-java");
const target = { pack: javaPack, grammarPath: JAVA_WASM };
const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

async function parse(ctx: Parameters<typeof skipUnlessGrammar>[0], source: string): Promise<ParsedFile> {
  skipUnlessGrammar(ctx, JAVA_WASM);
  const result = await runner.parseSource(target, "T.java", source);
  if (result.status !== "parsed") throw new Error("expected a parsed file");
  expect(result.hasErrorNodes || result.hasMissingNodes).toBe(false);
  return result;
}

const texts = (captures: readonly Capture[] | undefined, name: string): string[] =>
  (captures ?? []).filter((c) => c.name === name).map((c) => c.text);

describe("java pack", () => {
  it("has every query file and provenance naming the grammar version and a date", () => {
    for (const q of javaPack.queries) {
      expect(existsSync(q.path), q.path).toBe(true);
      const p = javaPack.provenance[q.name]!;
      expect(p.verifiedAgainst).toContain(`tree-sitter-java@${javaPack.grammar.version}`);
      expect(p.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(javaPack.queries.map((q) => q.name)).toEqual([
      "packages",
      "imports",
      "declarations",
      "methods",
      "calls",
      "type-references",
    ]);
  });

  it("reads the package and the three import forms", async (ctx) => {
    const { captures } = await parse(
      ctx,
      "package a.b;\nimport x.Y;\nimport x.z.*;\nimport static x.W.m;\nimport static x.W.*;\nclass C {}\n",
    );
    expect(texts(captures.packages, "package.name")).toEqual(["a.b"]);
    expect(texts(captures.imports, "import.name")).toEqual(["x.Y", "x.z", "x.W.m", "x.W"]);
    expect(captures.imports!.filter((c) => c.name === "import.wildcard").map((c) => c.start.line)).toEqual([3, 5]);
    expect(captures.imports!.filter((c) => c.name === "import.static").map((c) => c.start.line)).toEqual([4, 5]);
  });

  it("captures every kind of type declaration with spans, nested included", async (ctx) => {
    const { captures } = await parse(
      ctx,
      "class A {\n  interface B {}\n  enum C { X }\n  record D(int n) {}\n  @interface E {}\n}\n",
    );
    const kinds = captures.declarations!.filter((c) => c.name !== "type.name");
    expect(kinds.map((c) => [c.name, c.start.line, c.end.line])).toEqual([
      ["type.class", 1, 6],
      ["type.interface", 2, 2],
      ["type.enum", 3, 3],
      ["type.record", 4, 4],
      ["type.annotation", 5, 5],
    ]);
    expect(texts(captures.declarations, "type.name")).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("gives methods and constructors start and end lines", async (ctx) => {
    const { captures } = await parse(
      ctx,
      "class A {\n  A() {}\n  void m() {\n    run();\n  }\n  abstract int n();\n}\nrecord R(int x) {\n  R {\n  }\n}\n",
    );
    const spans = captures.methods!
      .filter((c) => c.name.endsWith(".declaration"))
      .map((c) => [c.name, c.start.line, c.end.line]);
    expect(spans).toEqual([
      ["constructor.declaration", 2, 2],
      ["method.declaration", 3, 5],
      ["method.declaration", 6, 6],
      ["constructor.declaration", 9, 10],
    ]);
  });

  it("gives calls their receiver and string-literal arguments, nested calls apart", async (ctx) => {
    const { captures } = await parse(
      ctx,
      'class A {\n  void m() {\n    a.b().c("x", 1);\n    local();\n    f(g("y"));\n    log("""\n      t\n      """);\n  }\n}\n',
    );
    const calls = captures.calls!;
    expect(texts(calls, "call.receiver")).toEqual(["a.b()", "a"]);
    expect(texts(calls, "call.name")).toEqual(["b", "c", "local", "f", "g", "log"]);
    expect(texts(calls, "call.string_argument")).toEqual(['"x"', '"y"', '"""\n      t\n      """']);

    // A string belongs to the innermost argument list that contains it.
    const y = calls.find((c) => c.text === '"y"')!;
    const owner = calls
      .filter((c) => c.name === "call.arguments" && c.start.line === y.start.line)
      .filter((c) => c.start.column <= y.start.column && c.end.column >= y.end.column)
      .sort((p, q) => q.start.column - p.start.column)[0]!;
    expect(owner.text).toBe('("y")');
  });

  it("captures type references by position", async (ctx) => {
    const { captures } = await parse(
      ctx,
      "@Entity class A<T> extends B<T> implements C, p.D {\n" +
        "  Map<String, E> f;\n" +
        "  F m(G g, H... hs) { return new I<>(); }\n" +
        "}\n" +
        "interface J extends K, L {}\n",
    );
    const refs = captures["type-references"]!;
    const by = (name: string): string[] => texts(refs, `typeref.${name}`);
    expect(by("annotation")).toEqual(["Entity"]);
    expect(by("extends")).toEqual(["B<T>", "K", "L"]);
    expect(by("implements")).toEqual(["C", "p.D"]);
    expect(by("field")).toEqual(["Map<String, E>"]);
    expect(by("parameter")).toEqual(["G", "H"]);
    expect(by("return")).toEqual(["F"]);
    expect(by("new")).toEqual(["I<>"]);
    expect(by("name")).toContain("String");
  });

  it("captures scoped type names and field-access qualifiers", async (ctx) => {
    const { captures } = await parse(
      ctx,
      "class A {\n  java.util.List<Map.Entry<K, V>> f;\n  Object g = Status.OPEN;\n  int h = this.n;\n}\n",
    );
    const refs = captures["type-references"]!;
    expect(texts(refs, "typeref.qualified")).toEqual(["java.util.List", "java.util", "Map.Entry"]);
    expect(texts(refs, "typeref.qualifier")).toEqual(["Status"]);
  });
});
