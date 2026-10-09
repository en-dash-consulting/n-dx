/**
 * Table names from SQL embedded in Java and Go sources, run through the real
 * Java and Go packs (skipped when the grammars are not built), and from sqlc
 * query files found the way the migration detector finds them.
 */

import { afterAll, describe, expect, it } from "vitest";

import { grammarWasmPath } from "../../scripts/build-grammars.mjs";
import { extractGoEmbeddedSql } from "../../src/language/go-sql.js";
import { goPack } from "../../src/language/go-pack.js";
import { extractJavaEmbeddedSql } from "../../src/language/java-sql.js";
import { javaPack } from "../../src/language/java-pack.js";
import { createTreeSitterRunner, type ParsedFile } from "../../src/language/runner.js";
import { detectMigrationTools } from "../../src/language/sql-migrations.js";
import { extractSqlcTables, type EmbeddedSqlTable } from "../../src/language/sql-references.js";
import { skipUnlessGrammar } from "../helpers/grammar.js";

const JAVA_WASM = grammarWasmPath("tree-sitter-java");
const GO_WASM = grammarWasmPath("tree-sitter-go");
const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

async function parseAll(
  ctx: Parameters<typeof skipUnlessGrammar>[0],
  kind: "java" | "go",
  sources: Record<string, string>,
): Promise<ParsedFile[]> {
  const wasm = kind === "java" ? JAVA_WASM : GO_WASM;
  skipUnlessGrammar(ctx, wasm);
  const target = { pack: kind === "java" ? javaPack : goPack, grammarPath: wasm };
  const files: ParsedFile[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const result = await runner.parseSource(target, path, source);
    if (result.status !== "parsed") throw new Error("expected a parsed file");
    expect(result.hasErrorNodes || result.hasMissingNodes, path).toBe(false);
    files.push(result);
  }
  return files;
}

const summary = (tables: readonly EmbeddedSqlTable[]): string[] =>
  tables.map((t) => `${t.schema ? `${t.schema}.` : ""}${t.name} ${t.via} ${t.path}:${t.line}`);

const OWNER = `package org.example.model;

import jakarta.persistence.Entity;
import jakarta.persistence.Table;

@Entity
@Table(name = "owners", schema = "clinic")
public class Owner {
  static class Inner {}
}
`;

const PET = `package org.example.model;

@jakarta.persistence.Entity(name = "Pet")
public class Pet {}
`;

const REPOSITORY = `package org.example.repo;

public interface OwnerRepository extends Repository<Owner, Integer> {
  @Query("SELECT o FROM Owner o LEFT JOIN FETCH o.pets p WHERE p.name = 'a'")
  Owner findWithPets();

  @Query(value = "SELECT * FROM vets v JOIN vet_specialties vs ON vs.vet_id = v.id", nativeQuery = true)
  List<Vet> natives();

  @Query("select p from Pet p, Ghost g")
  List<Pet> pets();

  @Query(value = "select 1 from nope", nativeQuery = false)
  int notNative();
}
`;

const JDBC = `package org.example.dao;

public class Dao {
  void run() {
    jdbcTemplate.query("SELECT * FROM visits WHERE pet_id = ?", mapper, 1);
    this.jdbc.update("""
        UPDATE pets
        SET name = ?
        """, "x");
    namedParameterJdbcTemplate.queryForObject("select count(*) from types", Map.of(), Long.class);
    jdbcTemplate.execute(log("select * from from_a_helper"));
    other.query("SELECT * FROM not_jdbc");
    jdbcTemplate.query("not sql from nowhere", mapper);
    new Foo("select * from constructor_arg");
  }
}
`;

