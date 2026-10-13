/**
 * The Go pack's queries, asserted directly on small sources so each rule
 * is pinned independently of the regenerable goldens.
 */

import { existsSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

import { grammarWasmPath } from "../../../lang-runtime/scripts/build-grammars.mjs";
import { goPack } from "../../src/language/go-pack.js";
import { goResolver } from "../../src/language/go-resolver.js";
import {
  createTreeSitterRunner,
  fixtureDirFor,
  goldenPathFor,
  skipUnlessGrammar,
  type Capture,
  type PackGolden,
  type ParsedFile,
} from "@n-dx/lang-runtime";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

const GO_WASM = grammarWasmPath("tree-sitter-go");
const target = { pack: goPack, grammarPath: GO_WASM };
const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

async function parse(ctx: Parameters<typeof skipUnlessGrammar>[0], source: string): Promise<ParsedFile> {
  skipUnlessGrammar(ctx, GO_WASM);
  const result = await runner.parseSource(target, "t.go", source);
  if (result.status !== "parsed") throw new Error("expected a parsed file");
  expect(result.hasErrorNodes || result.hasMissingNodes).toBe(false);
  return result;
}

const texts = (captures: readonly Capture[] | undefined, name: string): string[] =>
  (captures ?? []).filter((c) => c.name === name).map((c) => c.text);

const lines = (captures: readonly Capture[] | undefined, name: string): number[] =>
  (captures ?? []).filter((c) => c.name === name).map((c) => c.start.line);

type Pos = Capture["start"];
const atOrBefore = (a: Pos, b: Pos): boolean => a.line < b.line || (a.line === b.line && a.column <= b.column);

/** The innermost @call.arguments containing `s` — the documented pairing rule. */
function innermostArguments(calls: readonly Capture[], s: Capture): Capture | undefined {
  return calls
    .filter((c) => c.name === "call.arguments" && atOrBefore(c.start, s.start) && atOrBefore(s.end, c.end))
    .sort((p, q) => (atOrBefore(p.start, q.start) ? 1 : -1))[0];
}

/**
 * Parenthesis depth inside `list`'s text just before `s`, skipping string and
 * rune literals and comments. 1 means `s` is a direct argument of `list`'s
 * own call; more means it sits in a nested call whose list was not captured.
 */
function parenDepthBefore(list: Capture, s: Capture): number {
  const rows = list.text.split("\n");
  const rel = s.start.line - list.start.line;
  const end =
    rel === 0
      ? s.start.column - list.start.column
      : rows.slice(0, rel).reduce((n, r) => n + r.length + 1, 0) + s.start.column;
  const t = list.text;
  let depth = 0;
  for (let i = 0; i < end; i++) {
    const ch = t[i];
    if (ch === '"' || ch === "'") {
      for (i++; i < end && t[i] !== ch; i++) if (t[i] === "\\") i++;
    } else if (ch === "`") {
      for (i++; i < end && t[i] !== "`"; i++);
    } else if (ch === "/" && t[i + 1] === "/") {
      for (; i < end && t[i] !== "\n"; i++);
    } else if (ch === "/" && t[i + 1] === "*") {
      for (i += 2; i < end && !(t[i] === "*" && t[i + 1] === "/"); i++);
      i++;
    } else if (ch === "(") depth++;
    else if (ch === ")") depth--;
  }
  return depth;
}

/** Text of the argument list a string argument is paired with, if it is that list's own direct argument. */
function directOwner(calls: readonly Capture[], s: Capture): string | undefined {
  const list = innermostArguments(calls, s);
  return list && parenDepthBefore(list, s) === 1 ? list.text : undefined;
}

describe("go pack", () => {
  it("has every query file and provenance naming the grammar version and a date", () => {
    for (const q of goPack.queries) {
      expect(existsSync(q.path), q.path).toBe(true);
      const p = goPack.provenance[q.name]!;
      expect(p.verifiedAgainst).toContain(`tree-sitter-go@${goPack.grammar.version}`);
      expect(p.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(goPack.queries.map((q) => q.name)).toEqual([
      "packages",
      "imports",
      "types",
      "functions",
      "methods",
      "calls",
      "struct-tags",
    ]);
  });

  it("carries the Go resolver, so it enters the imports phase", () => {
    expect(goPack.resolver).toBe(goResolver);
  });

  it("reads the package clause", async (ctx) => {
    const { captures } = await parse(ctx, "package orders\n");
    expect(texts(captures.packages, "package.name")).toEqual(["orders"]);
  });

  it("reads every import form, single and grouped", async (ctx) => {
    const { captures } = await parse(
      ctx,
      'package p\nimport "a"\nimport (\n\t"b"\n\tx "c"\n\t. "d"\n\t_ "e"\n\t`f`\n)\n',
    );
    const imports = captures.imports;
    expect(texts(imports, "import.name")).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(texts(imports, "import.alias")).toEqual(["x"]);
    expect(lines(imports, "import.alias")).toEqual([5]);
    expect(lines(imports, "import.dot")).toEqual([6]);
    expect(lines(imports, "import.blank")).toEqual([7]);
    expect(lines(imports, "import.spec")).toEqual([2, 4, 5, 6, 7, 8]);
  });

  it("captures struct, interface and alias declarations with spans; generics included", async (ctx) => {
    const { captures } = await parse(
      ctx,
      "package p\ntype S struct {\n\tA int\n}\ntype I interface {\n\tM()\n}\ntype A = S\ntype G[T any] struct{}\ntype ID int\ntype (\n\tB struct{}\n)\n",
    );
    const kinds = captures.types!.filter((c) => c.name.match(/^type\.(struct|interface|alias)$/));
    expect(kinds.map((c) => [c.name, c.start.line, c.end.line])).toEqual([
      ["type.struct", 2, 4],
      ["type.interface", 5, 7],
      ["type.alias", 8, 8],
      ["type.struct", 9, 9],
      ["type.struct", 12, 12],
    ]);
    expect(texts(captures.types, "type.name")).toEqual(["S", "I", "A", "G", "B"]);
    expect(texts(captures.types, "type.parameters")).toEqual(["[T any]"]);
  });

  it("gives functions start and end lines", async (ctx) => {
    const { captures } = await parse(
      ctx,
      "package p\nfunc a() {}\nfunc b[T any](x T) T {\n\treturn x\n}\n",
    );
    const spans = captures.functions!
      .filter((c) => c.name === "function.declaration")
      .map((c) => [c.start.line, c.end.line]);
    expect(spans).toEqual([[2, 2], [3, 5]]);
    expect(texts(captures.functions, "function.name")).toEqual(["a", "b"]);
    expect(texts(captures.functions, "function.parameters")).toEqual(["[T any]"]);
  });

  it("gives methods receiver types, pointer-ness and start and end lines", async (ctx) => {
    const { captures } = await parse(
      ctx,
      "package p\nfunc (s *S) A() {}\nfunc (S) B() {\n}\nfunc (g G[T]) C() {}\nfunc (g *G[T]) D() {}\n",
    );
    const methods = captures.methods!;
    expect(texts(methods, "method.name")).toEqual(["A", "B", "C", "D"]);
    expect(methods.filter((c) => c.name === "method.declaration").map((c) => [c.start.line, c.end.line])).toEqual([
      [2, 2],
      [3, 4],
      [5, 5],
      [6, 6],
    ]);
    expect(texts(methods, "method.receiver")).toEqual(["*S", "S", "G[T]", "*G[T]"]);
    expect(texts(methods, "method.receiver_type")).toEqual(["S", "S", "G", "G"]);
    expect(lines(methods, "method.pointer")).toEqual([2, 6]);
  });

  it("gives calls their receiver and string arguments, nested calls apart", async (ctx) => {
    const { captures } = await parse(
      ctx,
      'package p\nfunc m() {\n\ta.b.c("x", `y`, 1)\n\tlocal()\n\tf(g("z"))\n}\n',
    );
    const calls = captures.calls!;
    expect(texts(calls, "call.receiver")).toEqual(["a.b"]);
    expect(texts(calls, "call.name")).toEqual(["c", "local", "f", "g"]);
    expect(texts(calls, "call.string_argument")).toEqual(['"x"', "`y`", '"z"']);

    // A string belongs to the innermost argument list that contains it.
    const z = calls.find((c) => c.text === '"z"')!;
    const owner = calls
      .filter((c) => c.name === "call.arguments" && c.start.line === z.start.line)
      .filter((c) => c.start.column <= z.start.column && c.end.column >= z.end.column)
      .sort((p, q) => q.start.column - p.start.column)[0]!;
    expect(owner.text).toBe('("z")');
  });

  it("gives calls whose function is not a name an argument list of their own", async (ctx) => {
    const { captures } = await parse(
      ctx,
      [
        "package p",
        "func m() {",
        '\tlog(f()("z"))',
        '\tlog(h[0]("a"))',
        '\tlog(fs[i+1]("b"))',
        '\tlog(v.(func(string))("c"))',
        '\tlog((fn)("d"))',
        '\tlog(func(s string) {}("e"))',
        '\tlog(h[k]("t1"))',
        '\tlog(pkg.F[int]("t2"))',
        "}",
        "",
      ].join("\n"),
    );
    const calls = captures.calls!;
    const owner = (arg: string): string | undefined =>
      directOwner(calls, calls.find((c) => c.name === "call.string_argument" && c.text === arg)!);
    expect(owner('"z"')).toBe('("z")');
    expect(owner('"a"')).toBe('("a")');
    expect(owner('"b"')).toBe('("b")');
    expect(owner('"c"')).toBe('("c")');
    expect(owner('"d"')).toBe('("d")');
    expect(owner('"e"')).toBe('("e")');
    // Where the index could be a type, tree-sitter-go parses a type
    // conversion: no argument_list, so no string to hand to log.
    expect(texts(calls, "call.string_argument")).not.toContain('"t1"');
    expect(texts(calls, "call.string_argument")).not.toContain('"t2"');
  });

  it("golden: every string argument is a direct argument of its paired argument list", () => {
    const golden = JSON.parse(readFileSync(goldenPathFor(fixtureDirFor(PACK_FIXTURE_ROOT, goPack)), "utf8")) as PackGolden;
    let checked = 0;
    for (const file of golden.files) {
      const calls = (file.captures as Record<string, Capture[]> | undefined)?.calls ?? [];
      for (const s of calls.filter((c) => c.name === "call.string_argument")) {
        expect(directOwner(calls, s), `${file.path}:${s.start.line} ${s.text}`).toBeDefined();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("captures struct field tags as written, per name, skipping untagged fields", async (ctx) => {
    const { captures } = await parse(
      ctx,
      'package p\ntype S struct {\n\tA int `json:"a"`\n\tB, C int `json:"bc"`\n\tD int\n\tE string "x"\n\tEmbedded `json:"emb"`\n}\n',
    );
    const tags = captures["struct-tags"];
    expect(texts(tags, "field.name")).toEqual(["A", "B", "C", "E"]);
    expect(texts(tags, "field.tag")).toEqual(['`json:"a"`', '`json:"bc"`', '`json:"bc"`', '"x"', '`json:"emb"`']);
  });
});
