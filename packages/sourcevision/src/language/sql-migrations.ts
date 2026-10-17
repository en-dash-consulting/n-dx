/**
 * Detects database migration and schema tools from a repository's layout.
 * Results stay in memory: nothing here is written to an analysis artifact.
 *
 * Detection reads file names first and file content only where the name is
 * ambiguous (goose and Liquibase SQL changelogs both live in plain `.sql`
 * files). The one config read for its values is sqlc's `queries:` and `schema:` keys.
 *
 * @module sourcevision/language/sql-migrations
 */

export type MigrationTool = "flyway" | "liquibase" | "golang-migrate" | "goose" | "atlas" | "prisma" | "sqlc";

export interface MigrationToolFinding {
  readonly tool: MigrationTool;
  /** Project-relative files that identify the tool (markers and migrations), sorted. */
  readonly files: readonly string[];
  /**
   * The subset of `files` that are `.sql` files holding schema statements, sorted.
   * For sqlc these are the `schema:` files; its `queries:` files are in `files` only.
   */
  readonly sqlFiles: readonly string[];
  /**
   * sqlc only: the existing `.sql` files under the config's `queries:`, sorted, a
   * subset of `files`. Feed these to `extractSqlcTables`. Absent for other tools.
   */
  readonly queryFiles?: readonly string[];
}

/** Reads a project-relative file, or returns undefined when it cannot be read. */
export type ReadProjectFile = (path: string) => string | undefined;

/** What one file says about one tool: a marker file, or a `.sql` file the tool owns. */
interface Match {
  readonly sql?: true;
}

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const isSql = (path: string): boolean => path.endsWith(".sql");

/** `V1__init.sql`, `V2.1__add_owner.sql`, `R__views.sql` under a `db/migration` directory. */
const FLYWAY_MIGRATION = /(^|\/)db\/migration(\/[^/]+)*\/(V[0-9][\w.]*|R)__[^/]+\.sql$/;
const FLYWAY_CONFIG = new Set(["flyway.conf", "flyway.toml"]);

const LIQUIBASE_CONFIG = new Set(["liquibase.properties"]);
const LIQUIBASE_CHANGELOG_EXT = /\.(xml|ya?ml|json)$/;
const LIQUIBASE_CHANGELOG_FILE = /^(db\.)?changelog[\w.-]*\.(xml|ya?ml|json)$/;
/** `db/changelog/` (Spring Boot default) or any `liquibase/` directory (JHipster's `config/liquibase/`). */
const LIQUIBASE_DIRECTORY = /(^|\/)(db\/changelog|liquibase)\//;
/** XML changelogs open with `<databaseChangeLog`; YAML and JSON ones use the key. */
const LIQUIBASE_CHANGELOG_BODY = /\bdatabaseChangeLog\b/;
const LIQUIBASE_SQL_MARKER = /^--\s*liquibase formatted sql/im;

/** golang-migrate names files `<version>_<title>.up.sql` and `.down.sql`. */
const GOLANG_MIGRATE = /(^|\/)\d+_[^/]+\.(up|down)\.sql$/;
const GOOSE_MARKER = /^--\s*\+goose\s+Up\b/m;

const PRISMA_MIGRATION = /(^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/;
const SQLC_CONFIG = new Set(["sqlc.yaml", "sqlc.yml", "sqlc.json"]);

/** Normalise `./queries/` or `../q` against the config's directory. */
function resolveConfigPath(configDir: string, value: string): string {
  const parts: string[] = configDir === "" ? [] : configDir.split("/");
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/** Drops a YAML ` #` comment that sits outside quotes, and trims the rest. */
function stripYamlComment(raw: string): string {
  let quote: string | undefined;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(raw[i - 1] ?? ""))) {
      return raw.slice(0, i).trim();
    }
  }
  return raw.trim();
}

/**
 * Paths named by `key` (`queries` or `schema`) in a sqlc config, as a scalar,
 * a flow list or a block list (JSON uses `"queries": "query"`). Resolved
 * against the config's directory; a path is a file or a directory of `.sql` files.
 */
