/**
 * Database-engine detection. The repository fixtures mirror the files the
 * corpus repositories carry (PetClinic and ThingsBoard from java-corpus.json,
 * gitea and microservices-demo from go-corpus.json) in shape, not in full;
 * scripts/database-corpus-report.mjs measures the real checkouts.
 */

import { describe, expect, it } from "vitest";

import { type BuildDependency, type ModuleBuildModel, type ResourceFact, parseGoMod } from "@n-dx/lang-kit";
import {
  DRIVER_TABLE,
  IMAGE_TABLE,
  TERRAFORM_ENGINE_TABLE,
  TERRAFORM_RESOURCE_TABLE,
  detectDatabaseEngines,
  parseImageRef,
  terraformEngineOf,
  versionFromTag,
  type DatabaseCandidate,
} from "../../../src/language/database-engines.js";

type Files = Record<string, string>;

const dep = (coordinate: string, scope = "compile", type?: string): BuildDependency => {
  const [group, artifact] = coordinate.split(":");
  return { group, artifact, version: { resolved: true, value: "1" }, scope, ...(type && { type }) };
};

const mavenModel = (dir: string, deps: BuildDependency[]): ModuleBuildModel => ({
  module: dir || "root",
  dir,
  buildSystem: "maven",
  dependencies: deps,
  notices: [],
});

function detect(files: Files, buildModels: ModuleBuildModel[] = []) {
  return detectDatabaseEngines({ buildModels, files: Object.keys(files), read: (path) => files[path] });
}

const byEngine = (candidates: readonly DatabaseCandidate[]) => new Map(candidates.map((c) => [c.engine, c]));

describe("PetClinic shape", () => {
  const models = [
    mavenModel("", [
      dep("com.h2database:h2", "runtime"),
      dep("com.mysql:mysql-connector-j", "runtime"),
      dep("org.postgresql:postgresql", "runtime"),
      dep("org.springframework.boot:spring-boot-starter-data-jpa"),
      dep("org.testcontainers:mysql", "test"),
    ]),
  ];
  const files: Files = {
    "docker-compose.yml": "services:\n  mysql:\n    image: mysql:9.2\n  postgres:\n    image: postgres:17.5\n",
    "src/main/resources/application-mysql.properties":
      "database=mysql\nspring.datasource.url=${MYSQL_URL:jdbc:mysql://localhost/petclinic}\nspring.datasource.username=${MYSQL_USER:petclinic}\nspring.datasource.password=${MYSQL_PASS:petclinic}\n",
    "src/main/resources/application-postgres.properties":
      "spring.datasource.url=${POSTGRES_URL:jdbc:postgresql://localhost/petclinic}\n",
  };
  const { candidates } = detect(files, models);
  const engines = byEngine(candidates);

  it("finds each engine with evidence per signal", () => {
    expect([...engines.keys()]).toEqual(["h2", "mysql", "postgresql"]);
    expect(engines.get("mysql")!.signals).toEqual(["dependency", "image", "config"]);
    expect(engines.get("postgresql")!.signals).toEqual(["dependency", "image", "config"]);
    expect(engines.get("mysql")!.grade).toBe("high");
    expect(engines.get("h2")!.grade).toBe("medium");
  });

  it("reads engine versions from image tags", () => {
    expect(engines.get("mysql")!.versions).toEqual(["9.2"]);
    expect(engines.get("postgresql")!.versions).toEqual(["17.5"]);
  });

  it("records the config key and the scheme only", () => {
    const config = engines.get("postgresql")!.evidence.find((e) => e.signal === "config")!;
    expect(config).toMatchObject({ key: "spring.datasource.url", text: "jdbc:postgresql", ruleId: "config-url-scheme", line: 1 });
  });

  it("grades a Testcontainers module as weak", () => {
    const tc = engines.get("mysql")!.evidence.find((e) => e.ruleId === "maven:org.testcontainers:mysql")!;
    expect(tc.grade).toBe("weak");
  });
});

