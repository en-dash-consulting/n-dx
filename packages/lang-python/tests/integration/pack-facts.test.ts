/**
 * The Python pack's captures read into lang-kit facts, and the pack entry run
 * over a project: each fact says what the captures mean.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SourcePosition } from "@n-dx/lang-kit";

import {
  createTreeSitterRunner,
  factGaps,
  readPackFacts,
  skipUnlessGrammar,
  type PackSourceFile,
  type ReadFactsOptions,
} from "@n-dx/lang-runtime";
import { pack } from "../../src/pack.js";
import { pythonGrammarPath, pythonPack } from "../../src/python-pack.js";
import { PYTHON_SYMBOL_RULES } from "../../src/python-symbols.js";

const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

type Ctx = Parameters<typeof skipUnlessGrammar>[0];

async function parse(ctx: Ctx, path: string, source: string): Promise<PackSourceFile> {
  skipUnlessGrammar(ctx, pythonGrammarPath());
  const result = await runner.parseSource({ pack: pythonPack, grammarPath: pythonGrammarPath() }, path, source);
  if (result.status !== "parsed") throw new Error("expected a parsed file");
  expect(result.hasErrorNodes || result.hasMissingNodes).toBe(false);
  return { path, captures: result.captures };
}

const read = async (ctx: Ctx, source: string, options: Omit<ReadFactsOptions, "symbolRules" | "resolver"> = {}) => {
  const file = await parse(ctx, "m.py", source);
  return readPackFacts(pythonPack, file, {
    ...options,
    symbolRules: PYTHON_SYMBOL_RULES,
    resolver: pythonPack.resolver!.prepare([file]),
  });
};

/** One-based line and zero-based column where `needle` starts. */
function at(source: string, needle: string): SourcePosition {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`${needle} not in source`);
  const lines = source.slice(0, index).split("\n");
  return { line: lines.length, column: lines.at(-1)!.length };
}

const IMPORTS = `from __future__ import annotations
import a.b
import a.b as c, d
from e.f import g, h as i
from . import x
from ..pkg import y
from .. import (
    z,
    w as v,
)
from j import *

def f():
    import k
    if True:
        from l import m
`;

describe("Python imports", () => {
  it("lists every form as written, with leading dots kept and no future import", async (ctx) => {
    const { imports } = await read(ctx, IMPORTS, { kinds: ["imports"] });
    // A lone file at the root: nothing is a project module, and its relative imports climb past the root.
    expect(imports?.files).toEqual([]);
    expect(imports?.external.map((e) => [e.package, e.symbols])).toEqual([
      ["a", ["*"]],
      ["d", ["*"]],
      ["e", ["g", "h"]],
      ["j", ["*"]],
      ["k", ["*"]],
      ["l", ["m"]],
    ]);
    expect(imports?.written?.map((w) => [w.specifier, w.names])).toEqual([
      ["a.b", []],
      ["a.b", []],
      ["d", []],
      ["e.f", ["g", "h"]],
      [".", ["x"]],
      ["..pkg", ["y"]],
      ["..", ["z", "w"]],
      ["j", ["*"]],
      ["k", []],
      ["l", ["m"]],
    ]);
    expect(imports?.written?.[2]!.position).toEqual(at(IMPORTS, "d\n"));
    expect(imports?.written?.[5]!.position).toEqual(at(IMPORTS, "..pkg"));
    expect(imports?.written?.every((w) => w.guard === undefined)).toBe(true);
  });

  it("marks TYPE_CHECKING and ImportError-guarded imports, and nothing else", async (ctx) => {
    const source = `import typing
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    import t1
else:
    import t2
if typing.TYPE_CHECKING:
    import t3
if other.TYPE_CHECKING:
    import t4
try:
    import o1
except ImportError:
    import o2
try:
    import o3
except ModuleNotFoundError as error:
    pass
try:
    import o4
except (ValueError, ImportError):
    pass
try:
    import o5
except KeyError:
    pass
`;
    const { imports } = await read(ctx, source, { kinds: ["imports"] });
    const guards = Object.fromEntries((imports?.written ?? []).map((w) => [w.specifier, w.guard ?? null]));
    expect(guards).toEqual({
      typing: null,
      t1: "type-checking",
      t2: null,
      t3: "type-checking",
      t4: null,
      o1: "optional",
      o2: null,
      o3: "optional",
      o4: "optional",
      o5: null,
    });
  });

  it("takes the innermost guard", async (ctx) => {
    const source = "if TYPE_CHECKING:\n    try:\n        import a\n    except ImportError:\n        import b\n";
    const { imports } = await read(ctx, source, { kinds: ["imports"] });
    expect(imports?.written?.map((w) => [w.specifier, w.guard])).toEqual([
      ["a", "optional"],
      ["b", "type-checking"],
    ]);
  });
});

