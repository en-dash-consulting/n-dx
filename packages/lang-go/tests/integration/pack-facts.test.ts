/**
 * The Go pack's captures read into lang-kit facts by its symbol rules, and
 * the pack entry run over a project: each fact says what the captures mean.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SourcePosition } from "@n-dx/lang-kit";

import {
  DEFAULT_MAX_FILE_BYTES,
  createPackEntry,
  createTreeSitterRunner,
  factGaps,
  readPackFacts,
  skipUnlessGrammar,
  type PackSourceFile,
  type ReadFactsOptions,
} from "@n-dx/lang-runtime";
import { GO_SYMBOL_RULES, goGrammarPath, goPack } from "../../src/go-pack.js";
import { goResolver } from "../../src/go-resolver.js";
import { GO_PACKAGE } from "../../src/package-paths.js";
import { pack } from "../../src/pack.js";

const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

type Ctx = Parameters<typeof skipUnlessGrammar>[0];

async function parse(ctx: Ctx, path: string, source: string): Promise<PackSourceFile> {
  skipUnlessGrammar(ctx, goGrammarPath());
  const result = await runner.parseSource({ pack: goPack, grammarPath: goGrammarPath() }, path, source);
  if (result.status !== "parsed") throw new Error("expected a parsed file");
  expect(result.hasErrorNodes || result.hasMissingNodes).toBe(false);
  return { path, captures: result.captures };
}

const read = (file: PackSourceFile, options: Omit<ReadFactsOptions, "symbolRules"> = {}) =>
  readPackFacts(goPack, file, { ...options, symbolRules: GO_SYMBOL_RULES });

/** One-based line and zero-based column where `needle` starts. */
function at(source: string, needle: string): SourcePosition {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`${needle} not in source`);
  const lines = source.slice(0, index).split("\n");
  return { line: lines.length, column: lines.at(-1)!.length };
}

const GO_STORE = `package store

import (
	"fmt"

	"example.com/app/model"
)

type Store struct{ db *model.DB }

type Reader interface{ Read() error }

type ID = string

func New(db *model.DB) *Store { return &Store{db: db} }

func (s *Store) Count() int {
	row := s.db.QueryRow("SELECT count(*) FROM owners")
	fmt.Println(row)
	return 0
}
`;
const GO_MODEL = "package model\n\ntype DB struct{}\n";
const GO_MOD = "module example.com/app\n\ngo 1.22\n";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "lang-go-entry-"));
  dirs.push(dir);
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  return dir;
}

describe("Go facts", () => {
  it("declares types, functions and methods with the receiver as container", async (ctx) => {
    const file = await parse(ctx, "store/store.go", GO_STORE);
    const { symbols } = read(file, { kinds: ["symbols"] });
    expect(symbols?.map((s) => [s.kind, s.name, s.container])).toEqual([
      ["struct", "Store", undefined],
      ["interface", "Reader", undefined],
      ["alias", "ID", undefined],
      ["function", "New", undefined],
      ["method", "Count", "Store"],
    ]);
    expect(symbols![4]!.position).toEqual(at(GO_STORE, "Count"));
    expect(symbols![4]!.span.start).toEqual(at(GO_STORE, "func (s"));
  });

  it("groups calls with their receiver as written", async (ctx) => {
    const file = await parse(ctx, "store/store.go", GO_STORE);
    const literal = '"SELECT count(*) FROM owners"';
    const start = at(GO_STORE, literal);
    expect(read(file, { kinds: ["calls"] }).calls).toEqual([
      {
        callee: "QueryRow",
        receiver: "s.db",
        strings: [{ text: literal, start, end: { line: start.line, column: start.column + literal.length } }],
      },
      { callee: "Println", receiver: "fmt", strings: [] },
    ]);
  });

  it("reads imports from the project-bound resolver", async (ctx) => {
    const store = await parse(ctx, "store/store.go", GO_STORE);
    const model = await parse(ctx, "model/model.go", GO_MODEL);
    const dir = project({ "go.mod": GO_MOD });
    const resolver = (await goPack.resolver!.forProject!(dir)).prepare([store, model]);
    const { imports } = read(store, { kinds: ["imports"], resolver });
    expect(imports).toEqual(resolver.resolve(store.path));
    expect(imports?.files.map((f) => f.to)).toEqual(["model"]);
    expect(imports?.external.map((e) => e.package)).toEqual(["stdlib:fmt"]);
  });

  it("finds the pack's produces consistent with its resolver and rules", () => {
    expect(factGaps(goPack, GO_SYMBOL_RULES)).toEqual([]);
  });
});

