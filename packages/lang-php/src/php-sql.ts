/**
 * Table names from SQL passed to PHP's database calls. Results stay in
 * memory: nothing here is written to an analysis artifact, as for the Java
 * and Go packs' embedded SQL.
 *
 * Works on the PHP pack's `sql` query (`queries/php/sql.scm`): the mysql,
 * mysqli, pgsql, oci8, sqlsrv and odbc query and prepare functions, Drupal 7's
 * `db_query`, and query, prepare, exec and fetch methods on any receiver or
 * scope. Method names such as `query` or `select` are common, so an argument
 * counts only when its text begins with a statement verb (lang-kit's
 * `looksLikeSql`).
 *
 * An argument's SQL text is read from single- and double-quoted strings,
 * heredocs and nowdocs, `.` concatenations of them, and constants the
 * repository defines once; a variable passed whole is read from its last
 * plain assignment before the call in its scope and the `.=` appends after
 * it. Anything else (an interpolation, a variable inside a concatenation, a
 * call) is a placeholder that never names a table, nor does a word it touches
 * (`FROM {$prefix}users`). Drupal's `{table}` prefix braces are dropped.
 *
 * @module lang-php/php-sql
 */

import { extractSqlTableReferences, looksLikeSql, type EmbeddedSqlTable, type SourcePosition } from "@n-dx/lang-kit";
import { innermostEach, type Capture, type PackSourceFile } from "@n-dx/lang-runtime";
import { before, readAssignments, scopeAt, type Assignment } from "./php-assignments.js";
import { evaluatePath, repositoryConstants, type ConstantLookup } from "./php-includes.js";

export const SQL_QUERY = "sql";

/** The functions the query's function pattern must match, so a test can hold the two in step. */
export const PHP_SQL_FUNCTIONS: readonly string[] = [
  "mysql_query", "mysql_unbuffered_query", "mysql_db_query",
  "mysqli_query", "mysqli_multi_query", "mysqli_real_query", "mysqli_prepare",
  "pg_query", "pg_query_params", "pg_prepare", "pg_send_query", "pg_send_query_params", "pg_send_prepare",
  "oci_parse", "sqlsrv_query", "sqlsrv_prepare", "odbc_exec", "odbc_do", "odbc_prepare",
  "db_query", "db_query_range",
];

/** The methods the query's method patterns must match. */
export const PHP_SQL_METHODS: readonly string[] = [
  "query", "prepare", "exec", "multi_query", "real_query", "executequery", "executestatement", "executeupdate",
  "fetchall", "fetchassoc", "fetchrow", "fetchone", "fetchcol", "fetchpairs", "fetchcolumn", "fetcharray",
  "fetchallassociative", "fetchassociative", "fetchallnumeric", "fetchnumeric", "fetchfirstcolumn",
  "select", "insert", "update", "delete", "statement", "unprepared",
];

/** Stands for a value that is not known; never part of a table name. */
const PLACEHOLDER = "\u0000";

/** A placeholder and any name it touches (`users_$year`, `{$db}.orders`). */
const TOUCHED = /[\w$.`{}]*\u0000[\w$.`{}]*/g;

/** Drupal's table prefix braces: `{users}`. */
const DRUPAL_TABLE = /\{([A-Za-z_]\w*)\}/g;

const HEREDOC = /^<<<[ \t]*(["']?)([A-Za-z_\x80-\uffff][\w\x80-\uffff]*)\1\r?\n/;

/** Double-quoted escapes; a line break or tab is a space, as SQL reads it. */
const ESCAPES: Readonly<Record<string, string>> = { n: " ", t: " ", r: " ", v: " ", f: " ", e: " ", "\\": "\\", $: "$", '"': '"' };

const countLines = (text: string): number => {
  let n = 0;
  for (const c of text) if (c === "\n") n += 1;
  return n;
};

/** The index just past the string opened at `start`, or -1. */
function quotedEnd(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === "\\") i += 1;
    else if (text[i] === quote) return i + 1;
  }
  return -1;
}

/** The index just past the heredoc or nowdoc opened at `start`, or -1. */
function heredocEnd(text: string, start: number): number {
  const header = HEREDOC.exec(text.slice(start));
  if (!header) return -1;
  // PHP 7.3+: the closing identifier may be indented and followed by more code.
  const close = new RegExp(String.raw`\n[ \t]*${header[2]}(?![\w\x80-\uffff])`).exec(text.slice(start + header[0].length - 1));
  return close ? start + header[0].length - 1 + close.index + close[0].length : -1;
}

