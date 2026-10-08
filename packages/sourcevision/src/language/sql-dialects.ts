/**
 * Classifies a SQL file's dialect from syntax markers, path names and the
 * migration tool's configuration. Results stay in memory: nothing here is
 * written to an analysis artifact.
 *
 * Every rule records provenance. A `vendor-docs` rule names the documentation
 * page that defines the marker and the date that page was checked; a
 * `convention` rule rests on a naming convention and says so. Rules whose
 * vendor page could not be checked are not syntax rules here (H2 and HSQLDB
 * are recognised by path and config only).
 *
 * Config is read for URL schemes and engine names only; hosts, users and
 * passwords are never read into a result.
 *
 * @module sourcevision/language/sql-dialects
 */

export type SqlDialect = "postgresql" | "mysql" | "mssql" | "oracle" | "sqlite" | "h2" | "unknown";
export type DialectConfidence = "high" | "medium" | "low" | "none";

export type Provenance =
  | { readonly kind: "vendor-docs"; readonly url: string; readonly verified: string }
  | { readonly kind: "convention"; readonly note: string };

export type RuleSource = "syntax" | "path" | "config";

export interface DialectRule {
  readonly id: string;
  readonly dialect: Exclude<SqlDialect, "unknown">;
  readonly source: RuleSource;
  /** What a hit adds to the dialect's score. */
  readonly weight: number;
  readonly pattern: RegExp;
  readonly provenance: Provenance;
}

export interface DialectEvidence {
  readonly ruleId: string;
  readonly dialect: Exclude<SqlDialect, "unknown">;
  readonly source: RuleSource;
  readonly weight: number;
  /** One-based line of the first hit; absent for path and config hits. */
  readonly line?: number;
  /** The matched text (a keyword or URL scheme, never a host or credential). */
  readonly text: string;
}

export interface SqlDialectResult {
  readonly path: string;
  readonly dialect: SqlDialect;
  readonly confidence: DialectConfidence;
  readonly evidence: readonly DialectEvidence[];
}

const VERIFIED = "2026-10-08";
const docs = (url: string): Provenance => ({ kind: "vendor-docs", url, verified: VERIFIED });
const PG = "https://www.postgresql.org/docs/current";
const MYSQL = "https://dev.mysql.com/doc/refman/8.4/en";
const MSSQL = "https://learn.microsoft.com";
const ORACLE = "https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf";
const SQLITE = "https://www.sqlite.org";
const PATH_CONVENTION: Provenance = {
  kind: "convention",
  note: "projects name migration folders and files after the engine they target",
};
const JDBC_CONVENTION: Provenance = {
  kind: "convention",
  note: "the URL scheme is the engine's driver subprotocol (JDBC) or connection-string scheme",
};

