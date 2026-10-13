/**
 * Table names from SQL passed to `database/sql` and `sqlx` calls in Go.
 * Results stay in memory: nothing here is written to an analysis artifact.
 * sqlc query files are read by `extractSqlcTables` in `sql-references.ts`.
 *
 * Works on the calls facts of the Go pack's `calls` query. A method name such as
 * `Get` or `Select` is common, so a call counts only when one of its string
 * arguments begins with a statement verb. A query held in a variable or
 * built by concatenation is not seen.
 *
 * @module sourcevision/language/go-sql
 */

import { groupCalls, type ParsedFile } from "@n-dx/lang-runtime";
import { extractSqlTableReferences, looksLikeSql, type EmbeddedSqlTable } from "./sql-references.js";

/** `database/sql` and `sqlx` methods that take a query string, with their Context, Named and Must forms. */
const SQL_METHODS = new Set([
  "Query", "QueryRow", "Exec", "Prepare",
  "QueryContext", "QueryRowContext", "ExecContext", "PrepareContext",
  "Get", "Select", "GetContext", "SelectContext",
  "Queryx", "QueryRowx", "Preparex", "QueryxContext", "QueryRowxContext", "PreparexContext",
  "NamedExec", "NamedQuery", "NamedExecContext", "NamedQueryContext",
  "PrepareNamed", "PrepareNamedContext", "MustExec", "MustExecContext",
]);

/** The text of an interpreted or raw Go string literal. */
export function goStringValue(literal: string): string {
  if (literal.startsWith("`")) return literal.slice(1, -1);
  return literal
    .slice(1, -1)
    .replace(/\\(.)/gs, (_match, ch: string) => (ch === "n" || ch === "t" || ch === "r" ? " " : ch));
}

/** Find the tables named by SQL literals passed to database/sql and sqlx calls. */
export function extractGoEmbeddedSql(files: readonly ParsedFile[]): EmbeddedSqlTable[] {
  const tables: EmbeddedSqlTable[] = [];
  for (const file of files) {
    for (const call of groupCalls(file.captures.calls ?? [])) {
      if (call.callee === undefined || !SQL_METHODS.has(call.callee)) continue;
      for (const literal of call.strings) {
        const text = goStringValue(literal.text);
        if (!looksLikeSql(text)) continue;
        for (const ref of extractSqlTableReferences(text, literal.start.line)) {
          tables.push({
            name: ref.name,
            ...(ref.schema === undefined ? {} : { schema: ref.schema }),
            path: file.path,
            line: ref.line,
            origin: "call",
            via: call.callee,
          });
        }
      }
    }
  }
  return tables;
}