/** One operand of a top-level `.` concatenation, with its offset in the argument. */
interface Operand {
  readonly text: string;
  readonly offset: number;
}

/** The operands of an argument's top-level `.` concatenation; undefined for any other expression at the top level. */
export function sqlOperands(text: string): Operand[] | undefined {
  const out: Operand[] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number): boolean => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed === "") return false;
    out.push({ text: trimmed, offset: start + lead });
    return true;
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === "'" || c === '"') {
      const end = quotedEnd(text, i);
      if (end < 0) return undefined;
      i = end - 1;
    } else if (text.startsWith("<<<", i)) {
      const end = heredocEnd(text, i);
      if (end < 0) return undefined;
      i = end - 1;
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
      if (i <= 0) return undefined;
    } else if ((c === "/" && text[i + 1] === "/") || (c === "#" && text[i + 1] !== "[")) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
    } else if (depth === 0 && (text.startsWith("->", i) || text.startsWith("::", i))) i += 1;
    else if (depth === 0 && text.startsWith("?->", i)) i += 2;
    else if (depth === 0 && (/[?:|&^<>=!+*%-]/.test(c) || (!/[\w$\x80-\uffff]/.test(text[i - 1] ?? "") && /^(and|or|xor|instanceof)\b/i.test(text.slice(i))))) {
      return undefined;
    } else if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth < 0) return undefined;
    } else if (c === "." && depth === 0 && !(/[0-9]/.test(text[i - 1] ?? "") && /[0-9]/.test(text[i + 1] ?? ""))) {
      if (!push(i)) return undefined;
      start = i + 1;
    }
  }
  if (depth !== 0 || !push(text.length)) return undefined;
  return out;
}

/** Where the interpolation starting at `body[at]` ends (exclusive); -1 when none starts there. */
function interpolationEnd(body: string, at: number): number {
  const brace = body[at] === "{" && body[at + 1] === "$" ? at : body[at] === "$" && body[at + 1] === "{" ? at + 1 : -1;
  if (brace >= 0) {
    let depth = 0;
    for (let i = brace; i < body.length; i += 1) {
      if (body[i] === "{") depth += 1;
      else if (body[i] === "}" && --depth === 0) return i + 1;
    }
    return body.length;
  }
  const name = /^\$[A-Za-z_\x80-\uffff][\w\x80-\uffff]*/.exec(body.slice(at));
  if (!name) return -1;
  let end = at + name[0].length;
  if (body[end] === "[") {
    const close = body.indexOf("]", end);
    end = close < 0 ? body.length : close + 1;
  } else {
    const property = /^->[A-Za-z_\x80-\uffff][\w\x80-\uffff]*/.exec(body.slice(end));
    if (property) end += property[0].length;
  }
  return end;
}