describe("ThingsBoard shape", () => {
  const models = [
    mavenModel("dao", [
      dep("org.postgresql:postgresql"),
      dep("com.datastax.oss:java-driver-core"),
      dep("redis.clients:jedis"),
      dep("org.springframework.data:spring-data-redis"),
      dep("org.testcontainers:postgresql", "test"),
    ]),
  ];
  const files: Files = {
    "docker/docker-compose.postgres.yml": 'services:\n  postgres:\n    image: "postgres:16"\n',
    "docker/docker-compose.cassandra.yml": 'services:\n  cassandra:\n    image: "cassandra:4.1"\n',
    "docker/docker-compose.redis.yml": 'services:\n  redis:\n    image: "bitnami/redis:7.2"\n',
    "docker/docker-compose.timescale.yml": 'services:\n  postgres:\n    image: "timescale/timescaledb:latest-pg16"\n',
    "msa/black-box-tests/src/test/resources/docker-compose.valkey-ssl.yml": "services:\n  valkey:\n    image: bitnamilegacy/valkey:8.0\n",
    "msa/black-box-tests/src/test/resources/advanced/docker-compose.citus.yml": 'services:\n  citus-master:\n    image: "citusdata/citus:12.1"\n',
    "docker/docker-compose.yml": 'services:\n  tb-core1:\n    image: "${DOCKER_REPO}/${TB_NODE_DOCKER_NAME}:${TB_VERSION}"\n',
    "application/src/main/resources/thingsboard.yml": [
      "spring:",
      "  datasource:",
      '    driverClassName: "${SPRING_DRIVER_CLASS_NAME:org.postgresql.Driver}"',
      '    url: "${SPRING_DATASOURCE_URL:jdbc:postgresql://localhost:5432/thingsboard}"',
      '    username: "${SPRING_DATASOURCE_USERNAME:postgres}"',
      '    password: "${SPRING_DATASOURCE_PASSWORD:postgres}"',
      "",
    ].join("\n"),
  };
  const engines = byEngine(detect(files, models).candidates);

  it("finds PostgreSQL, Cassandra, Redis, TimescaleDB and Valkey", () => {
    expect([...engines.keys()]).toEqual(["cassandra", "postgresql", "redis", "timescaledb", "valkey"]);
    expect(engines.get("valkey")!.evidence[0]).toMatchObject({ grade: "weak", text: "bitnamilegacy/valkey:8.0", version: "8.0" });
    expect(engines.get("postgresql")!.versions).toEqual(["12.1", "16"]);
    expect(engines.get("cassandra")!.versions).toEqual(["4.1"]);
    expect(engines.get("redis")!.versions).toEqual(["7.2"]);
    expect(engines.get("timescaledb")!.versions).toEqual([]);
  });

  it("follows YAML nesting to the full key and reads the driver class", () => {
    const config = engines.get("postgresql")!.evidence.filter((e) => e.signal === "config");
    expect(config.map((e) => [e.ruleId, e.key, e.line])).toEqual([
      ["config-driver-class", "spring.datasource.driverClassName", 3],
      ["config-url-scheme", "spring.datasource.url", 4],
    ]);
  });

  it("names the build file of the module that declares the dependency", () => {
    expect(engines.get("cassandra")!.evidence[0]).toMatchObject({ signal: "dependency", file: "dao/pom.xml", grade: "strong" });
  });
});

describe("gitea shape", () => {
  const goMod = [
    "module code.gitea.io/gitea",
    "go 1.24",
    "require (",
    "\tgithub.com/go-sql-driver/mysql v1.9.2",
    "\tgithub.com/lib/pq v1.10.9",
    "\tgithub.com/mattn/go-sqlite3 v1.14.28",
    "\tgithub.com/microsoft/go-mssqldb v1.8.0",
    "\tgithub.com/redis/go-redis/v9 v9.7.3",
    "\tgithub.com/jackc/pgx/v5 v5.7.1 // indirect",
    ")",
  ].join("\n");
  const files: Files = {
    ".github/workflows/pull-db-tests.yml":
      "jobs:\n  test-pgsql:\n    services:\n      pgsql:\n        image: postgres:14\n      mssql:\n        image: mcr.microsoft.com/mssql/server:2019-latest\n",
    "custom/conf/app.example.ini": "[database]\n;DB_TYPE = mysql\n",
    "docker/root/etc/templates/app.ini": "[database]\nDB_TYPE  = sqlite3\n",
  };
  const { candidates } = detect(files, [parseGoMod("", "go.mod", goMod)]);
  const engines = byEngine(candidates);

  it("finds each Go driver through the go.mod build model", () => {
    expect([...engines.keys()]).toEqual(["mssql", "mysql", "postgresql", "redis", "sqlite"]);
    const pq = engines.get("postgresql")!.evidence.find((e) => e.ruleId === "go:github.com/lib/pq")!;
    expect(pq).toMatchObject({ grade: "strong", file: "go.mod" });
    expect(engines.get("redis")!.evidence[0].ruleId).toBe("go:github.com/redis/go-redis");
  });

  it("grades indirect modules and CI images as weak", () => {
    const pgx = engines.get("postgresql")!.evidence.find((e) => e.ruleId === "go:github.com/jackc/pgx")!;
    expect(pgx.grade).toBe("weak");
    const ci = engines.get("mssql")!.evidence.find((e) => e.signal === "image")!;
    expect(ci).toMatchObject({ grade: "weak", text: "mssql/server:2019-latest", version: "2019" });
  });

  it("reads an INI engine key and skips commented lines", () => {
    expect(engines.get("sqlite")!.evidence.find((e) => e.signal === "config")).toMatchObject({
      ruleId: "config-engine-key",
      key: "database.DB_TYPE",
      text: "sqlite3",
    });
    expect(engines.get("mysql")!.evidence.some((e) => e.signal === "config")).toBe(false);
  });
});