export function sqlcPaths(configPath: string, content: string, key: "queries" | "schema"): string[] {
  const keyPattern = new RegExp(`^(\\s*)-?\\s*"?${key}"?\\s*:\\s*(.*)$`);
  const configDir = dirname(configPath);
  const found: string[] = [];
  const lines = content.split("\n");
  const unquote = (raw: string): string => raw.trim().replace(/,$/, "").replace(/^["']|["']$/g, "");
  for (let i = 0; i < lines.length; i++) {
    const entry = keyPattern.exec(lines[i] ?? "");
    if (!entry) continue;
    const value = stripYamlComment(entry[2] ?? "");
    if (value !== "") {
      const list = /^\[(.*)\]$/.exec(value);
      for (const item of list ? (list[1] ?? "").split(",") : [value]) {
        const path = unquote(item);
        if (path !== "") found.push(resolveConfigPath(configDir, path));
      }
      continue;
    }
    const indent = (entry[1] ?? "").length;
    for (let j = i + 1; j < lines.length; j++) {
      const line = (lines[j] ?? "").trim();
      if (line === "" || line.startsWith("#")) continue;
      const item = /^(\s*)-\s*(.+)$/.exec(lines[j] ?? "");
      if (!item || (item[1] ?? "").length < indent) break;
      const path = unquote(stripYamlComment(item[2] ?? ""));
      if (path !== "") found.push(resolveConfigPath(configDir, path));
    }
  }
  return found;
}

function classify(path: string, read: ReadProjectFile): Partial<Record<MigrationTool, Match>> {
  const name = basename(path);
  const out: Partial<Record<MigrationTool, Match>> = {};

  if (isSql(path)) {
    if (FLYWAY_MIGRATION.test(path)) out.flyway = { sql: true };
    if (GOLANG_MIGRATE.test(path)) out["golang-migrate"] = { sql: true };
    if (PRISMA_MIGRATION.test(path)) out.prisma = { sql: true };
    // Goose and Liquibase mark plain `.sql` files by a leading comment.
    const content = read(path);
    if (content !== undefined) {
      if (GOOSE_MARKER.test(content)) out.goose = { sql: true };
      if (LIQUIBASE_SQL_MARKER.test(content)) out.liquibase = { sql: true };
    }
    return out;
  }

  if (FLYWAY_CONFIG.has(name)) out.flyway = {};
  if (name === "atlas.hcl" || name === "atlas.sum") out.atlas = {};
  if (name === "schema.prisma") out.prisma = {};
  if (SQLC_CONFIG.has(name)) out.sqlc = {};
  if (LIQUIBASE_CONFIG.has(name)) {
    out.liquibase = {};
  } else if (
    LIQUIBASE_CHANGELOG_FILE.test(name) ||
    (LIQUIBASE_DIRECTORY.test(path) && LIQUIBASE_CHANGELOG_EXT.test(name))
  ) {
    const content = read(path);
    if (content !== undefined && LIQUIBASE_CHANGELOG_BODY.test(content)) out.liquibase = {};
  }
  return out;
}

/**
 * Find the migration tools a project uses.
 *
 * @param files Project-relative, forward-slash paths of the project's files.
 * @param read Reads one of them; called for `.sql` files, Liquibase changelog
 *   candidates and sqlc configs.
 */
export function detectMigrationTools(files: readonly string[], read: ReadProjectFile): MigrationToolFinding[] {
  const byTool = new Map<MigrationTool, { files: Set<string>; sql: Set<string> }>();
  const sqlcQueries = new Set<string>();
  const note = (tool: MigrationTool, path: string, match: Match): void => {
    const entry = byTool.get(tool) ?? { files: new Set<string>(), sql: new Set<string>() };
    entry.files.add(path);
    if (match.sql) entry.sql.add(path);
    byTool.set(tool, entry);
  };

  const sorted = [...files].sort();
  for (const path of sorted) {
    for (const [tool, match] of Object.entries(classify(path, read)) as [MigrationTool, Match][]) {
      note(tool, path, match);
    }
  }

  // Atlas keeps its migrations beside `atlas.sum`, the directory's checksum file.
  const atlas = byTool.get("atlas");
  if (atlas) {
    const migrationDirs = [...atlas.files].filter((path) => basename(path) === "atlas.sum").map(dirname);
    for (const path of sorted) {
      if (isSql(path) && migrationDirs.includes(dirname(path))) note("atlas", path, { sql: true });
    }
  }

  // A sqlc config counts only when it names query or schema files that exist.
  // Schema files hold the CREATE TABLE statements (sqlFiles); query files are markers only.
  const sqlc = byTool.get("sqlc");
  if (sqlc) {
    const existing = (paths: readonly string[]): string[] =>
      sorted.filter((path) => isSql(path) && paths.some((base) => path === base || path.startsWith(`${base}/`)));
    for (const config of [...sqlc.files]) {
      const content = read(config);
      const queries = content === undefined ? [] : existing(sqlcPaths(config, content, "queries"));
      const schemas = content === undefined ? [] : existing(sqlcPaths(config, content, "schema"));
      if (queries.length === 0 && schemas.length === 0) {
        sqlc.files.delete(config);
        continue;
      }
      for (const query of queries) {
        note("sqlc", query, {});
        sqlcQueries.add(query);
      }
      for (const schema of schemas) note("sqlc", schema, { sql: true });
    }
    if (sqlc.files.size === 0) byTool.delete("sqlc");
  }

  return [...byTool.entries()]
    .map(([tool, entry]): MigrationToolFinding => {
      const finding = { tool, files: [...entry.files].sort(), sqlFiles: [...entry.sql].sort() };
      return tool === "sqlc" ? { ...finding, queryFiles: [...sqlcQueries].sort() } : finding;
    })
    .sort((a, b) => a.tool.localeCompare(b.tool));
}