/** Syntax markers, matched against the file with comments removed. */
export const SYNTAX_RULES: readonly DialectRule[] = [
  { id: "pg-serial", dialect: "postgresql", source: "syntax", weight: 1, pattern: /\b(?:big|small)?serial\b/i, provenance: docs(`${PG}/datatype-numeric.html`) },
  { id: "pg-returning", dialect: "postgresql", source: "syntax", weight: 1, pattern: /\breturning\b/i, provenance: docs(`${PG}/dml-returning.html`) },
  { id: "pg-dollar-quote", dialect: "postgresql", source: "syntax", weight: 2, pattern: /\$(?:[A-Za-z_]\w*)?\$/, provenance: docs(`${PG}/sql-syntax-lexical.html`) },
  { id: "mysql-auto-increment", dialect: "mysql", source: "syntax", weight: 2, pattern: /\bauto_increment\b/i, provenance: docs(`${MYSQL}/example-auto-increment.html`) },
  { id: "mysql-backtick", dialect: "mysql", source: "syntax", weight: 2, pattern: /`[^`\n]+`/, provenance: docs(`${MYSQL}/identifiers.html`) },
  { id: "mysql-engine", dialect: "mysql", source: "syntax", weight: 2, pattern: /\bengine\s*=\s*\w+/i, provenance: docs(`${MYSQL}/innodb-introduction.html`) },
  { id: "mssql-identity-seed", dialect: "mssql", source: "syntax", weight: 3, pattern: /\bidentity\s*\(\s*\d+\s*,\s*\d+\s*\)/i, provenance: docs(`${MSSQL}/en-us/sql/t-sql/statements/create-table-transact-sql-identity-property`) },
  { id: "mssql-go-batch", dialect: "mssql", source: "syntax", weight: 3, pattern: /^[ \t]*go(?:[ \t]+\d+)?[ \t]*$/im, provenance: docs(`${MSSQL}/en-us/sql/t-sql/language-elements/sql-server-utilities-statements-go`) },
  { id: "mssql-bracket-identifier", dialect: "mssql", source: "syntax", weight: 2, pattern: /\[[A-Za-z_][\w ]*\]/, provenance: docs(`${MSSQL}/en-us/sql/relational-databases/databases/database-identifiers`) },
  { id: "oracle-varchar2", dialect: "oracle", source: "syntax", weight: 3, pattern: /\bn?varchar2\s*\(/i, provenance: docs(`${ORACLE}/Data-Types.html`) },
  { id: "oracle-number", dialect: "oracle", source: "syntax", weight: 1, pattern: /\bnumber\s*(?:\(|,|\))/i, provenance: docs(`${ORACLE}/Data-Types.html`) },
  { id: "sqlite-autoincrement", dialect: "sqlite", source: "syntax", weight: 3, pattern: /\bautoincrement\b/i, provenance: docs(`${SQLITE}/autoinc.html`) },
  { id: "sqlite-pragma", dialect: "sqlite", source: "syntax", weight: 3, pattern: /^\s*pragma\s+\w+/im, provenance: docs(`${SQLITE}/pragma.html`) },
];

/** Path tokens: directory and file name parts split on `/ . - _`, lower-cased. */
const PATH_TOKENS: ReadonlyArray<readonly [Exclude<SqlDialect, "unknown">, readonly string[]]> = [
  ["postgresql", ["postgres", "postgresql", "pgsql", "psql"]],
  ["mysql", ["mysql", "mariadb"]],
  ["mssql", ["mssql", "sqlserver", "tsql"]],
  ["oracle", ["oracle", "plsql"]],
  ["sqlite", ["sqlite", "sqlite3"]],
  ["h2", ["h2", "hsqldb", "hsql"]],
];

export const PATH_RULES: readonly DialectRule[] = PATH_TOKENS.map(([dialect, tokens]) => ({
  id: `path-${dialect}`,
  dialect,
  source: "path" as const,
  weight: 2,
  pattern: new RegExp(`(?:^|[/._-])(?:${tokens.join("|")})(?:$|[/._-])`, "i"),
  provenance: PATH_CONVENTION,
}));

/**
 * Config markers, matched against a migration tool's config file. They match
 * the scheme or engine name only, so no host or credential is ever captured.
 */
export const CONFIG_RULES: readonly DialectRule[] = [
  { id: "config-postgresql", dialect: "postgresql", source: "config", weight: 1, pattern: /\b(?:jdbc:postgresql|postgres(?:ql)?):\/\/|\bengine\s*[:=]\s*["']?postgresql\b|\bdialect\s*[:=]\s*["']?postgres\b/i, provenance: JDBC_CONVENTION },
  { id: "config-mysql", dialect: "mysql", source: "config", weight: 1, pattern: /\b(?:jdbc:(?:mysql|mariadb)|mysql):\/\/|\bengine\s*[:=]\s*["']?mysql\b|\bdialect\s*[:=]\s*["']?mysql\b/i, provenance: JDBC_CONVENTION },
  { id: "config-mssql", dialect: "mssql", source: "config", weight: 1, pattern: /\b(?:jdbc:sqlserver|sqlserver):\/\/|\bdialect\s*[:=]\s*["']?(?:mssql|sqlserver)\b/i, provenance: JDBC_CONVENTION },
  { id: "config-oracle", dialect: "oracle", source: "config", weight: 1, pattern: /\bjdbc:oracle:/i, provenance: JDBC_CONVENTION },
  { id: "config-sqlite", dialect: "sqlite", source: "config", weight: 1, pattern: /\bjdbc:sqlite:|\bsqlite3?:\/\/|\bengine\s*[:=]\s*["']?sqlite\b|\bdialect\s*[:=]\s*["']?sqlite3?\b/i, provenance: JDBC_CONVENTION },
  { id: "config-h2", dialect: "h2", source: "config", weight: 1, pattern: /\bjdbc:(?:h2|hsqldb):/i, provenance: JDBC_CONVENTION },
];

/** Strip `--` line comments and block comments, keeping line breaks so line numbers hold. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, "");
}

const lineOf = (text: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

/** Evidence from a migration tool's config file; scheme and engine names only. */
export function dialectEvidenceFromConfig(content: string): DialectEvidence[] {
  const out: DialectEvidence[] = [];
  for (const rule of CONFIG_RULES) {
    const hit = rule.pattern.exec(content);
    if (hit) out.push({ ruleId: rule.id, dialect: rule.dialect, source: "config", weight: rule.weight, text: hit[0] });
  }
  return out;
}

function confidenceFor(top: number, second: number): DialectConfidence {
  if (top <= 0) return "none";
  const margin = top - second;
  if (top >= 3 && margin >= 2) return "high";
  if (top >= 2 && margin >= 1) return "medium";
  return "low";
}

/**
 * Classify one SQL file.
 *
 * @param configEvidence Evidence from `dialectEvidenceFromConfig` for the
 *   migration tool that owns the file. It adds to its dialect's score.
 */
export function classifySqlDialect(
  path: string,
  source: string,
  configEvidence: readonly DialectEvidence[] = [],
): SqlDialectResult {
  const text = stripComments(source);
  const evidence: DialectEvidence[] = [];
  for (const rule of SYNTAX_RULES) {
    const hit = rule.pattern.exec(text);
    if (hit) {
      evidence.push({ ruleId: rule.id, dialect: rule.dialect, source: "syntax", weight: rule.weight, line: lineOf(text, hit.index), text: hit[0].trim() });
    }
  }
  for (const rule of PATH_RULES) {
    const hit = rule.pattern.exec(path);
    if (hit) evidence.push({ ruleId: rule.id, dialect: rule.dialect, source: "path", weight: rule.weight, text: hit[0].replace(/^[/._-]|[/._-]$/g, "") });
  }
  evidence.push(...configEvidence);

  const scores = new Map<Exclude<SqlDialect, "unknown">, number>();
  for (const item of evidence) scores.set(item.dialect, (scores.get(item.dialect) ?? 0) + item.weight);
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [top, second] = [ranked[0], ranked[1]];
  // A tie has no winner: say unknown rather than pick by name order.
  if (!top || (second && second[1] === top[1])) {
    return { path, dialect: "unknown", confidence: "none", evidence };
  }
  return { path, dialect: top[0], confidence: confidenceFor(top[1], second?.[1] ?? 0), evidence };
}