describe("microservices-demo shape", () => {
  const goMod = "module github.com/GoogleCloudPlatform/microservices-demo/src/productcatalogservice\ngo 1.23\nrequire github.com/jackc/pgx/v5 v5.7.2\n";
  const files: Files = {
    "kubernetes-manifests/redis.yaml":
      "apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n      - name: redis\n        image: redis:alpine\n",
    "helm-chart/templates/cartservice.yaml": "        image: {{ .Values.cartDatabase.image }}\n",
  };
  const engines = byEngine(detect(files, [parseGoMod("src/productcatalogservice", "src/productcatalogservice/go.mod", goMod)]).candidates);

  it("finds Redis from a Kubernetes manifest and PostgreSQL from pgx", () => {
    expect([...engines.keys()]).toEqual(["postgresql", "redis"]);
    expect(engines.get("redis")!.evidence[0]).toMatchObject({ signal: "image", file: "kubernetes-manifests/redis.yaml", line: 8, text: "redis:alpine" });
    expect(engines.get("redis")!.versions).toEqual([]);
    expect(engines.get("postgresql")!.evidence[0].file).toBe("src/productcatalogservice/go.mod");
  });
});

describe("connection strings", () => {
  const SECRETS = ["admin", "s3cr3t", "db.internal.example", "5432", "clusteruser", "clusterpw", "cluster0.abcde.mongodb.net", "sql.corp", "Hunter2", "redispw", "cache.local", "dbhost", "rootpw"];
  const files: Files = {
    ".env": "DATABASE_URL=postgres://admin:s3cr3t@db.internal.example:5432/app\nexport CACHE_URL='redis://:redispw@cache.local:6379/0'\n",
    "config/mongo.toml": 'uri = "mongodb+srv://clusteruser:clusterpw@cluster0.abcde.mongodb.net/db"\n',
    "src/main/resources/application.properties": "spring.datasource.url=jdbc:sqlserver://sql.corp:1433;user=sa;password=Hunter2\n",
    "src/main/resources/application.yml": "spring:\n  datasource:\n    url: jdbc:mysql://dbhost/petclinic?user=root&password=rootpw\n",
  };
  const report = detect(files);

  it("keeps the scheme and engine", () => {
    const schemes = report.candidates.flatMap((c) => c.evidence.map((e) => [c.engine, e.text]));
    expect(schemes).toEqual([
      ["mongodb", "mongodb+srv"],
      ["mssql", "jdbc:sqlserver"],
      ["mysql", "jdbc:mysql"],
      ["postgresql", "postgres"],
      ["redis", "redis"],
    ]);
  });

  it("never keeps a host, user, password or port", () => {
    const serialised = JSON.stringify(report);
    for (const secret of SECRETS) expect(serialised).not.toContain(secret);
  });
});

