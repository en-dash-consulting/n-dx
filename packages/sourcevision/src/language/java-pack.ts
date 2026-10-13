/**
 * Java language pack: the pinned tree-sitter grammar plus the structure
 * queries under `queries/java/`, and the reference resolver.
 *
 * @module sourcevision/language/java-pack
 */

import { join } from "node:path";
import { javaConfig } from "@n-dx/lang-kit";
import { javaResolver } from "./java-resolver.js";
import { queryDir } from "./package-paths.js";
import type { LanguagePack, RuleProvenance } from "./pack.js";

const QUERY_NAMES = ["packages", "imports", "declarations", "methods", "calls", "annotations", "type-references"] as const;

/** Query files ship in `src/language/queries/java`; see `package-paths.ts`. */
const queryPath = (file: string): string => join(queryDir("java"), file);

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
  // A getter, so the paths are computed on first use rather than at import.
  get queries() {
    return QUERY_NAMES.map((name) => ({ name, path: queryPath(`${name}.scm`) }));
  },
  resolver: javaResolver,
  provenance: {
    packages: VERIFIED,
    imports: VERIFIED,
    declarations: VERIFIED,
    methods: VERIFIED,
    calls: VERIFIED,
    annotations: VERIFIED,
    "type-references": VERIFIED,
    // Lookup order of a simple type name: declared in the file, single-type
    // import, same package, wildcard import.
    resolver: {
      verifiedAgainst: ["Java 21"],
      verifiedOn: "2026-10-07",
      source: "https://docs.oracle.com/javase/specs/jls/se21/html/jls-6.html#jls-6.4.1",
    },
  },
};
