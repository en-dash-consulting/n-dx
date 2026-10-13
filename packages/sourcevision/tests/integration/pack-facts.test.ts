/**
 * The adapter from captures to lang-kit facts, on small Java, Go and SQL
 * sources: each fact says what the captures mean.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SourcePosition } from "@n-dx/lang-kit";

import { grammarWasmPath } from "../../scripts/build-grammars.mjs";
import { goPack } from "../../src/language/go-pack.js";
import { javaPack } from "../../src/language/java-pack.js";
import type { LanguagePack, PackSourceFile } from "../../src/language/pack.js";
import { factGaps, readPackFacts } from "../../src/language/pack-facts.js";
import { createTreeSitterRunner } from "../../src/language/runner.js";
import { sqlPack } from "../../src/language/sql-pack.js";
import { skipUnlessGrammar } from "../helpers/grammar.js";

const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

type Ctx = Parameters<typeof skipUnlessGrammar>[0];

async function parse(ctx: Ctx, pack: LanguagePack, path: string, source: string): Promise<PackSourceFile> {
  const grammarPath = grammarWasmPath(pack.grammar.name);
  skipUnlessGrammar(ctx, grammarPath);
  const result = await runner.parseSource({ pack, grammarPath }, path, source);
  if (result.status !== "parsed") throw new Error("expected a parsed file");
  expect(result.hasErrorNodes || result.hasMissingNodes).toBe(false);
  return { path, captures: result.captures };
}

/** One-based line and zero-based column where `needle` (the `nth` occurrence) starts. */
function at(source: string, needle: string, nth = 1): SourcePosition {
  let index = -1;
  for (let i = 0; i < nth; i++) index = source.indexOf(needle, index + 1);
  if (index < 0) throw new Error(`${needle} not in source`);
  const lines = source.slice(0, index).split("\n");
  return { line: lines.length, column: lines.at(-1)!.length };
}

const JAVA_CLINIC = `package com.example;

import java.util.List;
import com.example.model.Owner;

public class Clinic {
  private final JdbcTemplate jdbc;
  public Clinic(JdbcTemplate jdbc) { this.jdbc = jdbc; }
  List<Owner> owners() { return jdbc.query("SELECT * FROM owners", mapper()); }
  interface Visit { void at(); }
  enum Kind { CAT }
  record Pet(String name) {}
}
`;
const JAVA_OWNER = "package com.example.model;\n\npublic class Owner {}\n";

describe("Java facts", () => {
  it("declares types and callables with their enclosing type", async (ctx) => {
    const file = await parse(ctx, javaPack, "src/com/example/Clinic.java", JAVA_CLINIC);
    const { symbols } = readPackFacts(javaPack, file, { kinds: ["symbols"] });
    expect(symbols?.map((s) => [s.kind, s.name, s.container])).toEqual([
      ["class", "Clinic", undefined],
      ["constructor", "Clinic", "Clinic"],
      ["method", "owners", "Clinic"],
      ["interface", "Visit", "Clinic"],
      ["method", "at", "Visit"],
      ["enum", "Kind", "Clinic"],
      ["record", "Pet", "Clinic"],
    ]);
    const clinic = symbols![0]!;
    expect(clinic.position).toEqual(at(JAVA_CLINIC, "Clinic {"));
    expect(clinic.span.start).toEqual(at(JAVA_CLINIC, "public class"));
    expect(symbols![2]!.position).toEqual(at(JAVA_CLINIC, "owners()"));
  });

  it("gives a method in an anonymous class no named container", async (ctx) => {
    const source =
      "class Clinic {\n  void start() { new Thread(new Runnable() { public void run() {} }); }\n  void stop() {}\n}\n";
    const file = await parse(ctx, javaPack, "Clinic.java", source);
    const { symbols } = readPackFacts(javaPack, file, { kinds: ["symbols"] });
    expect(symbols?.map((s) => [s.name, s.container])).toEqual([
      ["Clinic", undefined],
      ["start", "Clinic"],
      ["run", undefined],
      ["stop", "Clinic"],
    ]);
  });

  it("groups calls with their receiver and own string arguments", async (ctx) => {
    const file = await parse(ctx, javaPack, "src/com/example/Clinic.java", JAVA_CLINIC);
    const literal = '"SELECT * FROM owners"';
    const start = at(JAVA_CLINIC, literal);
    expect(readPackFacts(javaPack, file, { kinds: ["calls"] }).calls).toEqual([
      {
        callee: "query",
        receiver: "jdbc",
        strings: [{ text: literal, start, end: { line: start.line, column: start.column + literal.length } }],
      },
      { callee: "mapper", strings: [] },
    ]);
  });

  it("reads imports from the prepared resolver, unchanged", async (ctx) => {
    const clinic = await parse(ctx, javaPack, "src/com/example/Clinic.java", JAVA_CLINIC);
    const owner = await parse(ctx, javaPack, "src/com/example/model/Owner.java", JAVA_OWNER);
    const resolver = javaPack.resolver!.prepare([clinic, owner]);
    const facts = readPackFacts(javaPack, clinic, { resolver });
    expect(facts.imports).toEqual(resolver.resolve(clinic.path));
    expect(facts.imports?.files).toEqual([{ to: "src/com/example/model/Owner.java", symbols: ["Owner"] }]);
    expect(facts.imports?.external.map((e) => e.package)).toContain("java.util");
    expect(Object.keys(facts).sort()).toEqual(["calls", "imports", "path", "symbols"]);
  });

  it("leaves imports absent without a resolver", async (ctx) => {
    const file = await parse(ctx, javaPack, "src/com/example/model/Owner.java", JAVA_OWNER);
    expect(readPackFacts(javaPack, file)).not.toHaveProperty("imports");
  });
});

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

