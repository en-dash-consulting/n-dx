/**
 * Database-engine candidates from four signals: dependency coordinates (the
 * in-memory build models plus `package.json`), container images (compose,
 * Kubernetes and other YAML, and Dockerfile `FROM` lines), config (URL
 * schemes, JDBC driver classes, engine-naming keys, Spring Data key families
 * and Prisma datasources) and Terraform database resources (the caller passes
 * the Terraform pack's resource facts in; this module never imports a pack).
 * Results stay in memory: nothing here is written to an analysis artifact.
 *
 * A connection string is read for its scheme only. The host, user, password,
 * port and database name are never matched into a result, so they cannot be
 * stored or logged from here.
 *
 * Every dependency and image table entry records provenance: the registry page
 * that publishes the coordinate or image. The Terraform tables record the
 * provider documentation pages for each resource type and engine string.
 *
 * @module sourcevision/language/database-engines
 */

import type { BuildDependency, FileFacts, ModuleBuildModel } from "@n-dx/lang-kit";
import type { ReadProjectFile } from "./sql-migrations.js";

export type DatabaseEngine =
  | "postgresql"
  | "timescaledb"
  | "mysql"
  | "mariadb"
  | "mssql"
  | "oracle"
  | "sqlite"
  | "h2"
  | "hsqldb"
  | "mongodb"
  | "redis"
  | "valkey"
  | "cassandra";

export type DatabaseSignal = "dependency" | "image" | "config" | "terraform";

/**
 * `strong`: the engine is used at runtime (a direct driver, a deployed image, a
 * connection URL). `weak`: it is used only around the code (a test-scope or
 * indirect dependency, an image or URL in CI or test files), or the evidence
 * names a client family rather than a connection.
 */
export type EvidenceGrade = "strong" | "weak";

/** `high`: strong evidence from two or more signals; `medium`: strong evidence from one; `low`: weak only. */
export type CandidateGrade = "high" | "medium" | "low";

export interface RegistryProvenance {
  readonly kind: "registry";
  /** The registry page that publishes the coordinate or image. */
  readonly url: string;
}

export type DriverRole = "driver" | "client" | "orm-dialect" | "spring-data" | "testcontainers";

export interface DriverEntry {
  readonly ecosystem: "maven" | "go" | "npm";
  /** Maven `group:artifact`, Go module path, npm package name. */
  readonly coordinate: string;
  /** Also match coordinates that start with `coordinate` (`ojdbc8`/`ojdbc11`, `-reactive` starters). Go entries also match their `/vN` major-version paths. */
  readonly prefix?: true;
  readonly engine: DatabaseEngine;
  readonly role: DriverRole;
  readonly provenance: RegistryProvenance;
}

export interface ImageEntry {
  /** Image repository with the registry host and Docker Hub's `library/` removed. */
  readonly name: string;
  readonly engine: DatabaseEngine;
  readonly provenance: RegistryProvenance;
}

export interface EngineEvidence {
  readonly signal: DatabaseSignal;
  readonly grade: EvidenceGrade;
  /** The declaring module's build file (dependency) or the file the hit is in; relative and POSIX. */
  readonly file: string;
  /** One-based line; absent for dependencies, which come from a build model. */
  readonly line?: number;
  /** The table entry or rule that matched. */
  readonly ruleId: string;
  /** The coordinate, image reference without its registry host, URL scheme or config value; never a host or credential. */
  readonly text: string;
  /** Dotted config key path, when the hit is on a keyed line. */
  readonly key?: string;
  /** Engine version: an image tag's leading version, or a Terraform resource's version attribute as written. */
  readonly version?: string;
}

export interface DatabaseCandidate {
  readonly engine: DatabaseEngine;
  readonly grade: CandidateGrade;
  readonly signals: readonly DatabaseSignal[];
  /** Distinct versions read from image tags and Terraform attributes (as written), sorted. */
  readonly versions: readonly string[];
  readonly evidence: readonly EngineEvidence[];
}

export interface DatabaseEngineInput {
  /** Models from readMavenBuildModels, readGradleBuildModels and readGoBuildModels. */
  readonly buildModels: readonly ModuleBuildModel[];
  /** Project files, relative and POSIX. */
  readonly files: readonly string[];
  readonly read: ReadProjectFile;
  /**
   * Resource facts from the Terraform pack (`kinds: ["resources"]`), one entry
   * per file. Absent when the pack is not installed: the Terraform signal then
   * yields nothing.
   */
  readonly terraformFacts?: readonly Pick<FileFacts, "path" | "resources">[];
}

// ── tables ──────────────────────────────────────────────────────────────

