/**
 * Table names referenced by one SQL (or JPQL) statement, and the shape of an
 * embedded-SQL finding. Results stay in memory: nothing here is written to an
 * analysis artifact.
 *
 * This is a token scan, not a SQL parser: it reads the name after FROM, JOIN,
 * UPDATE, INTO and TRUNCATE, so it works on any dialect and on JPQL. It
 * knows the shapes that would otherwise produce false tables: CTE names,
 * `EXTRACT(x FROM y)`, `IS DISTINCT FROM`, `FOR UPDATE` and `DO UPDATE`, functions and subqueries
 * after FROM, and JPQL paths such as `JOIN o.pets`. Bracket-quoted names
 * (`[dbo].[t]`) and dollar-quoted strings are not read.
 *
 * Pure text, so every pack that reads embedded SQL (Java, Go) shares it
 * without depending on another pack.
 *
 * @module lang-kit/sql-references
 */

export interface SqlTableReference {
  /** Unquoted table (or JPQL entity) name. */
  readonly name: string;
  /** Unquoted qualifier: the second-to-last part of a dotted name. */
  readonly schema?: string;
  /** One-based line in the file, given the `baseLine` the statement starts on. */
  readonly line: number;
}

/** A table named by SQL embedded in source code or in a sqlc query file. */
export interface EmbeddedSqlTable {
  readonly name: string;
  readonly schema?: string;
  /** Project-relative path of the file holding the SQL. */
  readonly path: string;
  /** One-based line of the table name (the literal's line for a single-line string). */
  readonly line: number;
  /** `annotation`: Java annotation; `call`: a string argument of a call; `query-file`: a sqlc query file. */
  readonly origin: "annotation" | "call" | "query-file";
  /** What carries the SQL: `@Query`, `@Table`, `JdbcTemplate.query`, `QueryRow`, `sqlc GetAuthor`. */
  readonly via: string;
  /** The JPQL entity the name was mapped from, when `via` is a JPQL `@Query`. */
  readonly entity?: string;
}

interface Token {
  readonly kind: "word" | "ident" | "string" | "punct";
  /** Identifier text unquoted; the character for punctuation. */
  readonly text: string;
  readonly line: number;
}

const WORD_START = /[A-Za-z_]/;
const WORD_PART = /[\w$]/;

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let i = 0;
  const readQuoted = (close: string, kind: "ident" | "string"): void => {
    const startLine = line;
    let text = "";
    i++;
    while (i < sql.length) {
      const ch = sql[i]!;
      if (ch === close) {
        if (sql[i + 1] === close) {
          text += close;
          i += 2;
          continue;
        }
        i++;
        break;
      }
      if (ch === "\n") line++;
      text += ch;
      i++;
    }
    tokens.push({ kind, text, line: startLine });
  };
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "\n") {
      line++;
      i++;
    } else if (/\s/.test(ch)) {
      i++;
    } else if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        if (sql[i] === "\n") line++;
        i++;
      }
      i += 2;
    } else if (ch === "'") {
      readQuoted("'", "string");
    } else if (ch === '"' || ch === "`") {
      readQuoted(ch, "ident");
    } else if (WORD_START.test(ch)) {
      const start = i;
      while (i < sql.length && WORD_PART.test(sql[i]!)) i++;
      tokens.push({ kind: "word", text: sql.slice(start, i), line });
    } else {
      tokens.push({ kind: "punct", text: ch, line });
      i++;
    }
  }
  return tokens;
}

const lower = (token: Token | undefined): string | undefined =>
  token?.kind === "word" ? token.text.toLowerCase() : undefined;

const isPunct = (token: Token | undefined, text: string): boolean => token?.kind === "punct" && token.text === text;

/** Statement verbs that open a data statement; see {@link looksLikeSql}. */
const STATEMENT_VERBS = new Set(["select", "insert", "update", "delete", "with", "merge", "replace", "truncate"]);

/** True when the first word of `text` (after comments) is a data-statement verb. */
export function looksLikeSql(text: string): boolean {
  const first = tokenize(text).find((token) => token.kind !== "punct" || token.text !== "(");
  return first !== undefined && STATEMENT_VERBS.has(lower(first) ?? "");
}

/** Words that follow a table reference and so are never its alias. */
const CLAUSE_WORDS = new Set([
  "where", "join", "inner", "left", "right", "full", "outer", "cross", "natural", "straight_join",
  "on", "using", "group", "order", "having", "limit", "offset", "fetch", "union", "intersect", "except",
  "window", "for", "set", "values", "select", "returning", "lateral", "with", "when", "then",
]);

/** Words that cannot name a table where one is expected. */
const NOT_A_TABLE = new Set(["select", "values", "set", "where", "lateral", "unnest", "dual"]);

/** Modifiers between the keyword and the table name. */
const MODIFIERS = new Set(["only", "ignore", "low_priority", "fetch", "table"]);

/** Functions whose argument syntax contains a FROM that is not a table source. */
const FROM_FUNCTIONS = new Set(["extract", "trim", "substring", "overlay"]);

/** The word before an UPDATE that makes it a clause rather than a statement. */
const UPDATE_CLAUSE_PREFIX = new Set(["for", "do", "key", "on"]);

const TRIGGERS = new Set(["from", "join", "update", "into", "truncate"]);

/** Parse a possibly dotted name starting at `index`; `next` is the token after it. */
function readName(tokens: readonly Token[], index: number): { parts: string[]; next: number } | undefined {
  const parts: string[] = [];
  let i = index;
  for (;;) {
    const token = tokens[i];
    if (token?.kind !== "word" && token?.kind !== "ident") break;
    parts.push(token.text);
    i++;
    if (isPunct(tokens[i], ".") && (tokens[i + 1]?.kind === "word" || tokens[i + 1]?.kind === "ident")) i++;
    else break;
  }
  return parts.length === 0 ? undefined : { parts, next: i };
}