describe("Go facts", () => {
  it("declares types, functions and methods with the receiver as container", async (ctx) => {
    const file = await parse(ctx, goPack, "store/store.go", GO_STORE);
    const { symbols } = readPackFacts(goPack, file, { kinds: ["symbols"] });
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
    const file = await parse(ctx, goPack, "store/store.go", GO_STORE);
    const literal = '"SELECT count(*) FROM owners"';
    const start = at(GO_STORE, literal);
    expect(readPackFacts(goPack, file, { kinds: ["calls"] }).calls).toEqual([
      {
        callee: "QueryRow",
        receiver: "s.db",
        strings: [{ text: literal, start, end: { line: start.line, column: start.column + literal.length } }],
      },
      { callee: "Println", receiver: "fmt", strings: [] },
    ]);
  });

  it("reads imports from the project-bound resolver", async (ctx) => {
    const store = await parse(ctx, goPack, "store/store.go", GO_STORE);
    const model = await parse(ctx, goPack, "model/model.go", "package model\n\ntype DB struct{}\n");
    const dir = mkdtempSync(join(tmpdir(), "sv-pack-facts-"));
    try {
      writeFileSync(join(dir, "go.mod"), "module example.com/app\n\ngo 1.22\n");
      const resolver = (await goPack.resolver!.forProject!(dir)).prepare([store, model]);
      const { imports } = readPackFacts(goPack, store, { kinds: ["imports"], resolver });
      expect(imports).toEqual(resolver.resolve(store.path));
      expect(imports?.files.map((f) => f.to)).toEqual(["model"]);
      expect(imports?.external.map((e) => e.package)).toEqual(["stdlib:fmt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("produces against the rules", () => {
  it("rejects a pack that produces symbols but has no symbol rules, rather than reading an empty list", () => {
    const pack: LanguagePack = { ...javaPack, id: "kotlin", produces: ["symbols"] };
    const file: PackSourceFile = { path: "A.kt", captures: {} };
    expect(() => readPackFacts(pack, file)).toThrow(/kotlin.*produces "symbols".*no symbol rules/);
  });

  it("finds every built-in pack's produces consistent with its resolver and rules", () => {
    for (const pack of [javaPack, goPack, sqlPack]) expect(factGaps(pack), pack.id).toEqual([]);
  });

  it("names both gaps of a pack with a resolver and symbols but neither imports nor rules", () => {
    const pack: LanguagePack = { ...javaPack, id: "kotlin", produces: ["symbols"] };
    expect(factGaps(pack)).toEqual(['has a resolver but does not produce "imports"', 'produces "symbols" but has no symbol rules']);
  });
});

const SQL_SCHEMA =`CREATE TABLE owners (id INT);
CREATE TABLE "billing"."Invoices" (id INT);
ALTER TABLE owners ADD COLUMN name TEXT;
`;

describe("SQL facts", () => {
  it("reads each CREATE TABLE as a table symbol, schema as container, and nothing else", async (ctx) => {
    const file = await parse(ctx, sqlPack, "db/schema.sql", SQL_SCHEMA);
    const facts = readPackFacts(sqlPack, file);
    expect(Object.keys(facts).sort()).toEqual(["path", "symbols"]);
    expect(facts.symbols?.map((s) => [s.kind, s.name, s.container, s.position])).toEqual([
      ["table", "owners", undefined, at(SQL_SCHEMA, "owners")],
      ["table", "Invoices", "billing", at(SQL_SCHEMA, '"billing"')],
    ]);
  });
});