describe("Go pack entry", () => {
  it("contains an oversized import reader failure to the unreadable file", async (ctx) => {
    skipUnlessGrammar(ctx, goGrammarPath());
    const projectDir = project({ "go.mod": GO_MOD, "a.go": 'package a\nvar text = "' + "x".repeat(1000) + '"\n' });
    const entry = createPackEntry({ package: GO_PACKAGE, pack: goPack, symbolRules: GO_SYMBOL_RULES, runner: { maxFileBytes: 100 }, oversizedImportSource: () => { throw new Error("bad header"); } });
    const result = await entry.analyzeProject({ projectDir, files: ["a.go"], kinds: ["imports"] });
    expect(result.degraded).toBeUndefined();
    expect(result.unparsed).toEqual(["a.go"]);
    expect(result.notices).toEqual(["a.go oversized import recovery failed (bad header); left unparsed"]);
  });

  it("resolves imports against the project's go.mod", async (ctx) => {
    skipUnlessGrammar(ctx, goGrammarPath());
    const projectDir = project({ "go.mod": GO_MOD, "store/store.go": GO_STORE, "model/model.go": GO_MODEL });
    const result = await pack.analyzeProject({ projectDir, files: ["store/store.go", "model/model.go"], kinds: ["imports"] });
    expect(result.degraded).toBeUndefined();
    expect(result.facts.map((f) => [f.path, f.imports?.files.map((r) => r.to)])).toEqual([
      ["store/store.go", ["model"]],
      ["model/model.go", []],
    ]);
  });

  it("keeps the edge to an oversized package file and recovers only its imports", async (ctx) => {
    skipUnlessGrammar(ctx, goGrammarPath());
    const projectDir = project({
      "go.mod": "module example.com/root\n",
      "pb/api.pb.go": `package pb\n\n// ${"x".repeat(DEFAULT_MAX_FILE_BYTES)}\n`,
      "cmd/main.go": 'package main\n\nimport "example.com/root/pb"\n',
    });
    const result = await pack.analyzeProject({ projectDir, files: ["cmd/main.go", "pb/api.pb.go"], kinds: ["imports"] });
    expect(result.unparsed).toEqual([]);
    expect(result.facts.find((f) => f.path === "pb/api.pb.go")).toEqual({ path: "pb/api.pb.go", imports: { files: [], external: [] } });
    expect(result.notices?.join("\n")).toContain("structure skipped");
    expect(result.facts.find((f) => f.path === "cmd/main.go")).toEqual({ path: "cmd/main.go", imports: { files: [{ to: "pb", symbols: ["*"] }], external: [] } });
  });

  it("resolves an oversized file's workspace imports and module root through the Go resolver", async (ctx) => {
    skipUnlessGrammar(ctx, goGrammarPath());
    const projectDir = project({
      "go.work": "go 1.23\nuse (\n ./api\n ./lib\n)\n",
      "api/go.mod": "module example.com/ws/api\n",
      "lib/go.mod": "module example.com/ws/lib\n",
      "api/root.go": "package api\n",
      "api/root_test.go": "package api\n",
      "lib/store/store.go": "package store\n",
      "api/generated.go": '/* import "wrong/package" */\npackage api\nimport (\n store "example.com/ws/lib/store"\n _ `example.com/ws/api`\n)\nvar generated = "' + "x".repeat(DEFAULT_MAX_FILE_BYTES) + '"\n',
    });
    const result = await pack.analyzeProject({ projectDir, files: ["api/root.go", "api/root_test.go", "lib/store/store.go", "api/generated.go"], kinds: ["imports", "symbols"] });
    expect(result.degraded).toBeUndefined();
    expect(result.unparsed).toEqual([]);
    const generated = result.facts.find((f) => f.path === "api/generated.go")!;
    expect(generated.imports?.files).toEqual([{ to: "api", symbols: ["*"] }, { to: "lib/store", symbols: ["store"] }]);
    expect(generated.imports?.external).toEqual([]);
    expect(generated.symbols).toBeUndefined();
  });

  it("expands a root-package import from an oversized file to non-test files instead of an empty directory", async (ctx) => {
    skipUnlessGrammar(ctx, goGrammarPath());
    const projectDir = project({
      "go.mod": "module example.com/root\n",
      "root.go": "package root\n", "root_test.go": "package root\n",
      "cmd/generated.go": 'package main\nimport "example.com/root"\nvar generated = "' + "x".repeat(DEFAULT_MAX_FILE_BYTES) + '"\n',
    });
    const result = await pack.analyzeProject({ projectDir, files: ["root.go", "root_test.go", "cmd/generated.go"], kinds: ["imports"] });
    expect(result.facts.find((f) => f.path === "cmd/generated.go")?.imports).toEqual({ files: [{ to: "root.go", symbols: ["*"] }], external: [] });
  });

  it("degrades, rather than throwing, when the project's build files cannot be read", async (ctx) => {
    skipUnlessGrammar(ctx, goGrammarPath());
    const projectDir = project({ "a.go": "package a\n" });
    const entry = createPackEntry({
      package: GO_PACKAGE,
      pack: { ...goPack, resolver: { ...goResolver, forProject: () => Promise.reject(new Error("go.mod unreadable")) } },
      symbolRules: GO_SYMBOL_RULES,
    });
    const result = await entry.analyzeProject({ projectDir, files: ["a.go"] });
    expect(result).toEqual({
      facts: [],
      unparsed: [],
      degraded: { reason: "the project's build files could not be read (go.mod unreadable)" },
    });
  });
});
