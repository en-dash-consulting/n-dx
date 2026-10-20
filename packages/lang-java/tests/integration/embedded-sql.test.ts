/**
 * Table names from SQL embedded in Java sources, run through the real Java
 * pack (skipped when the grammar is not built).
 */

import { afterAll, describe, expect, it } from "vitest";

import type { EmbeddedSqlTable } from "@n-dx/lang-kit";
import { createTreeSitterRunner, skipUnlessGrammar, type ParsedFile } from "@n-dx/lang-runtime";
import { javaGrammarPath, javaPack } from "../../src/java-pack.js";
import { extractJavaEmbeddedSql } from "../../src/java-sql.js";

const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

async function parseAll(ctx: Parameters<typeof skipUnlessGrammar>[0], sources: Record<string, string>): Promise<ParsedFile[]> {
  const wasm = javaGrammarPath();
  skipUnlessGrammar(ctx, wasm);
  const target = { pack: javaPack, grammarPath: wasm };
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
    const files = await parseAll(ctx, {
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

  it("reads Spring Data JDBC @Query as native and relational @Table by its value", async (ctx) => {
    const files = await parseAll(ctx, {
      "OwnerRepository.java": `package org.example.repo;

import org.springframework.data.jdbc.repository.query.Query;

public interface OwnerRepository {
  @Query("SELECT * FROM owners")
  List<Owner> all();
}
`,
      "Owner.java": `package org.example.model;

import org.springframework.data.relational.core.mapping.Table;

@Table("owners")
public class Owner {}
`,
      "Vet.java": `package org.example.model;

import org.springframework.data.relational.core.mapping.Table;

@Table(value = "vets", schema = "clinic")
public class Vet {}
`,
    });
    const { tables, unresolved } = extractJavaEmbeddedSql(files);
    expect(summary(tables)).toEqual([
      "owners @Query (native) OwnerRepository.java:6",
      "owners @Table Owner.java:5",
      "clinic.vets @Table Vet.java:5",
    ]);
    expect(unresolved).toEqual([]);
  });

  it("reads JdbcTemplate calls, text blocks included, and only direct SQL arguments", async (ctx) => {
    const files = await parseAll(ctx, { "Dao.java": JDBC });
    expect(summary(extractJavaEmbeddedSql(files).tables)).toEqual([
      "visits JdbcTemplate.query Dao.java:5",
      "pets JdbcTemplate.update Dao.java:7",
      "types JdbcTemplate.queryForObject Dao.java:10",
    ]);
  });
});