const central = (coordinate: string): RegistryProvenance => ({
  kind: "registry",
  url: `https://central.sonatype.com/artifact/${coordinate.replace(":", "/")}`,
});
const pkgGo = (path: string): RegistryProvenance => ({ kind: "registry", url: `https://pkg.go.dev/${path}` });
const npm = (name: string): RegistryProvenance => ({ kind: "registry", url: `https://www.npmjs.com/package/${name}` });

const maven = (coordinate: string, engine: DatabaseEngine, role: DriverRole, prefix?: true): DriverEntry => ({
  ecosystem: "maven",
  coordinate,
  ...(prefix && { prefix }),
  engine,
  role,
  provenance: central(coordinate),
});
const go = (path: string, engine: DatabaseEngine, role: DriverRole): DriverEntry => ({
  ecosystem: "go",
  coordinate: path,
  engine,
  role,
  provenance: pkgGo(path),
});
const node = (name: string, engine: DatabaseEngine, role: DriverRole): DriverEntry => ({
  ecosystem: "npm",
  coordinate: name,
  engine,
  role,
  provenance: npm(name),
});

const SPRING_BOOT = "org.springframework.boot";

/** The driver table: one entry per coordinate, each with the registry page that publishes it. */
export const DRIVER_TABLE: readonly DriverEntry[] = [
  maven("org.postgresql:postgresql", "postgresql", "driver"),
  maven("com.mysql:mysql-connector-j", "mysql", "driver"),
  maven("mysql:mysql-connector-java", "mysql", "driver"),
  maven("org.mariadb.jdbc:mariadb-java-client", "mariadb", "driver"),
  maven("com.microsoft.sqlserver:mssql-jdbc", "mssql", "driver"),
  maven("com.oracle.database.jdbc:ojdbc", "oracle", "driver", true),
  maven("org.xerial:sqlite-jdbc", "sqlite", "driver"),
  maven("com.h2database:h2", "h2", "driver"),
  maven("org.hsqldb:hsqldb", "hsqldb", "driver"),
  maven("org.mongodb:mongodb-driver", "mongodb", "driver", true),
  maven("org.mongodb:mongo-java-driver", "mongodb", "driver"),
  maven("redis.clients:jedis", "redis", "client"),
  maven("io.lettuce:lettuce-core", "redis", "client"),
  maven("com.datastax.oss:java-driver-core", "cassandra", "driver"),
  maven("com.datastax.cassandra:cassandra-driver-core", "cassandra", "driver"),
  maven(`${SPRING_BOOT}:spring-boot-starter-data-mongodb`, "mongodb", "spring-data", true),
  maven(`${SPRING_BOOT}:spring-boot-starter-data-redis`, "redis", "spring-data", true),
  maven(`${SPRING_BOOT}:spring-boot-starter-data-cassandra`, "cassandra", "spring-data", true),
  maven("org.springframework.data:spring-data-mongodb", "mongodb", "spring-data"),
  maven("org.springframework.data:spring-data-redis", "redis", "spring-data"),
  maven("org.springframework.data:spring-data-cassandra", "cassandra", "spring-data"),
  maven("org.testcontainers:postgresql", "postgresql", "testcontainers"),
  maven("org.testcontainers:timescaledb", "timescaledb", "testcontainers"),
  maven("org.testcontainers:mysql", "mysql", "testcontainers"),
  maven("org.testcontainers:mariadb", "mariadb", "testcontainers"),
  maven("org.testcontainers:mssqlserver", "mssql", "testcontainers"),
  maven("org.testcontainers:oracle-xe", "oracle", "testcontainers"),
  maven("org.testcontainers:mongodb", "mongodb", "testcontainers"),
  maven("org.testcontainers:cassandra", "cassandra", "testcontainers"),
  go("github.com/jackc/pgx", "postgresql", "driver"),
  go("github.com/lib/pq", "postgresql", "driver"),
  go("github.com/go-sql-driver/mysql", "mysql", "driver"),
  go("github.com/microsoft/go-mssqldb", "mssql", "driver"),
  go("github.com/denisenkom/go-mssqldb", "mssql", "driver"),
  go("github.com/sijms/go-ora", "oracle", "driver"),
  go("github.com/mattn/go-sqlite3", "sqlite", "driver"),
  go("modernc.org/sqlite", "sqlite", "driver"),
  go("github.com/glebarez/go-sqlite", "sqlite", "driver"),
  go("gorm.io/driver/postgres", "postgresql", "orm-dialect"),
  go("gorm.io/driver/mysql", "mysql", "orm-dialect"),
  go("gorm.io/driver/sqlserver", "mssql", "orm-dialect"),
  go("gorm.io/driver/sqlite", "sqlite", "orm-dialect"),
  go("go.mongodb.org/mongo-driver", "mongodb", "driver"),
  go("github.com/redis/go-redis", "redis", "client"),
  go("github.com/go-redis/redis", "redis", "client"),
  go("github.com/gomodule/redigo", "redis", "client"),
  go("github.com/valkey-io/valkey-go", "valkey", "client"),
  go("github.com/gocql/gocql", "cassandra", "driver"),
  node("pg", "postgresql", "driver"),
  node("postgres", "postgresql", "driver"),
  node("pg-promise", "postgresql", "driver"),
  node("mysql", "mysql", "driver"),
  node("mysql2", "mysql", "driver"),
  node("mariadb", "mariadb", "driver"),
  node("mssql", "mssql", "driver"),
  node("tedious", "mssql", "driver"),
  node("oracledb", "oracle", "driver"),
  node("sqlite3", "sqlite", "driver"),
  node("better-sqlite3", "sqlite", "driver"),
  node("mongodb", "mongodb", "driver"),
  node("mongoose", "mongodb", "client"),
  node("redis", "redis", "client"),
  node("ioredis", "redis", "client"),
  node("cassandra-driver", "cassandra", "driver"),
];