describe("config rules", () => {
  it("does not read an image reference as a URL scheme", () => {
    const { candidates } = detect({ "deploy/values.yaml": "db:\n  image: postgres:15\n" });
    expect(candidates[0].evidence.map((e) => e.signal)).toEqual(["image"]);
  });

  it("reads a Prisma datasource provider", () => {
    const { candidates } = detect({ "prisma/schema.prisma": 'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n' });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidence[0]).toMatchObject({ ruleId: "config-prisma-provider", line: 6, text: "postgresql" });
  });

  it("records a Spring Data key family once per file, as weak", () => {
    const { candidates } = detect({ "application.properties": "spring.data.mongodb.host=localhost\nspring.data.mongodb.port=27017\n" });
    expect(candidates).toEqual([
      expect.objectContaining({ engine: "mongodb", grade: "low", evidence: [expect.objectContaining({ ruleId: "config-spring-family", key: "spring.data.mongodb.host" })] }),
    ]);
  });

  it("treats jdbc:tc: URLs as test evidence", () => {
    const { candidates } = detect({ "src/main/resources/application-it.properties": "spring.datasource.url=jdbc:tc:postgresql:16:///db\n" });
    expect(candidates[0].evidence[0]).toMatchObject({ text: "jdbc:tc:postgresql", grade: "weak" });
  });
});

describe("dependencies", () => {
  it("reads package.json, grading devDependencies as weak", () => {
    const { candidates } = detect({
      "package.json": JSON.stringify({ dependencies: { pg: "^8", mongoose: "^8" }, devDependencies: { "better-sqlite3": "^11" } }),
      "node_modules/mysql2/package.json": JSON.stringify({ dependencies: { mysql2: "x" } }),
    });
    expect(candidates.map((c) => [c.engine, c.grade])).toEqual([
      ["mongodb", "medium"],
      ["postgresql", "medium"],
      ["sqlite", "low"],
    ]);
  });

  it("reports a malformed package.json as a notice", () => {
    expect(detect({ "web/package.json": "{" }).notices).toEqual([expect.stringMatching(/^web\/package\.json is not valid JSON/)]);
  });

  it("matches reactive starters and versioned ojdbc artifacts by prefix, and skips BOM imports", () => {
    const models = [
      mavenModel("", [
        dep("org.springframework.boot:spring-boot-starter-data-redis-reactive"),
        dep("com.oracle.database.jdbc:ojdbc11"),
        dep("org.mongodb:mongodb-driver-bom", "import", "pom"),
      ]),
    ];
    expect(detect({}, models).candidates.map((c) => c.engine)).toEqual(["oracle", "redis"]);
  });

  it("grades Gradle test configurations as weak", () => {
    const model: ModuleBuildModel = { ...mavenModel("app", [dep("com.h2database:h2", "testRuntimeOnly")]), buildSystem: "gradle" };
    const { candidates } = detect({}, [model]);
    expect(candidates[0]).toMatchObject({ engine: "h2", grade: "low" });
    expect(candidates[0].evidence[0].file).toBe("app/build.gradle");
  });

  it("names a Kotlin DSL build script when the module has one", () => {
    const model: ModuleBuildModel = { ...mavenModel("app", [dep("org.postgresql:postgresql", "implementation")]), buildSystem: "gradle" };
    const { candidates } = detect({ "app/build.gradle.kts": "" }, [model]);
    expect(candidates[0].evidence[0].file).toBe("app/build.gradle.kts");
  });
});

