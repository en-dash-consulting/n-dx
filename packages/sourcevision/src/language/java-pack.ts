/**
 * Java language pack: the pinned tree-sitter grammar plus the structure
 * queries under `queries/java/`. No resolver yet.
 *
 * @module sourcevision/language/java-pack
 */

import { fileURLToPath } from "node:url";
import { javaConfig } from "./java.js";
import type { LanguagePack, RuleProvenance } from "./pack.js";

/**
 * Query files ship in the package's `src/language/queries`. Resolved
 * package-relative so it is the same from `src/language/` and `dist/language/`.
 */
const QUERY_DIR = "../../src/language/queries/java";

const queryPath = (file: string): string => fileURLToPath(new URL(`${QUERY_DIR}/${file}`, import.meta.url));

/**
 * Grammar release the queries were written and checked against. Keep in step
 * with `scripts/build-grammars.mjs`; update `verifiedOn` when re-checking.
 */
const GRAMMAR_VERSION = "0.23.5";

const VERIFIED: RuleProvenance = {
  verifiedAgainst: [`tree-sitter-java@${GRAMMAR_VERSION}`, "Java 21"],
  verifiedOn: "2026-10-07",
  source: `https://github.com/tree-sitter/tree-sitter-java/blob/v${GRAMMAR_VERSION}/src/node-types.json`,
};

export const javaPack: LanguagePack = {
  id: javaConfig.id,
  config: javaConfig,
  grammar: { name: "tree-sitter-java", version: GRAMMAR_VERSION },
  queries: [
    { name: "packages", path: queryPath("packages.scm") },
    { name: "imports", path: queryPath("imports.scm") },
    { name: "declarations", path: queryPath("declarations.scm") },
    { name: "methods", path: queryPath("methods.scm") },
    { name: "calls", path: queryPath("calls.scm") },
    { name: "type-references", path: queryPath("type-references.scm") },
  ],
  provenance: {
    packages: VERIFIED,
    imports: VERIFIED,
    declarations: VERIFIED,
    methods: VERIFIED,
    calls: VERIFIED,
    "type-references": VERIFIED,
  },
};