const hub = (name: string): RegistryProvenance => ({
  kind: "registry",
  url: name.includes("/") ? `https://hub.docker.com/r/${name}` : `https://hub.docker.com/_/${name}`,
});
const image = (name: string, engine: DatabaseEngine, provenance: RegistryProvenance = hub(name)): ImageEntry => ({ name, engine, provenance });

/** Container images that run a database engine. */
export const IMAGE_TABLE: readonly ImageEntry[] = [
  image("postgres", "postgresql"),
  image("bitnami/postgresql", "postgresql"),
  image("postgis/postgis", "postgresql"),
  image("citusdata/citus", "postgresql"),
  image("timescale/timescaledb", "timescaledb"),
  image("timescale/timescaledb-ha", "timescaledb"),
  image("mysql", "mysql"),
  image("mysql/mysql-server", "mysql"),
  image("bitnami/mysql", "mysql"),
  image("mariadb", "mariadb"),
  image("bitnami/mariadb", "mariadb"),
  image("mssql/server", "mssql", { kind: "registry", url: "https://mcr.microsoft.com/en-us/artifact/mar/mssql/server" }),
  image("gvenzl/oracle-xe", "oracle"),
  image("gvenzl/oracle-free", "oracle"),
  image("mongo", "mongodb"),
  image("mongodb/mongodb-community-server", "mongodb"),
  image("bitnami/mongodb", "mongodb"),
  image("redis", "redis"),
  image("redis/redis-stack", "redis"),
  image("redis/redis-stack-server", "redis"),
  image("bitnami/redis", "redis"),
  image("valkey/valkey", "valkey"),
  image("bitnami/valkey", "valkey"),
  image("cassandra", "cassandra"),
  image("bitnami/cassandra", "cassandra"),
];

/** Engine names as config values and URL schemes write them. */
const ENGINE_ALIASES: ReadonlyMap<string, DatabaseEngine> = new Map([
  ["postgres", "postgresql"],
  ["postgresql", "postgresql"],
  ["pgsql", "postgresql"],
  ["timescaledb", "timescaledb"],
  ["mysql", "mysql"],
  ["mariadb", "mariadb"],
  ["mssql", "mssql"],
  ["sqlserver", "mssql"],
  ["oracle", "oracle"],
  ["sqlite", "sqlite"],
  ["sqlite3", "sqlite"],
  ["h2", "h2"],
  ["hsqldb", "hsqldb"],
  ["mongodb", "mongodb"],
  ["mongo", "mongodb"],
  ["mongodb+srv", "mongodb"],
  ["redis", "redis"],
  ["rediss", "redis"],
  ["valkey", "valkey"],
  ["cassandra", "cassandra"],
]);

/**
 * URL schemes. The pattern stops at the scheme: `//`, `@` and everything after
 * them are never part of a match. A bare scheme needs `://` after it, so an
 * image reference such as `postgres:15` is not read as one. JDBC's `tc:`
 * (Testcontainers) prefix is skipped to reach the engine's subprotocol.
 */
const URL_SCHEME = /\b(?:(jdbc:(?:tc:)?([a-z][a-z0-9]*))(?=:)|(postgres(?:ql)?|mysql|mariadb|sqlserver|mongodb(?:\+srv)?|rediss?|sqlite3?)(?=:\/\/))/gi;

