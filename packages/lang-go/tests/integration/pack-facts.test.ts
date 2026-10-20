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

  it("keeps the edge to a package whose only file is over the runner's size limit, listing that file as unparsed", async (ctx) => {
    skipUnlessGrammar(ctx, goGrammarPath());
    const projectDir = project({
      "go.mod": "module example.com/root\n",
      "pb/api.pb.go": `package pb\n\n// ${"x".repeat(DEFAULT_MAX_FILE_BYTES)}\n`,
      "cmd/main.go": 'package main\n\nimport "example.com/root/pb"\n',
    });
    const result = await pack.analyzeProject({ projectDir, files: ["cmd/main.go", "pb/api.pb.go"], kinds: ["imports"] });
    expect(result.unparsed).toEqual(["pb/api.pb.go"]);
    expect(result.facts).toEqual([{ path: "cmd/main.go", imports: { files: [{ to: "pb", symbols: ["*"] }], external: [] } }]);
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