/** A double-quoted string's or heredoc's body: escapes read, each interpolation a placeholder. */
function interpolated(body: string, heredoc: boolean): string {
  let out = "";
  for (let i = 0; i < body.length; ) {
    const c = body[i]!;
    if (c === "\\" && body[i + 1] !== undefined && body[i + 1]! in ESCAPES && !(heredoc && body[i + 1] === '"')) {
      out += ESCAPES[body[i + 1]!];
      i += 2;
      continue;
    }
    const end = interpolationEnd(body, i);
    if (end > i) {
      out += PLACEHOLDER;
      i = end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** An operand's text, and how many lines after the operand's own its text starts. */
function operandText(operand: string, file: string, constant: ConstantLookup): { readonly text: string; readonly lineShift: number } {
  if (operand.startsWith("'") && quotedEnd(operand, 0) === operand.length) {
    return { text: operand.slice(1, -1).replace(/\\(['\\])/g, "$1"), lineShift: 0 };
  }
  if (operand.startsWith('"') && quotedEnd(operand, 0) === operand.length) {
    return { text: interpolated(operand.slice(1, -1), false), lineShift: 0 };
  }
  const header = HEREDOC.exec(operand);
  if (header && heredocEnd(operand, 0) === operand.length) {
    const body = operand.slice(header[0].length, operand.lastIndexOf("\n"));
    return { text: header[1] === "'" ? body : interpolated(body, true), lineShift: 1 };
  }
  return { text: evaluatePath(operand, file, constant) ?? PLACEHOLDER, lineShift: 0 };
}

/** SQL text with each part on its source line, relative to the first part's. */
class SqlText {
  private text = "";
  private line: number | undefined;
  private first: number | undefined;

  /** Adds the text of an argument or assigned value written from `line`. */
  add(written: string, line: number, file: string, constant: ConstantLookup): void {
    for (const operand of sqlOperands(written) ?? [{ text: written.trim(), offset: 0 }]) {
      const { text, lineShift } = operandText(operand.text, file, constant);
      const at = line + countLines(written.slice(0, operand.offset)) + lineShift;
      this.first ??= at;
      this.line ??= at;
      if (at > this.line) {
        this.text += "\n".repeat(at - this.line);
        this.line = at;
      }
      this.text += text;
      this.line += countLines(text);
    }
  }

  /** The tables the text names, on their source lines. */
  tables(): { name: string; schema?: string; line: number }[] {
    const sql = this.text.replace(TOUCHED, " ? ").replace(DRUPAL_TABLE, "$1");
    if (this.first === undefined || !looksLikeSql(sql)) return [];
    return extractSqlTableReferences(sql, this.first);
  }
}

/** One call of the `sql` query: its name as written and its arguments in order. */
interface SqlCall {
  readonly name: string;
  readonly arguments: readonly Capture[];
}

const spanKey = (c: Capture): string => `${c.start.line}:${c.start.column}-${c.end.line}:${c.end.column}`;

function readSqlCalls(captures: readonly Capture[]): SqlCall[] {
  const calls = new Map<string, { node: Capture; name?: Capture; arguments: Map<string, Capture> }>();
  const nodes = captures.filter((c) => c.name === "sql.call");
  for (const node of nodes) if (!calls.has(spanKey(node))) calls.set(spanKey(node), { node, arguments: new Map() });
  const parts = captures.filter((c) => c.name === "sql.name" || c.name === "sql.argument");
  // Strict: an argument that is itself a matched call (`mysql_query($db->query(…))`) belongs to the outer one.
  innermostEach(nodes, parts, true).forEach((owner, i) => {
    const call = owner && calls.get(spanKey(owner));
    const part = parts[i]!;
    if (!call) return;
    if (part.name === "sql.argument") call.arguments.set(spanKey(part), part);
    else if (call.name === undefined || before(part.start, call.name.start)) call.name = part;
  });
  return [...calls.values()].flatMap(({ name, arguments: args }) =>
    name ? [{ name: name.text.replace(/^\\/, ""), arguments: [...args.values()].sort((a, b) => (before(a.start, b.start) ? -1 : 1)) }] : [],
  );
}

/** The plain assignment a variable last had before `at` in its scope, and the `.=` appends after it; empty when another assignment intervenes. */
function assignedText(assignments: readonly (Assignment & { readonly scope: Capture | undefined })[], name: string, scope: Capture | undefined, at: SourcePosition): Assignment[] {
  let chain: Assignment[] = [];
  for (const a of assignments) {
    if (!before(a.start, at)) break;
    if (a.name !== name || a.scope !== scope) continue;
    if (a.operator === undefined) chain = a.value === undefined ? [] : [a];
    else if (a.operator === ".=" && a.value !== undefined && chain.length > 0) chain.push(a);
    else chain = [];
  }
  return chain;
}

/** One file's embedded SQL tables, in call order. */
export function readFileEmbeddedSql(file: PackSourceFile, constant: ConstantLookup): EmbeddedSqlTable[] {
  const captures = file.captures[SQL_QUERY] ?? [];
  if (captures.length === 0) return [];
  let assignments: (Assignment & { readonly scope: Capture | undefined })[] | undefined;
  const tables: EmbeddedSqlTable[] = [];
  for (const call of readSqlCalls(captures)) {
    for (const argument of call.arguments) {
      const written = argument.text.trim();
      if (written.startsWith("...") || /^[A-Za-z_]\w*\s*:(?!:)/.test(written)) continue; // a spread or a named argument
      const sql = new SqlText();
      const variable = /^\$([A-Za-z_]\w*)$/.exec(written);
      if (variable) {
        assignments ??= readAssignments(file).map((a) => ({ ...a, scope: scopeAt(file, a.start) }));
        for (const a of assignedText(assignments, variable[1]!, scopeAt(file, argument.start), argument.start)) sql.add(a.value!, a.start.line, file.path, constant);
      } else sql.add(argument.text, argument.start.line, file.path, constant);
      for (const ref of sql.tables()) {
        tables.push({ name: ref.name, ...(ref.schema === undefined ? {} : { schema: ref.schema }), path: file.path, line: ref.line, origin: "call", via: call.name });
      }
    }
  }
  return tables;
}

/** The tables named by SQL passed to PHP database calls, file by file. */
export function extractPhpEmbeddedSql(files: readonly PackSourceFile[]): EmbeddedSqlTable[] {
  const constant = repositoryConstants(files);
  return files.flatMap((file) => readFileEmbeddedSql(file, constant));
}