/** JDBC driver class names. */
const DRIVER_CLASSES: ReadonlyArray<readonly [RegExp, DatabaseEngine]> = [
  [/\borg\.postgresql\.Driver\b/, "postgresql"],
  [/\bcom\.mysql\.(?:cj\.)?jdbc\.Driver\b/, "mysql"],
  [/\borg\.mariadb\.jdbc\.Driver\b/, "mariadb"],
  [/\bcom\.microsoft\.sqlserver\.jdbc\.SQLServerDriver\b/, "mssql"],
  [/\boracle\.jdbc\.(?:driver\.)?OracleDriver\b/, "oracle"],
  [/\borg\.sqlite\.JDBC\b/, "sqlite"],
  [/\borg\.h2\.Driver\b/, "h2"],
  [/\borg\.hsqldb\.jdbc(?:\.JDBC)?Driver\b/, "hsqldb"],
];

/** The last key segment of a key that names the engine (`DB_TYPE`, `database.engine`, `datasource.platform`). */
const ENGINE_KEY = /(?:^|[._-])(?:db|database|datasource)[._-]?(?:type|engine|vendor|dialect|platform|kind)$/i;

/** Spring key families that only one engine uses. */
const SPRING_FAMILIES: ReadonlyArray<readonly [string, DatabaseEngine]> = [
  ["spring.data.mongodb.", "mongodb"],
  ["spring.mongodb.", "mongodb"],
  ["spring.data.redis.", "redis"],
  ["spring.redis.", "redis"],
  ["spring.data.cassandra.", "cassandra"],
  ["spring.cassandra.", "cassandra"],
];

const tfDocs = (provider: string, resource: string): RegistryProvenance => ({
  kind: "registry",
  url: `https://registry.terraform.io/providers/hashicorp/${provider}/latest/docs/resources/${resource}`,
});

/**
 * A Terraform database resource type. `engine` is what the type alone implies;
 * a type with none (RDS, Aurora, Cloud SQL, ElastiCache) names its engine in
 * an attribute, and a declaration that does not write one yields no candidate.
 */
export interface TerraformResourceEntry {
  readonly type: string;
  readonly engine?: DatabaseEngine;
  readonly provenance: RegistryProvenance;
}

const tfType = (provider: string, type: string, engine?: DatabaseEngine): TerraformResourceEntry => ({
  type,
  ...(engine && { engine }),
  provenance: tfDocs(provider, type.slice(provider.length + 1)),
});

export const TERRAFORM_RESOURCE_TABLE: readonly TerraformResourceEntry[] = [
  tfType("aws", "aws_db_instance"),
  tfType("aws", "aws_rds_cluster"),
  tfType("aws", "aws_rds_cluster_instance"),
  tfType("aws", "aws_rds_global_cluster"),
  tfType("aws", "aws_elasticache_cluster"),
  tfType("aws", "aws_elasticache_replication_group"),
  tfType("google", "google_sql_database_instance"),
  tfType("azurerm", "azurerm_postgresql_server", "postgresql"),
  tfType("azurerm", "azurerm_postgresql_flexible_server", "postgresql"),
  tfType("azurerm", "azurerm_mysql_server", "mysql"),
  tfType("azurerm", "azurerm_mysql_flexible_server", "mysql"),
  tfType("azurerm", "azurerm_mariadb_server", "mariadb"),
  tfType("azurerm", "azurerm_mssql_server", "mssql"),
  tfType("azurerm", "azurerm_mssql_managed_instance", "mssql"),
  tfType("azurerm", "azurerm_redis_cache", "redis"),
];

export interface TerraformEngineEntry {
  /** Lower-case engine name; matches a value equal to it or starting with it and `-` or `_`. */
  readonly name: string;
  readonly engine: DatabaseEngine;
  /** The provider pages that publish the string. */
  readonly provenance: readonly RegistryProvenance[];
}

const RDS = tfDocs("aws", "db_instance");
const AURORA = tfDocs("aws", "rds_cluster");
const CACHE = tfDocs("aws", "elasticache_cluster");
const CLOUD_SQL = tfDocs("google", "sql_database_instance");

/**
 * Engine strings as Terraform writes them: RDS and Aurora `engine`
 * (`postgres`, `aurora-postgresql`, `sqlserver-ex`, `oracle-ee`), ElastiCache
 * `engine`, and the prefix of Cloud SQL's `database_version` (`POSTGRES_15`,
 * `MYSQL_8_0`, `SQLSERVER_2019_STANDARD`). First match wins, so
 * `aurora-postgresql` precedes `aurora`. A value that names no entry
 * (`memcached`, an expression such as `var.engine`) is unmapped.
 */