/** Names bound by `WITH name [(cols)] AS (` and `, name AS (`. */
function cteNames(tokens: readonly Token[]): Set<string> {
  const names = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    if (lower(tokens[i]) !== "as") continue;
    let open = i + 1;
    if (lower(tokens[open]) === "not") open++;
    if (lower(tokens[open]) === "materialized") open++;
    if (!isPunct(tokens[open], "(")) continue;
    let nameAt = i - 1;
    if (isPunct(tokens[nameAt], ")")) {
      let depth = 0;
      for (; nameAt >= 0; nameAt--) {
        if (isPunct(tokens[nameAt], ")")) depth++;
        else if (isPunct(tokens[nameAt], "(") && --depth === 0) break;
      }
      nameAt--;
    }
    const name = tokens[nameAt];
    const before = tokens[nameAt - 1];
    if ((name?.kind === "word" || name?.kind === "ident") && (isPunct(before, ",") || ["with", "recursive"].includes(lower(before) ?? ""))) {
      names.add(name.text.toLowerCase());
    }
  }
  return names;
}

/**
 * Tables a statement reads or writes, in order of first appearance, one per
 * name. `baseLine` is the file line the statement's first character is on.
 *
 * A single-part name that is a CTE of the statement is not a table. Names are
 * returned as written, so a JPQL caller gets entity names to map.
 */
export function extractSqlTableReferences(sql: string, baseLine = 1): SqlTableReference[] {
  const tokens = tokenize(sql);
  const ctes = cteNames(tokens);
  const aliases = new Set<string>();
  const found = new Map<string, SqlTableReference>();
  /** The word before each currently open parenthesis. */
  const openedBy: Array<string | undefined> = [];

  const record = (parts: readonly string[], line: number): void => {
    const name = parts.at(-1)!;
    if (parts.length === 1 && ctes.has(name.toLowerCase())) return;
    const schema = parts.length > 1 ? parts.at(-2) : undefined;
    const key = `${schema ?? ""}.${name}`.toLowerCase();
    if (found.has(key)) return;
    found.set(key, { name, ...(schema === undefined ? {} : { schema }), line: baseLine + line - 1 });
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (isPunct(token, "(")) openedBy.push(lower(tokens[i - 1]));
    else if (isPunct(token, ")")) openedBy.pop();

    // sqlc names a table inside `sqlc.embed(authors)`.
    if (lower(token) === "sqlc" && isPunct(tokens[i + 1], ".") && lower(tokens[i + 2]) === "embed" && isPunct(tokens[i + 3], "(")) {
      const embedded = readName(tokens, i + 4);
      if (embedded) record(embedded.parts, tokens[i + 4]!.line);
      continue;
    }

    const keyword = lower(token);
    if (keyword === undefined || !TRIGGERS.has(keyword)) continue;
    if (keyword === "update" && UPDATE_CLAUSE_PREFIX.has(lower(tokens[i - 1]) ?? "")) continue;
    if (keyword === "from" && FROM_FUNCTIONS.has(openedBy.at(-1) ?? "")) continue;
    // `a IS [NOT] DISTINCT FROM b` compares values; b is not a table.
    if (keyword === "from" && lower(tokens[i - 1]) === "distinct") continue;

    let at = i + 1;
    while (MODIFIERS.has(lower(tokens[at]) ?? "")) at++;
    for (;;) {
      const name = readName(tokens, at);
      if (!name) break;
      const first = tokens[at]!;
      if (first.kind === "word" && NOT_A_TABLE.has(first.text.toLowerCase()) && name.parts.length === 1) break;
      // A function or a derived table (`from generate_series(...)`), not a name.
      if ((keyword === "from" || keyword === "join") && isPunct(tokens[name.next], "(")) break;
      // A JPQL path from an alias (`join o.pets`), not a table.
      const isPath = name.parts.length > 1 && aliases.has(name.parts[0]!);
      if (!isPath) record(name.parts, first.line);

      let next = name.next;
      if (lower(tokens[next]) === "as") next++;
      const alias = tokens[next];
      if ((alias?.kind === "word" && !CLAUSE_WORDS.has(alias.text.toLowerCase())) || alias?.kind === "ident") {
        aliases.add(alias.text);
        next++;
      }
      if (keyword === "from" && isPunct(tokens[next], ",")) {
        at = next + 1;
        continue;
      }
      break;
    }
  }
  return [...found.values()];
}

const SQLC_QUERY_NAME = /^--\s*name:\s*(\w+)/;

/**
 * Tables named by the queries of a sqlc query file. Each `-- name: Foo :one`
 * comment opens a query that runs to the next one; SQL before the first is
 * ignored.
 */
export function extractSqlcTables(path: string, content: string): EmbeddedSqlTable[] {
  const lines = content.split("\n");
  const tables: EmbeddedSqlTable[] = [];
  let current: { name: string; startLine: number; body: string[] } | undefined;
  const flush = (): void => {
    if (!current) return;
    for (const ref of extractSqlTableReferences(current.body.join("\n"), current.startLine)) {
      tables.push({
        name: ref.name,
        ...(ref.schema === undefined ? {} : { schema: ref.schema }),
        path,
        line: ref.line,
        origin: "query-file",
        via: `sqlc ${current.name}`,
      });
    }
  };
  lines.forEach((text, index) => {
    const opened = SQLC_QUERY_NAME.exec(text);
    if (opened) {
      flush();
      current = { name: opened[1]!, startLine: index + 2, body: [] };
    } else {
      current?.body.push(text);
    }
  });
  flush();
  return tables;
}
