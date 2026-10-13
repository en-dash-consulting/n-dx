/**
 * Go language pack: the pinned tree-sitter grammar, the structure queries
 * under `queries/go/`, and the reference resolver (`go-resolver.ts`). When the
 * pack degrades (grammar missing or unloadable, a query rejected, build files
 * unreadable), the imports phase falls back to the regex import parser
 * (`analyzers/go-imports.ts`), so Go never drops to inventory-only.
 *
 * @module sourcevision/language/go-pack
 */

import { join } from "node:path";
import { goConfig } from "@n-dx/lang-kit";
import { goResolver } from "./go-resolver.js";
import { queryDir } from "./package-paths.js";
import type { LanguagePack, RuleProvenance } from "./pack.js";

const QUERY_NAMES = ["packages", "imports", "types", "functions", "methods", "calls", "struct-tags"] as const;

/** Query files ship in `src/language/queries/go`; see `package-paths.ts`. */
const queryPath = (file: string): string => join(queryDir("go"), file);

/**
 * Grammar release the queries were written and checked against. Keep in step
 * with `scripts/build-grammars.mjs`; update `verifiedOn` when re-checking.
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
  provenance: Object.fromEntries(QUERY_NAMES.map((name) => [name, VERIFIED])),
};