export const TERRAFORM_ENGINE_TABLE: readonly TerraformEngineEntry[] = [
  { name: "postgres", engine: "postgresql", provenance: [RDS, CLOUD_SQL] },
  { name: "postgresql", engine: "postgresql", provenance: [RDS] },
  { name: "aurora-postgresql", engine: "postgresql", provenance: [AURORA] },
  { name: "aurora-mysql", engine: "mysql", provenance: [AURORA] },
  { name: "aurora", engine: "mysql", provenance: [AURORA] },
  { name: "mysql", engine: "mysql", provenance: [RDS, CLOUD_SQL] },
  { name: "mariadb", engine: "mariadb", provenance: [RDS] },
  { name: "oracle", engine: "oracle", provenance: [RDS] },
  { name: "custom-oracle", engine: "oracle", provenance: [RDS] },
  { name: "sqlserver", engine: "mssql", provenance: [RDS, CLOUD_SQL] },
  { name: "custom-sqlserver", engine: "mssql", provenance: [RDS] },
  { name: "redis", engine: "redis", provenance: [CACHE] },
  { name: "valkey", engine: "valkey", provenance: [CACHE] },
];

const CONFIG_FILE = /\.(?:properties|ya?ml|ini|toml|conf|cfg|env|prisma)$|(?:^|\/)\.env(?:\.[\w.-]+)?$/i;
const YAML_FILE = /\.ya?ml$/i;
const DOCKERFILE = /(?:^|\/)(?:[\w.-]+\.)?Dockerfile(?:\.[\w.-]+)?$|(?:^|\/)Containerfile$/;
const PACKAGE_JSON = /(?:^|\/)package\.json$/;
/** CI and test locations: evidence there shows the engine is used around the code, not by it. */
const AROUND_CODE = /(?:^|\/)(?:\.github|\.gitlab|\.circleci|\.woodpecker|\.buildkite|test|tests|testdata|it|e2e)\/|(?:^|\/)(?:\.gitlab-ci|\.drone|\.travis)\.ya?ml$/i;

// ── dependencies ────────────────────────────────────────────────────────

function coordinateOf(model: ModuleBuildModel, dep: BuildDependency): string {
  if (model.buildSystem === "go") return dep.group === "" ? dep.artifact : `${dep.group}/${dep.artifact}`;
  return `${dep.group}:${dep.artifact}`;
}

function matchDriver(ecosystem: DriverEntry["ecosystem"], coordinate: string): DriverEntry | undefined {
  return DRIVER_TABLE.find(
    (entry) =>
      entry.ecosystem === ecosystem &&
      (entry.coordinate === coordinate ||
        (entry.prefix === true && coordinate.startsWith(entry.coordinate)) ||
        // A Go module's major-version suffix: github.com/lib/pq/v2.
        (ecosystem === "go" && new RegExp(`^${escapeRegExp(entry.coordinate)}/v\\d+$`).test(coordinate))),
  );
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Test configurations (Maven `test`, Gradle `testImplementation`, `integrationTestRuntimeOnly`) and Go `indirect`. */
function isAroundCodeScope(scope: string): boolean {
  return scope === "indirect" || /^test|Test[A-Z]|test$/.test(scope);
}

/** The module's build file. A Gradle module's script is `build.gradle.kts` when the project has one, else `build.gradle`. */
function buildFileOf(model: ModuleBuildModel, files: ReadonlySet<string>): string {
  const at = (name: string): string => (model.dir === "" ? name : `${model.dir}/${name}`);
  if (model.buildSystem === "go") return at("go.mod");
  if (model.buildSystem === "maven") return at("pom.xml");
  return files.has(at("build.gradle.kts")) ? at("build.gradle.kts") : at("build.gradle");
}

function dependencyEvidence(models: readonly ModuleBuildModel[], files: ReadonlySet<string>): Array<[DatabaseEngine, EngineEvidence]> {
  const out: Array<[DatabaseEngine, EngineEvidence]> = [];
  for (const model of models) {
    const ecosystem = model.buildSystem === "go" ? "go" : "maven";
    const buildFile = buildFileOf(model, files);
    for (const dep of model.dependencies) {
      if (dep.type === "pom") continue; // A BOM import manages versions; it is not a dependency on the driver.
      const coordinate = coordinateOf(model, dep);
      const entry = matchDriver(ecosystem, coordinate);
      if (!entry) continue;
      const weak = entry.role === "testcontainers" || isAroundCodeScope(dep.scope);
      out.push([
        entry.engine,
        {
          signal: "dependency",
          grade: weak ? "weak" : "strong",
          file: buildFile,
          ruleId: `${entry.ecosystem}:${entry.coordinate}`,
          text: `${coordinate} (${dep.scope})`,
        },
      ]);
    }
  }
  return out;
}

/** Evidence from one `package.json`, or the reason it could not be read. */
function packageJsonEvidence(file: string, content: string): Array<[DatabaseEngine, EngineEvidence]> | string {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch (error) {
    return `${file} is not valid JSON: ${(error as Error).message}`;
  }
  if (typeof manifest !== "object" || manifest === null) return `${file} is not a JSON object`;
  const out: Array<[DatabaseEngine, EngineEvidence]> = [];
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const deps = (manifest as Record<string, unknown>)[field];
    if (typeof deps !== "object" || deps === null) continue;
    for (const name of Object.keys(deps).sort()) {
      const entry = matchDriver("npm", name);
      if (!entry) continue;
      const weak = field === "devDependencies" || AROUND_CODE.test(file);
      out.push([entry.engine, { signal: "dependency", grade: weak ? "weak" : "strong", file, ruleId: `npm:${entry.coordinate}`, text: `${name} (${field})` }]);
    }
  }
  return out;
}

