/**
 * Java language pack: the pinned tree-sitter grammar plus the structure
 * queries under `queries/java/`, the reference resolver, and the symbol rules
 * that read declarations from the captures.
 *
 * @module lang-java/java-pack
 */

import { join } from "node:path";
import { javaConfig } from "@n-dx/lang-kit";
import { typeRule, type LanguagePack, type PackSymbolRules, type RuleProvenance } from "@n-dx/lang-runtime";
import { javaResolver } from "./java-resolver.js";
import { JAVA_PACKAGE } from "./package-paths.js";
import { springBoot } from "./spring-boot.js";

const QUERY_NAMES = ["packages", "imports", "declarations", "methods", "calls", "annotations", "type-references"] as const;

/** Query files ship in `queries/java`; see `package-paths.ts`. */
const queryPath = (file: string): string => join(JAVA_PACKAGE.queryDir("java"), file);

/**
 * Grammar release the queries were written and checked against. Keep in step
 * with `packages/lang-runtime/scripts/build-grammars.mjs`; update `verifiedOn` when re-checking.
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
  // Routes and outbound calls come from the Spring Boot framework, whose query runs only when they are wanted.
  produces: ["imports", "symbols", "calls", "routes", "outboundCalls"],
  frameworks: [springBoot],
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

/** Where the built grammar is read from: `build/grammars/tree-sitter-java.wasm`. */
export const javaGrammarPath = (): string => join(JAVA_PACKAGE.grammarDir(), `${javaPack.grammar.name}.wasm`);

/** Symbol rules, written against `queries/java/*.scm`. */
export const JAVA_SYMBOL_RULES: PackSymbolRules = {
  rules: [
    typeRule("declarations", "type.class", "class"),
    typeRule("declarations", "type.interface", "interface"),
    typeRule("declarations", "type.enum", "enum"),
    typeRule("declarations", "type.record", "record"),
    typeRule("declarations", "type.annotation", "annotation"),
    { query: "methods", declaration: "method.declaration", name: "method.name", kind: "method" },
    { query: "methods", declaration: "constructor.declaration", name: "constructor.name", kind: "constructor" },
  ],
  anonymousBody: { query: "declarations", capture: "anonymous.body" },
};
