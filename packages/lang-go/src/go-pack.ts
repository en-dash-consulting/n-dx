/**
 * Go language pack: the pinned tree-sitter grammar, the structure queries
 * under `queries/go/`, the reference resolver (`go-resolver.ts`), and the
 * symbol rules that read declarations from the captures. When the pack
 * degrades (missing, grammar missing or unloadable, a query rejected, build
 * files unreadable), sourcevision's imports phase falls back to its regex
 * import parser (`analyzers/go-imports.ts`), so Go never drops to
 * inventory-only.
 *
 * @module lang-go/go-pack
 */

import { join } from "node:path";
import { goConfig } from "@n-dx/lang-kit";
import { typeRule, type LanguagePack, type PackSymbolRules, type RuleProvenance } from "@n-dx/lang-runtime";
import { goResolver } from "./go-resolver.js";
import { GO_PACKAGE } from "./package-paths.js";

const QUERY_NAMES = ["packages", "imports", "types", "functions", "methods", "calls", "struct-tags"] as const;

/** Query files ship in `queries/go`; see `package-paths.ts`. */
const queryPath = (file: string): string => join(GO_PACKAGE.queryDir("go"), file);

/**
 * Grammar release the queries were written and checked against. Keep in step
 * with `packages/lang-runtime/scripts/build-grammars.mjs`; update `verifiedOn` when re-checking.
 */
const GRAMMAR_VERSION = "0.25.0";

const VERIFIED: RuleProvenance = {
  verifiedAgainst: [`tree-sitter-go@${GRAMMAR_VERSION}`, "Go 1.24"],
  verifiedOn: "2026-10-08",
  source: `https://github.com/tree-sitter/tree-sitter-go/blob/v${GRAMMAR_VERSION}/src/node-types.json`,
};

export const goPack: LanguagePack = {
  id: goConfig.id,
  config: goConfig,
  grammar: { name: "tree-sitter-go", version: GRAMMAR_VERSION },
  // A getter, so the paths are computed on first use rather than at import.
  get queries() {
    return QUERY_NAMES.map((name) => ({ name, path: queryPath(`${name}.scm`) }));
  },
  resolver: goResolver,
  produces: ["imports", "symbols", "calls"],
  provenance: Object.fromEntries(QUERY_NAMES.map((name) => [name, VERIFIED])),
};

/** Where the built grammar is read from: `build/grammars/tree-sitter-go.wasm`. */
export const goGrammarPath = (): string => join(GO_PACKAGE.grammarDir(), `${goPack.grammar.name}.wasm`);

/** Symbol rules, written against `queries/go/*.scm`. */
export const GO_SYMBOL_RULES: PackSymbolRules = {
  rules: [
    typeRule("types", "type.struct", "struct"),
    typeRule("types", "type.interface", "interface"),
    typeRule("types", "type.alias", "alias"),
    { query: "functions", declaration: "function.declaration", name: "function.name", kind: "function" },
    {
      query: "methods",
      declaration: "method.declaration",
      name: "method.name",
      kind: "method",
      container: "method.receiver_type",
    },
  ],
};