// ── images ──────────────────────────────────────────────────────────────

interface ImageRef {
  /** Repository without registry host or `library/`. */
  readonly name: string;
  readonly tag?: string;
}

/** Parse `[registry/]repo[:tag][@digest]`. References with template or variable syntax in the name are skipped. */
export function parseImageRef(ref: string): ImageRef | undefined {
  const bare = ref.replace(/@sha256:[0-9a-f]+$/i, "");
  const slash = bare.lastIndexOf("/");
  const colon = bare.lastIndexOf(":");
  const tag = colon > slash ? bare.slice(colon + 1) : undefined;
  let name = colon > slash ? bare.slice(0, colon) : bare;
  if (/[{}$\s]/.test(name) || name === "") return undefined;
  const parts = name.split("/");
  // A first component with a dot, a port or `localhost` is a registry host.
  if (parts.length > 1 && /[.:]|^localhost$/.test(parts[0])) parts.shift();
  if (parts[0] === "library") parts.shift();
  name = parts.join("/").toLowerCase();
  return { name, ...(tag !== undefined && tag !== "" && { tag }) };
}

/** The leading version of a tag: `15-alpine` → `15`, `8.0.36` → `8.0.36`, `2.14.2-pg16` → `2.14.2`. */
export function versionFromTag(tag: string | undefined): string | undefined {
  if (tag === undefined || tag.includes("$")) return undefined;
  return /^v?(\d+(?:\.\d+){0,3})(?![\d])/.exec(tag)?.[1];
}

