/**
 * The symbol rules of sourcevision's packs, and the runtime's captures-to-facts
 * adapter bound to them.
 *
 * The adapter itself is `@n-dx/lang-runtime`'s; the rule tables are pack data
 * and move into each pack in a later task.
 *
 * SQL's only query names tables. A `CREATE TABLE` is a symbol of kind
 * `table`: its name is the unquoted last part of the object reference, its
 * container the schema (the part before it), and its span the reference's
 * span. An `ALTER TABLE` declares nothing, so it is not a symbol;
 * `sql-schema.ts` still reads both statements from the captures.
 *
 * @module sourcevision/language/pack-facts
 */

import type { FileFacts } from "@n-dx/lang-kit";
import {
  factGaps as runtimeFactGaps,
  readPackFacts as runtimeReadPackFacts,
  typeRule,
  type LanguagePack,
  type PackSourceFile,
  type PackSymbolRules,
  type ReadFactsOptions,
} from "@n-dx/lang-runtime";
import { splitSqlName } from "./sql-schema.js";

/** Symbol rules per pack id, written against `queries/<lang>/*.scm`. */
export const SYMBOL_RULES: Readonly<Record<string, PackSymbolRules>> = {
  java: {
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
  },
  go: {
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
  },
  sql: {
    rules: [
      {
        query: "tables",
        declaration: "create.table",
        name: "create.table",
        kind: "table",
        read: (text) => {
          const parts = splitSqlName(text);
          const name = parts.at(-1);
          const schema = parts.length > 1 ? parts.at(-2) : undefined;
          if (name === undefined) return undefined;
          return schema === undefined ? { name } : { name, container: schema };
        },
      },
    ],
  },
};

/** The runtime's `factGaps`, with this pack's rules from {@link SYMBOL_RULES}. */
export function factGaps(pack: LanguagePack): string[] {
  return runtimeFactGaps(pack, SYMBOL_RULES[pack.id]);
}

/** The runtime's `readPackFacts`, with this pack's rules from {@link SYMBOL_RULES}. */
export function readPackFacts(
  pack: LanguagePack,
  file: PackSourceFile,
  options: Omit<ReadFactsOptions, "symbolRules"> = {},
): FileFacts {
  return runtimeReadPackFacts(pack, file, { ...options, symbolRules: SYMBOL_RULES[pack.id] });
}
