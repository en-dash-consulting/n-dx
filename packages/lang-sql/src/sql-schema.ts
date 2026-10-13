/**
 * Table names from SQL files. Results stay in memory: nothing here is written
 * to an analysis artifact.
 *
 * The grammar is generic across dialects, so a file can parse with errors; the
 * result says so rather than assuming it parsed, and a table is reported only
 * when the grammar recognised its statement.
 *
 * @module lang-sql/sql-schema
 */

import { sqlPack } from "./sql-pack.js";
import type { Capture, RunnablePack, TreeSitterRunner } from "@n-dx/lang-runtime";

export interface SqlTable {
  /** Unquoted table name. */
  readonly name: string;
  /** Unquoted schema (or, for a three-part name, the second-to-last part). */
  readonly schema?: string;
  readonly statement: "create" | "alter";
  /** One-based line of the table name. */
  readonly line: number;
}

export interface SqlSchemaFile {
  readonly path: string;
  /** False when the file was skipped (oversized). */
  readonly parsed: boolean;
  /** The tree has ERROR or MISSING nodes: the dialect likely uses syntax the grammar lacks. */
  readonly hasErrors: boolean;
  readonly tables: readonly SqlTable[];
}

/** Split a possibly quoted, possibly qualified name (`public."Owners"`, `` `db`.`t` ``, `[dbo].[t]`). */
export function splitSqlName(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let close: string | undefined;
  for (const ch of text) {
    if (close) {
      if (ch === close) close = undefined;
      else current += ch;
    } else if (ch === '"' || ch === "`") {
      close = ch;
    } else if (ch === "[") {
      close = "]";
    } else if (ch === ".") {
      parts.push(current);
      current = "";
    } else if (!/\s/.test(ch)) {
      current += ch;
    }
  }
  parts.push(current);
  return parts.filter((part) => part.length > 0);
}

function toTable(capture: Capture): SqlTable | undefined {
  const parts = splitSqlName(capture.text);
  const name = parts.at(-1);
  if (name === undefined) return undefined;
  const schema = parts.length > 1 ? parts.at(-2) : undefined;
  return {
    name,
    ...(schema === undefined ? {} : { schema }),
    statement: capture.name === "create.table" ? "create" : "alter",
    line: capture.start.line,
  };
}

/** Parse `source` and list the tables its CREATE TABLE and ALTER TABLE statements name. */
export async function extractSqlTables(
  runner: TreeSitterRunner,
  target: RunnablePack,
  path: string,
  source: string,
): Promise<SqlSchemaFile> {
  const result = await runner.parseSource(target, path, source);
  if (result.status === "skipped") return { path, parsed: false, hasErrors: false, tables: [] };
  const tables = (result.captures.tables ?? []).flatMap((capture) => toTable(capture) ?? []);
  return {
    path,
    parsed: true,
    hasErrors: result.hasErrorNodes || result.hasMissingNodes,
    tables,
  };
}

/** The pack `extractSqlTables` expects, bound to a built grammar. */
export function sqlTarget(grammarPath: string): RunnablePack {
  return { pack: sqlPack, grammarPath };
}