describe("tables", () => {
  it("gives every driver entry a registry page", () => {
    for (const entry of DRIVER_TABLE) {
      expect(entry.provenance.kind).toBe("registry");
      expect(entry.provenance.url).toMatch(/^https:\/\/(?:central\.sonatype\.com\/artifact\/[^/]+\/[^/]+|pkg\.go\.dev\/\S+|www\.npmjs\.com\/package\/\S+)$/);
    }
    const coordinates = DRIVER_TABLE.map((e) => `${e.ecosystem}:${e.coordinate}`);
    expect(new Set(coordinates).size).toBe(coordinates.length);
  });

  it("gives every image entry a registry page", () => {
    for (const entry of IMAGE_TABLE) expect(entry.provenance.url).toMatch(/^https:\/\//);
  });
});

describe("image references", () => {
  it.each([
    ["postgres:15-alpine", { name: "postgres", tag: "15-alpine" }],
    ["docker.io/library/postgres:16", { name: "postgres", tag: "16" }],
    ["mcr.microsoft.com/mssql/server:2022-latest", { name: "mssql/server", tag: "2022-latest" }],
    ["localhost:5000/redis", { name: "redis" }],
    ["mongo:7.0@sha256:abc123", { name: "mongo", tag: "7.0" }],
    ["${REGISTRY}/postgres:15", undefined],
  ])("parses %s", (ref, expected) => {
    expect(parseImageRef(ref)).toEqual(expected);
  });

  it.each([
    ["15-alpine", "15"],
    ["8.0.36", "8.0.36"],
    ["2.14.2-pg16", "2.14.2"],
    ["latest", undefined],
    ["alpine", undefined],
    ["${PG_VERSION}", undefined],
    [undefined, undefined],
  ])("reads the version of tag %s", (tag, version) => {
    expect(versionFromTag(tag)).toBe(version);
  });
});

describe("Terraform resources", () => {
  const resource = (type: string, name: string, line: number, attributes?: ResourceFact["attributes"]): ResourceFact => ({
    type,
    name,
    position: { line, column: 0 },
    ...(attributes && { attributes }),
  });
  const tf = (path: string, ...resources: ResourceFact[]) => ({ path, resources });
  const detectTf = (...facts: ReturnType<typeof tf>[]) =>
    detectDatabaseEngines({ buildModels: [], files: [], read: () => undefined, terraformFacts: facts });
  const only = (facts: ReturnType<typeof tf>[]) => {
    const [candidate, ...rest] = detectTf(...facts).candidates;
    expect(rest).toEqual([]);
    return candidate;
  };

  it("reads an RDS instance's engine and version as written", () => {
    const c = only([tf("db/main.tf", resource("aws_db_instance", "main", 4, { engine: "postgres", engineVersion: "15.4" }))]);
    expect(c).toMatchObject({ engine: "postgresql", grade: "medium", signals: ["terraform"], versions: ["15.4"] });
    expect(c.evidence).toEqual([
      {
        signal: "terraform",
        grade: "strong",
        file: "db/main.tf",
        line: 4,
        ruleId: "terraform:aws_db_instance",
        text: "aws_db_instance.main engine=postgres",
        version: "15.4",
      },
    ]);
  });

  it.each([
    ["aurora-postgresql", "postgresql"],
    ["aurora-mysql", "mysql"],
    ["aurora", "mysql"],
    ["sqlserver-ex", "mssql"],
    ["oracle-ee", "oracle"],
    ["mariadb", "mariadb"],
  ])("maps the Aurora and RDS engine %s to %s", (written, engine) => {
    const c = only([tf("rds.tf", resource("aws_rds_cluster", "db", 1, { engine: written }))]);
    expect(c.engine).toBe(engine);
    expect(c.evidence[0].grade).toBe("strong");
  });

  it("reads the engine from a Cloud SQL database_version", () => {
    const c = only([tf("sql.tf", resource("google_sql_database_instance", "main", 7, { engineVersion: "POSTGRES_15" }))]);
    expect(c).toMatchObject({ engine: "postgresql", grade: "medium", versions: ["POSTGRES_15"] });
    expect(c.evidence[0]).toMatchObject({ grade: "strong", line: 7, text: "google_sql_database_instance.main engine=POSTGRES_15" });
  });

  it("reads an Azure server's engine from its type, and a mapped attribute over it", () => {
    const typed = only([tf("az.tf", resource("azurerm_mysql_flexible_server", "db", 2))]);
    expect(typed).toMatchObject({ engine: "mysql", grade: "low", signals: ["terraform"] });
    expect(typed.evidence[0]).toMatchObject({ grade: "weak", text: "azurerm_mysql_flexible_server.db" });
    expect(typed.evidence[0]).not.toHaveProperty("version");
    expect(only([tf("az.tf", resource("azurerm_postgresql_server", "db", 2, { engine: "postgres" }))]).grade).toBe("medium");
  });

  it("keeps the type's engine, as low grade, when an Azure server's engine expression is unmapped", () => {
    const c = only([tf("az.tf", resource("azurerm_mssql_server", "db", 3, { engine: "var.engine", engineVersion: "var.v" }))]);
    expect(c).toMatchObject({ engine: "mssql", grade: "low", versions: ["var.v"] });
  });

  it("yields nothing for a type that names no engine and a declaration that writes none", () => {
    const bare = resource("aws_db_instance", "main", 1);
    const expression = resource("aws_db_instance", "x", 5, { engine: "var.engine" });
    const report = detectTf(tf("rds.tf", bare, expression));
    expect(report.candidates).toEqual([]);
    expect(report.notices).toEqual([
      "rds.tf:1 aws_db_instance.main has no engine attribute; no candidate",
      "rds.tf:5 aws_db_instance.x has engine var.engine; no candidate",
    ]);
    expect(detectTf(tf("c.tf", resource("aws_elasticache_cluster", "c", 1, { engine: "memcached" }))).candidates).toEqual([]);
  });

  it("ignores resources that are not databases and input without Terraform facts", () => {
    expect(detectTf(tf("a.tf", resource("aws_s3_bucket", "b", 1, { engine: "postgres" }))).candidates).toEqual([]);
    expect(detect({}).candidates).toEqual([]);
  });

  it("gives a candidate per engine a module's instances resolve, naming where each value is written", () => {
    const instance = (engine: string, confidence: "literal" | "conditional", file: string): ResourceFact => ({
      ...resource("aws_db_instance", "this", 30, { engine }),
      instance: {
        module: "module.db.module.db_instance",
        call: { file, line: 1 },
        resolved: { engine: { written: "local.is_replica ? null : var.engine", confidence, from: { file, line: 12 } } },
      },
    });
    const report = detectTf(
      tf(
        "modules/db_instance/main.tf",
        instance("postgres", "literal", "examples/pg/main.tf"),
        instance("mysql", "conditional", "examples/mysql/main.tf"),
        resource("aws_db_instance", "this", 30, { engine: "local.is_replica ? null : var.engine" }),
      ),
    );
    expect(report.candidates.map((c) => [c.engine, c.grade])).toEqual([
      ["mysql", "low"],
      ["postgresql", "medium"],
    ]);
    expect(report.candidates[0].evidence[0]).toMatchObject({
      grade: "weak",
      file: "modules/db_instance/main.tf",
      line: 30,
      text: "aws_db_instance.this engine=mysql (conditional, from examples/mysql/main.tf:12)",
    });
    expect(report.candidates[1].evidence[0]).toMatchObject({
      grade: "strong",
      text: "aws_db_instance.this engine=postgres (literal, from examples/pg/main.tf:12)",
    });
    // The instances that resolve nothing keep today's notice.
    expect(report.notices).toEqual(["modules/db_instance/main.tf:30 aws_db_instance.this has engine local.is_replica ? null : var.engine; no candidate"]);
  });

  it("grades Terraform under a test path as weak", () => {
    const c = only([tf("tests/rds.tf", resource("aws_db_instance", "t", 1, { engine: "mysql", engineVersion: "8.0" }))]);
    expect(c).toMatchObject({ engine: "mysql", grade: "low" });
  });

  it("combines with another signal into a high-grade candidate and sorts text versions by name", () => {
    const files: Files = { "docker-compose.yml": "services:\n  db:\n    image: postgres:16\n" };
    const report = detectDatabaseEngines({
      buildModels: [],
      files: Object.keys(files),
      read: (path) => files[path],
      terraformFacts: [
        tf("a.tf", resource("aws_db_instance", "a", 1, { engine: "postgres", engineVersion: "15.4" })),
        tf("b.tf", resource("google_sql_database_instance", "b", 1, { engineVersion: "POSTGRES_14" })),
      ],
    });
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({ engine: "postgresql", grade: "high", signals: ["image", "terraform"] });
    expect(report.candidates[0].versions).toEqual(["15.4", "16", "POSTGRES_14"]);
  });
});

describe("Terraform tables", () => {
  it("gives every resource type and engine string a provider page", () => {
    for (const entry of TERRAFORM_RESOURCE_TABLE) expect(entry.provenance.url).toMatch(/^https:\/\/registry\.terraform\.io\//);
    for (const entry of TERRAFORM_ENGINE_TABLE) {
      expect(entry.provenance.length).toBeGreaterThan(0);
      for (const page of entry.provenance) expect(page.url).toMatch(/^https:\/\/registry\.terraform\.io\//);
    }
  });

  it("matches an engine by name, then by name and a separator, never by a bare prefix", () => {
    expect(terraformEngineOf("POSTGRES_15")?.engine).toBe("postgresql");
    expect(terraformEngineOf("aurora-postgresql")?.engine).toBe("postgresql");
    expect(terraformEngineOf("postgresx")).toBeUndefined();
    expect(terraformEngineOf("var.engine")).toBeUndefined();
  });
});