function matchImage(name: string): ImageEntry | undefined {
  // Oracle's own registry (container-registry.oracle.com/database/express) leaves `database/<edition>`.
  if (/^database\/(?:express|enterprise|free)$/.test(name)) {
    return { name, engine: "oracle", provenance: { kind: "registry", url: "https://container-registry.oracle.com" } };
  }
  // Bitnami moved its superseded images to `bitnamilegacy/`; they run the same engine.
  const canonical = name.replace(/^bitnamilegacy\//, "bitnami/");
  return IMAGE_TABLE.find((entry) => entry.name === canonical);
}

const IMAGE_LINE = /^\s*(?:-\s+)?["']?image["']?\s*:\s*["']?([^\s"'#]+)/;
const FROM_LINE = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i;

function imageEvidence(file: string, content: string): Array<[DatabaseEngine, EngineEvidence]> {
  const pattern = YAML_FILE.test(file) ? IMAGE_LINE : DOCKERFILE.test(file) ? FROM_LINE : undefined;
  if (!pattern) return [];
  const out: Array<[DatabaseEngine, EngineEvidence]> = [];
  content.split(/\r?\n/).forEach((text, index) => {
    const hit = pattern.exec(text);
    if (!hit) return;
    const ref = parseImageRef(hit[1]);
    const entry = ref && matchImage(ref.name);
    if (!ref || !entry) return;
    const version = versionFromTag(ref.tag);
    out.push([
      entry.engine,
      {
        signal: "image",
        grade: AROUND_CODE.test(file) ? "weak" : "strong",
        file,
        line: index + 1,
        ruleId: `image:${entry.name}`,
        text: ref.tag === undefined ? ref.name : `${ref.name}:${ref.tag}`,
        ...(version !== undefined && { version }),
      },
    ]);
  });
  return out;
}

// ── config ──────────────────────────────────────────────────────────────

/**
 * Dotted key paths for each line of a config file: `key=value`/`key: value`
 * lines, YAML nesting by indentation, `[section]` headers. Best effort: it
 * reads layout, it does not parse YAML or TOML.
 */
function keyedLines(file: string, content: string): Array<{ line: number; key?: string; value: string }> {
  const yaml = YAML_FILE.test(file);
  const stack: Array<{ indent: number; key: string }> = [];
  let section: string | undefined;
  const out: Array<{ line: number; key?: string; value: string }> = [];
  content.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (/^\s*(?:#|;|\/\/)/.test(raw) || raw.trim() === "") return;
    if (yaml) {
      const hit = /^(\s*)(-\s+)?["']?([\w.-]+)["']?\s*:(?:\s+(.*)|$)/.exec(raw);
      if (!hit) {
        out.push({ line, value: raw });
        return;
      }
      const indent = hit[1].length + (hit[2]?.length ?? 0);
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
      stack.push({ indent, key: hit[3] });
      out.push({ line, key: stack.map((s) => s.key).join("."), value: hit[4] ?? "" });
      return;
    }
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(raw);
    if (header) {
      section = header[1].trim();
      return;
    }
    const kv = /^\s*(?:export\s+)?([\w.-]+)\s*[=:]\s*(.*)$/.exec(raw);
    if (!kv) {
      out.push({ line, value: raw });
      return;
    }
    out.push({ line, key: section ? `${section}.${kv[1]}` : kv[1], value: kv[2] });
  });
  return out;
}

function configEvidence(file: string, content: string): Array<[DatabaseEngine, EngineEvidence]> {
  const grade: EvidenceGrade = AROUND_CODE.test(file) ? "weak" : "strong";
  const out: Array<[DatabaseEngine, EngineEvidence]> = [];
  const push = (engine: DatabaseEngine, line: number, ruleId: string, text: string, key: string | undefined, g = grade): void => {
    out.push([engine, { signal: "config", grade: g, file, line, ruleId, text, ...(key !== undefined && { key }) }]);
  };

  if (/\.prisma$/i.test(file)) {
    const block = /\bdatasource\s+\w+\s*\{[^}]*?\bprovider\s*=\s*"(\w+)"/.exec(content);
    const engine = block && ENGINE_ALIASES.get(block[1].toLowerCase());
    if (block && engine) {
      const line = content.slice(0, block.index + block[0].length).split("\n").length;
      push(engine, line, "config-prisma-provider", block[1], "datasource.provider");
    }
    return out;
  }

  const families = new Set<string>();
  for (const { line, key, value } of keyedLines(file, content)) {
    for (const hit of value.matchAll(URL_SCHEME)) {
      const scheme = (hit[1] ?? hit[3]).toLowerCase();
      const engine = ENGINE_ALIASES.get((hit[2] ?? hit[3]).toLowerCase());
      if (engine) push(engine, line, "config-url-scheme", scheme, key, scheme.startsWith("jdbc:tc:") ? "weak" : grade);
    }
    for (const [pattern, engine] of DRIVER_CLASSES) {
      const hit = pattern.exec(value);
      if (hit) push(engine, line, "config-driver-class", hit[0], key);
    }
    if (key === undefined) continue;
    const last = key.split(".").pop() ?? key;
    if (ENGINE_KEY.test(last)) {
      const word = /^["']?([\w+]+)["']?\s*$/.exec(value.replace(/\s+[#;].*$/, ""))?.[1].toLowerCase();
      const engine = word === undefined ? undefined : ENGINE_ALIASES.get(word);
      if (engine) push(engine, line, "config-engine-key", word!, key);
    }
    // One hit per family per file: the family is the evidence, not each of its keys.
    const family = SPRING_FAMILIES.find(([prefix]) => `${key}.`.startsWith(prefix));
    if (family && !families.has(family[0])) {
      families.add(family[0]);
      push(family[1], line, "config-spring-family", family[0].slice(0, -1), key, "weak");
    }
  }
  return out;
}

// ── terraform ───────────────────────────────────────────────────────────

/** The table entry for the engine a Terraform `engine` or `database_version` value names, if it names one. */
export function terraformEngineOf(value: string): TerraformEngineEntry | undefined {
  const lower = value.toLowerCase();
  return TERRAFORM_ENGINE_TABLE.find(({ name }) => lower === name || lower.startsWith(`${name}-`) || lower.startsWith(`${name}_`));
}

/**
 * One piece of evidence per database resource. A mapped `engine` attribute
 * (Cloud SQL: `database_version`) is strong, weak under a test or CI path; an
 * engine implied only by the resource type is weak, because nothing says the
 * declaration was configured for it. A database resource whose engine neither
 * its type nor a mapped attribute gives (a reusable module's `var.engine` that
 * no module call resolves) adds a notice and no evidence.
 *
 * The pack gives a resource one fact per distinct resolution over its module's
 * instances (`ResourceFact.instance`), so a reusable module yields a candidate
 * per engine its callers pass. The evidence then names the resource and, in
 * `text`, where the value is written; a `conditional` value (one branch of
 * `cond ? null : var.engine`) is weak.
 */
function terraformEvidence(facts: readonly Pick<FileFacts, "path" | "resources">[], notices: string[]): Array<[DatabaseEngine, EngineEvidence]> {
  const out: Array<[DatabaseEngine, EngineEvidence]> = [];
  for (const { path, resources } of facts) {
    for (const resource of resources ?? []) {
      const entry = TERRAFORM_RESOURCE_TABLE.find((e) => e.type === resource.type);
      if (!entry) continue;
      const { engine: written, engineVersion } = resource.attributes ?? {};
      const field = written !== undefined ? "engine" : resource.type === "google_sql_database_instance" ? "engineVersion" : undefined;
      const source = field === undefined ? undefined : resource.attributes?.[field];
      const resolved = field === undefined ? undefined : resource.instance?.resolved[field];
      const mapped = source === undefined ? undefined : terraformEngineOf(source);
      const engine = mapped?.engine ?? entry.engine;
      if (engine === undefined) {
        const named = source === undefined ? "no engine attribute" : `engine ${source}`;
        notices.push(`${path}:${resource.position.line} ${resource.type}.${resource.name} has ${named}; no candidate`);
        continue;
      }
      out.push([
        engine,
        {
          signal: "terraform",
          // A value written under a test or CI path (a fixture's module call) is weak, wherever the resource is.
          grade:
            mapped !== undefined &&
            resolved?.confidence !== "conditional" &&
            !AROUND_CODE.test(path) &&
            !(resolved !== undefined && AROUND_CODE.test(resolved.from.file))
              ? "strong"
              : "weak",
          file: path,
          line: resource.position.line,
          ruleId: `terraform:${resource.type}`,
          text: `${resource.type}.${resource.name}${mapped !== undefined ? ` engine=${source}` : ""}${
            mapped !== undefined && resolved !== undefined ? ` (${resolved.confidence}, from ${resolved.from.file}:${resolved.from.line})` : ""
          }`,
          ...(engineVersion !== undefined && { version: engineVersion }),
        },
      ]);
    }
  }
  return out;
}

// ── candidates ──────────────────────────────────────────────────────────

function gradeOf(evidence: readonly EngineEvidence[]): CandidateGrade {
  const strong = new Set(evidence.filter((e) => e.grade === "strong").map((e) => e.signal));
  if (strong.size >= 2) return "high";
  return strong.size === 1 ? "medium" : "low";
}

export interface DatabaseEngineReport {
  /** Sorted by engine name. */
  readonly candidates: readonly DatabaseCandidate[];
  /** Files that could not be read as what their name says (a malformed `package.json`), and Terraform database resources whose engine could not be determined. */
  readonly notices: readonly string[];
}

/** Database-engine candidates for a project. */
export function detectDatabaseEngines(input: DatabaseEngineInput): DatabaseEngineReport {
  const found: Array<[DatabaseEngine, EngineEvidence]> = dependencyEvidence(input.buildModels, new Set(input.files));
  const notices: string[] = [];
  found.push(...terraformEvidence(input.terraformFacts ?? [], notices));
  for (const file of [...input.files].sort()) {
    const wanted = PACKAGE_JSON.test(file) || DOCKERFILE.test(file) || CONFIG_FILE.test(file);
    if (!wanted || /(?:^|\/)node_modules\//.test(file)) continue;
    const content = input.read(file);
    if (content === undefined) continue;
    if (PACKAGE_JSON.test(file)) {
      const result = packageJsonEvidence(file, content);
      if (typeof result === "string") notices.push(result);
      else found.push(...result);
      continue;
    }
    found.push(...imageEvidence(file, content));
    if (CONFIG_FILE.test(file)) found.push(...configEvidence(file, content));
  }
  return { candidates: candidatesFrom(found), notices };
}

function candidatesFrom(found: ReadonlyArray<[DatabaseEngine, EngineEvidence]>): DatabaseCandidate[] {
  const byEngine = new Map<DatabaseEngine, EngineEvidence[]>();
  for (const [engine, evidence] of found) {
    const list = byEngine.get(engine) ?? [];
    list.push(evidence);
    byEngine.set(engine, list);
  }
  return [...byEngine.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([engine, evidence]) => ({
      engine,
      grade: gradeOf(evidence),
      signals: (["dependency", "image", "config", "terraform"] as const).filter((s) => evidence.some((e) => e.signal === s)),
      versions: [...new Set(evidence.flatMap((e) => (e.version === undefined ? [] : [e.version])))].sort(compareVersions),
      evidence,
    }));
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  // Terraform writes versions as text (`POSTGRES_15`, `var.version`): those sort by name.
  if ([...pa, ...pb].some(Number.isNaN)) return a.localeCompare(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}
