/**
 * SQL grammar target: the pinned tree-sitter-sql grammar and the table query
 * under `queries/sql/`.
 *
 * SQL is not a language sourcevision analyzes for structure: the grammar is
 * generic across dialects, and only table names are read from it, in memory
 * (see `sql-schema.ts`). The analysis pipeline does not wire this pack in, so
 * inventory, import and zone analysis are unchanged.
 *
 * @module lang-sql/sql-pack
 */

import { join } from "node:path";
import type { LanguagePack, RuleProvenance } from "@n-dx/lang-runtime";
import type { LanguageConfig } from "@n-dx/lang-kit";
import { SQL_PACKAGE } from "./package-paths.js";

/** Keep in step with `packages/lang-runtime/scripts/build-grammars.mjs`. */
const GRAMMAR_VERSION = "0.3.11";

const sqlConfig: LanguageConfig = {
  id: "sql",
  displayName: "SQL",
  extensions: new Set([".sql"]),
  parseableExtensions: new Set(),
  testFilePatterns: [],
  configFilenames: new Set(),
  skipDirectories: new Set(),
  generatedFilePatterns: [],
  entryPointPatterns: [],
};

const VERIFIED: RuleProvenance = {
  verifiedAgainst: [`tree-sitter-sql@${GRAMMAR_VERSION}`],
  verifiedOn: "2026-10-08",
  source: `https://github.com/DerekStride/tree-sitter-sql/blob/v${GRAMMAR_VERSION}/grammar.js`,
};

export const sqlPack: LanguagePack = {
  id: sqlConfig.id,
  config: sqlConfig,
  grammar: { name: "tree-sitter-sql", version: GRAMMAR_VERSION },
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: "tables", path: join(SQL_PACKAGE.queryDir("sql"), "tables.scm") }];
  },
  // A CREATE TABLE is a symbol of kind "table"; see `sql-facts.ts`.
  produces: ["symbols"],
  provenance: { tables: VERIFIED },
};

/** Where the built grammar is read from: `build/grammars/tree-sitter-sql.wasm`. */
export const sqlGrammarPath = (): string => join(SQL_PACKAGE.grammarDir(), `${sqlPack.grammar.name}.wasm`);
