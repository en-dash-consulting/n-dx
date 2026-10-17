/**
 * The adapter from captures to lang-kit facts, on SQL sources, with the SQL
 * symbol rules.
 */

import { afterAll, describe, expect, it } from "vitest";
import type { SourcePosition } from "@n-dx/lang-kit";
import {
  createTreeSitterRunner,
  factGaps,
  readPackFacts,
  skipUnlessGrammar,
  type LanguagePack,
  type PackSourceFile,
} from "@n-dx/lang-runtime";

import { SQL_SYMBOL_RULES } from "../../src/sql-facts.js";
import { sqlGrammarPath, sqlPack } from "../../src/sql-pack.js";

const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

type Ctx = Parameters<typeof skipUnlessGrammar>[0];

async function parse(ctx: Ctx, pack: LanguagePack, path: string, source: string): Promise<PackSourceFile> {
  const grammarPath = sqlGrammarPath();
  skipUnlessGrammar(ctx, grammarPath);
  const result = await runner.parseSource({ pack, grammarPath }, path, source);
  if (result.status !== "parsed") throw new Error("expected a parsed file");
  expect(result.hasErrorNodes || result.hasMissingNodes).toBe(false);
  return { path, captures: result.captures };
}

/** One-based line and zero-based column where `needle` starts. */
function at(source: string, needle: string): SourcePosition {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`${needle} not in source`);
  const lines = source.slice(0, index).split("\n");
  return { line: lines.length, column: lines.at(-1)!.length };
}

const NO_RESOLUTION = { prepare: () => ({ resolve: () => ({ files: [], external: [] }) }) };

describe("produces against the rules", () => {
  it("rejects a pack that produces symbols but has no symbol rules, rather than reading an empty list", () => {
    const pack: LanguagePack = { ...sqlPack, id: "kotlin", produces: ["symbols"] };
    const file: PackSourceFile = { path: "A.kt", captures: {} };
    expect(() => readPackFacts(pack, file)).toThrow(/kotlin.*produces "symbols".*no symbol rules/);
  });

  it("finds the SQL pack's produces consistent with its rules", () => {
    expect(factGaps(sqlPack, SQL_SYMBOL_RULES)).toEqual([]);
  });

  it("names both gaps of a pack with a resolver and symbols but neither imports nor rules", () => {
    const pack: LanguagePack = { ...sqlPack, id: "kotlin", produces: ["symbols"], resolver: NO_RESOLUTION };
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
    const facts = readPackFacts(sqlPack, file, { symbolRules: SQL_SYMBOL_RULES });
    expect(Object.keys(facts).sort()).toEqual(["path", "symbols"]);
    expect(facts.symbols?.map((s) => [s.kind, s.name, s.container, s.position])).toEqual([
      ["table", "owners", undefined, at(SQL_SCHEMA, "owners")],
      ["table", "Invoices", "billing", at(SQL_SCHEMA, '"billing"')],
    ]);
  });
});
