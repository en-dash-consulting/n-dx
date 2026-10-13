/**
 * The symbol rules of the SQL pack, written against `queries/sql/tables.scm`.
 *
 * SQL's only query names tables. A `CREATE TABLE` is a symbol of kind
 * `table`: its name is the unquoted last part of the object reference, its
 * container the schema (the part before it), and its span the reference's
 * span. An `ALTER TABLE` declares nothing, so it is not a symbol;
 * `sql-schema.ts` still reads both statements from the captures.
 *
 * @module lang-sql/sql-facts
 */

import type { PackSymbolRules } from "@n-dx/lang-runtime";
import { splitSqlName } from "./sql-schema.js";

export const SQL_SYMBOL_RULES: PackSymbolRules = {
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
};
