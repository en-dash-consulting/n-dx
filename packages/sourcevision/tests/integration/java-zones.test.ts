/**
 * Java through the analyze pipeline: inventory → imports (pack runner and
 * resolver) → zones, over a Spring Boot-style fixture written for this test.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grammarWasmPath } from "../../scripts/build-grammars.mjs";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { analyzeZones } from "../../src/analyzers/zones.js";
import { goConfig } from "../../src/language/go.js";
import { javaConfig } from "../../src/language/java.js";
import type { Imports, Inventory } from "../../src/schema/v1.js";
import { validate, ZonesSchema } from "../../src/schema/validate.js";
import { skipUnlessGrammar } from "../helpers/grammar.js";

const FIXTURE = join(import.meta.dirname, "../fixtures/java-spring-project");
const GO_FIXTURE = join(import.meta.dirname, "../fixtures/go-project");
const JAVA_WASM = grammarWasmPath("tree-sitter-java");
const MAIN = "src/main/java/com/example/clinic";

const edgeKeys = (imports: Imports): string[] => imports.edges.map((e) => `${e.from} -> ${e.to}`);

describe("Java analyze pipeline — Spring Boot-style fixture", () => {
  let inventory: Inventory;

  beforeAll(async () => {
    inventory = await analyzeInventory(FIXTURE, { languageConfig: javaConfig });
  });

  it("writes file-to-file edges across the controller, service, repository and entity layers", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);
    const imports = await analyzeImports(FIXTURE, inventory, { language: "java" });
    const edges = edgeKeys(imports);

    expect(edges).toEqual(
      expect.arrayContaining([
        `${MAIN}/controller/OwnerController.java -> ${MAIN}/service/OwnerService.java`,
        `${MAIN}/controller/VisitController.java -> ${MAIN}/service/VisitService.java`,
        `${MAIN}/service/OwnerService.java -> ${MAIN}/repository/OwnerRepository.java`,
        `${MAIN}/service/VisitService.java -> ${MAIN}/repository/VisitRepository.java`,
        `${MAIN}/repository/PetRepository.java -> ${MAIN}/entity/PetType.java`,
        // Same package, no import.
        `${MAIN}/entity/Owner.java -> ${MAIN}/entity/Pet.java`,
        `${MAIN}/entity/Pet.java -> ${MAIN}/entity/PetType.java`,
        // Test source root resolves into the main source root.
        `src/test/java/com/example/clinic/service/VisitServiceTest.java -> ${MAIN}/entity/Visit.java`,
      ]),
    );
    expect(imports.edges.every((e) => e.type === "static" && e.symbols.length > 0)).toBe(true);
    expect(imports.edges.some((e) => e.from === e.to)).toBe(false);
    expect(imports.summary.totalEdges).toBe(imports.edges.length);
  });

  it("writes external imports attributed by package", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);
    const imports = await analyzeImports(FIXTURE, inventory, { language: "java" });
    const byPackage = new Map(imports.external.map((e) => [e.package, e]));

    expect(byPackage.get("org.springframework.stereotype")?.importedBy.sort()).toEqual([
      `${MAIN}/service/OwnerService.java`,
      `${MAIN}/service/VisitService.java`,
    ]);
    expect(byPackage.get("org.springframework.stereotype")?.symbols).toEqual(["Service"]);
    expect(byPackage.get("org.springframework.web.bind.annotation")?.symbols).toContain("*");
    expect(byPackage.get("jakarta.persistence")?.symbols).toEqual(expect.arrayContaining(["Entity", "Id"]));
    expect(byPackage.get("java.util")?.importedBy).toContain(`${MAIN}/repository/OwnerRepository.java`);
    // No project package is reported as external.
    expect([...byPackage.keys()].some((p) => p.startsWith("com.example"))).toBe(false);
  });

  it("produces schema-valid zones that cover every layer", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);
    const imports = await analyzeImports(FIXTURE, inventory, { language: "java" });
    const { zones } = await analyzeZones(inventory, imports, { enrich: false });

    expect(validate(ZonesSchema, zones).ok).toBe(true);
    expect(zones.zones.length).toBeGreaterThanOrEqual(2);
    const zoned = zones.zones.flatMap((z) => z.files);
    for (const layer of ["controller", "service", "repository", "entity"]) {
      expect(zoned.some((f) => f.startsWith(`${MAIN}/${layer}/`)), `${layer} files are zoned`).toBe(true);
    }
  });

  it("re-resolves Java files on an incremental run, matching a full run", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);
    const full = await analyzeImports(FIXTURE, inventory, { language: "java" });
    const incremental = await analyzeImports(FIXTURE, inventory, {
      language: "java",
      previousImports: { ...full, edges: [], external: [] },
      changedFiles: new Set(),
      fileSetChanged: false,
    });
    expect(incremental).toEqual(full);
  });

  describe("without the built grammar", () => {
    let emptyGrammarDir: string;

    beforeAll(() => {
      emptyGrammarDir = mkdtempSync(join(tmpdir(), "sv-no-grammar-"));
    });
    afterAll(() => rmSync(emptyGrammarDir, { recursive: true, force: true }));

    it("leaves Java inventory-only with a single message and still succeeds", async () => {
      const messages: string[] = [];
      const imports = await analyzeImports(FIXTURE, inventory, {
        language: "java",
        packs: { grammarDir: emptyGrammarDir, warn: (m) => messages.push(m) },
      });

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(/^Java: grammar tree-sitter-java@.* inventory only/);
      expect(imports.edges).toEqual([]);
      expect(imports.external).toEqual([]);

      const { zones } = await analyzeZones(inventory, imports, { enrich: false });
      expect(validate(ZonesSchema, zones).ok).toBe(true);
    });
  });
});

describe("non-Java repositories", () => {
  it("never load a language pack or report a missing grammar", async () => {
    const goInventory = await analyzeInventory(GO_FIXTURE, { languageConfig: goConfig });
    const messages: string[] = [];
    const imports = await analyzeImports(GO_FIXTURE, goInventory, {
      language: "go",
      packs: { grammarDir: join(tmpdir(), "sv-no-such-grammar-dir"), warn: (m) => messages.push(m) },
    });
    expect(messages).toEqual([]);
    expect(imports.edges.length).toBeGreaterThan(0);
  });
});