describe("Python symbols", () => {
  const SOURCE = `X = 1
Y: int = 2
a, b = 3, 4

@decorate
@app.get("/items")
async def handler():
    def local():
        pass

class Service(Base):
    @staticmethod
    def build():
        pass

    async def fetch(self):
        pass

    class Meta:
        pass

__all__ = ("Service", "handler")
`;

  it("reads classes, functions, methods, decorators and module-level names", async (ctx) => {
    const { symbols } = await read(ctx, SOURCE, { kinds: ["symbols"] });
    expect(symbols?.map((s) => [s.kind, s.name, s.container ?? null, s.decorators ?? null])).toEqual([
      ["variable", "X", null, null],
      ["variable", "Y", null, null],
      ["function", "handler", null, ["decorate", 'app.get("/items")']],
      ["function", "local", null, null],
      ["class", "Service", null, null],
      ["method", "build", "Service", ["staticmethod"]],
      ["method", "fetch", "Service", null],
      ["class", "Meta", "Service", null],
      ["variable", "__all__", null, null],
    ]);
    const handler = symbols!.find((s) => s.name === "handler")!;
    expect(handler.position).toEqual(at(SOURCE, "handler"));
    expect(handler.span.start).toEqual(at(SOURCE, "@decorate"));
    expect(symbols!.at(-1)!.exports).toEqual(["Service", "handler"]);
  });

  it("keeps __all__ names only for a literal list or tuple of strings", async (ctx) => {
    const exportsOf = async (value: string) =>
      (await read(ctx, `__all__ = ${value}\n`, { kinds: ["symbols"] })).symbols?.[0]?.exports;
    expect(await exportsOf('["a", \'b\']')).toEqual(["a", "b"]);
    expect(await exportsOf("[]")).toEqual([]);
    expect(await exportsOf('["a", name]')).toBeUndefined();
    expect(await exportsOf('["a"] + other')).toBeUndefined();
    expect(await exportsOf('[f"{x}"]')).toBeUndefined();
    expect(await exportsOf('["a" "b"]')).toBeUndefined();
  });
});

describe("Python calls", () => {
  it("groups calls with their receiver as written, keeping positional string literals but not f-strings", async (ctx) => {
    const source = 'os.path.join(root, "bin")\nprint(f"x{y}", "z", sep="-")\nhandlers[0]("h")\n';
    const { calls } = await read(ctx, source, { kinds: ["calls"] });
    expect(calls?.map((c) => [c.receiver ?? null, c.callee ?? null, c.strings.map((s) => s.text)])).toEqual([
      ["os.path", "join", ['"bin"']],
      [null, "print", ['"z"']],
      [null, null, ['"h"']],
    ]);
  });

  it("finds the pack's produces consistent with its resolver and rules", () => {
    expect(factGaps(pythonPack, PYTHON_SYMBOL_RULES)).toEqual([]);
  });
});

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "lang-python-entry-"));
  dirs.push(dir);
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  return dir;
}

describe("Python pack entry", () => {
  const FILES = {
    "app/main.py": "import importlib\nfrom .util import helper\n\nmod = importlib.import_module(name)\n",
    "app/util.py": "from importlib import import_module\n\ndef helper():\n    return __import__('json'), import_module('x')\n",
    "app/types.pyi": "def helper() -> None: ...\n",
  };

  it("returns resolved and written imports, and counts dynamic imports in its notices", async (ctx) => {
    skipUnlessGrammar(ctx, pythonGrammarPath());
    const projectDir = project(FILES);
    const result = await pack.analyzeProject({ projectDir, files: Object.keys(FILES), kinds: ["imports"] });
    expect(result.degraded).toBeUndefined();
    expect(result.facts.map((f) => [f.path, f.imports?.written?.map((w) => w.specifier)])).toEqual([
      ["app/main.py", ["importlib", ".util"]],
      ["app/util.py", ["importlib"]],
      ["app/types.pyi", []],
    ]);
    expect(result.facts.map((f) => [f.path, f.imports?.files, f.imports?.external.map((e) => e.package)])).toEqual([
      ["app/main.py", [{ to: "app/util.py", symbols: ["helper"] }], ["stdlib:importlib"]],
      ["app/util.py", [], ["stdlib:importlib"]],
      ["app/types.pyi", [], []],
    ]);
    expect(result.notices).toEqual([
      "Python: 3 dynamic imports name their module at run time and are not import facts: " +
        "app/main.py:4 (importlib.import_module), app/util.py:4 (__import__), app/util.py:4 (import_module).",
    ]);
  });

  it("gives no dynamic-import notice when imports are not wanted", async (ctx) => {
    skipUnlessGrammar(ctx, pythonGrammarPath());
    const projectDir = project(FILES);
    const result = await pack.analyzeProject({ projectDir, files: Object.keys(FILES), kinds: ["symbols"] });
    expect(result.notices).toBeUndefined();
    expect(result.facts.every((f) => f.imports === undefined)).toBe(true);
  });
});
