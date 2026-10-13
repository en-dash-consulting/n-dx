/**
 * SQL grammar target: the pinned tree-sitter-sql grammar and the table query
 * under `queries/sql/`.
 *
 * Not in `BUILTIN_PACKS`. SQL is not a language sourcevision analyzes for
 * structure: the grammar is generic across dialects, and only table names are
 * read from it, in memory (see `sql-schema.ts`). Keeping it out of the
 * built-in list leaves inventory, import and zone analysis unchanged.
 *
 * @module sourcevision/language/sql-pack
 */

import { join } from "node:path";
import { queryDir } from "./package-paths.js";
import type { LanguagePack, RuleProvenance } from "@n-dx/lang-runtime";
import type { LanguageConfig } from "@n-dx/lang-kit";

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
    return [{ name: "tables", path: join(queryDir("sql"), "tables.scm") }];
  },
  // A CREATE TABLE is a symbol of kind "table"; see `pack-facts.ts`.
  produces: ["symbols"],
  provenance: { tables: VERIFIED },
};