describe("Java embedded SQL", () => {
  it("reads @Table, native and JPQL @Query (mapped through @Entity and @Table)", async (ctx) => {
    const files = await parseAll(ctx, "java", {
      "Owner.java": OWNER,
      "Pet.java": PET,
      "OwnerRepository.java": REPOSITORY,
    });
    const { tables, unresolved } = extractJavaEmbeddedSql(files);
    expect(summary(tables)).toEqual([
      "clinic.owners @Table Owner.java:7",
      "clinic.owners @Query (JPQL) OwnerRepository.java:4",
      "vets @Query (native) OwnerRepository.java:7",
      "vet_specialties @Query (native) OwnerRepository.java:7",
      "Pet @Query (JPQL) OwnerRepository.java:10",
    ]);
    expect(tables[1]).toMatchObject({ entity: "Owner", origin: "annotation" });
    // `nativeQuery = false` is JPQL, so `nope` is an unknown entity, not a table.
    expect(unresolved).toEqual([
      { name: "Ghost", path: "OwnerRepository.java", line: 10 },
      { name: "nope", path: "OwnerRepository.java", line: 13 },
    ]);
  });

  it("reads JdbcTemplate calls, text blocks included, and only direct SQL arguments", async (ctx) => {
    const files = await parseAll(ctx, "java", { "Dao.java": JDBC });
    expect(summary(extractJavaEmbeddedSql(files).tables)).toEqual([
      "visits JdbcTemplate.query Dao.java:5",
      "pets JdbcTemplate.update Dao.java:7",
      "types JdbcTemplate.queryForObject Dao.java:10",
    ]);
  });
});

const GO_SOURCE = `package store

func run(db *sql.DB, x *sqlx.DB, ctx context.Context) {
	db.Query("SELECT id FROM owners WHERE id = ?", 1)
	db.QueryRowContext(ctx, \`SELECT name
FROM pets p JOIN types t ON t.id = p.type_id\`)
	db.Exec("INSERT INTO visits (pet_id) VALUES (?)", 1)
	x.Get(&owner, "select * from clinic.owners where id = $1", 1)
	x.Select(&pets, "SELECT * FROM pets")
	x.NamedExec("UPDATE vets SET name = :name", v)
	http.Get("https://example.com/select/from/x")
	log.Println(db.Query("SELECT 1 FROM wrapped"))
	other.Frobnicate("SELECT * FROM not_a_sql_method")
	db.Query(fmt.Sprintf("SELECT * FROM %s", name))
}
`;

describe("Go embedded SQL", () => {
  it("reads database/sql and sqlx calls and nothing else", async (ctx) => {
    const files = await parseAll(ctx, "go", { "store/store.go": GO_SOURCE });
    expect(summary(extractGoEmbeddedSql(files))).toEqual([
      "owners Query store/store.go:4",
      "pets QueryRowContext store/store.go:6",
      "types QueryRowContext store/store.go:6",
      "visits Exec store/store.go:7",
      "clinic.owners Get store/store.go:8",
      "pets Select store/store.go:9",
      "vets NamedExec store/store.go:10",
      "wrapped Query store/store.go:12",
    ]);
  });
});

describe("sqlc query files", () => {
  it("reads the query files the sqlc config names", () => {
    const project: Record<string, string> = {
      "sqlc.yaml": "version: '2'\nsql:\n  - queries: db/query\n    schema: db/schema.sql\n    engine: postgresql\n",
      "db/query/authors.sql": "-- name: GetAuthor :one\nSELECT * FROM authors WHERE id = $1;\n",
      "db/query/books.sql": "-- name: ListBooks :many\nSELECT * FROM books b JOIN authors a ON a.id = b.author_id;\n",
      "db/schema.sql": "CREATE TABLE authors (id int);",
    };
    const sqlc = detectMigrationTools(Object.keys(project), (path) => project[path]).find((f) => f.tool === "sqlc");
    expect(sqlc?.sqlFiles).toEqual(["db/query/authors.sql", "db/query/books.sql"]);
    const tables = sqlc!.sqlFiles.flatMap((path) => extractSqlcTables(path, project[path]!));
    expect(summary(tables)).toEqual([
      "authors sqlc GetAuthor db/query/authors.sql:2",
      "books sqlc ListBooks db/query/books.sql:2",
      "authors sqlc ListBooks db/query/books.sql:2",
    ]);
  });
});
