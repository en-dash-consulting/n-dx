/**
 * Java through the analyze pipeline: inventory → imports (pack runner and
 * resolver) → zones, over a Spring Boot-style fixture written for this test.
 */

import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { analyzeZones } from "../../src/analyzers/zones.js";
import { detectLanguage, detectLanguages, mergeLanguageConfigs } from "../../src/language/detect.js";
import { KNOWN_PACKS, type KnownPack } from "../../src/language/pack-loader.js";
import { javaConfig, javaSecondaryConfig, typescriptConfig } from "@n-dx/lang-kit";
import type { Imports, Inventory } from "../../src/schema/v1.js";
import { validate, ZonesSchema } from "../../src/schema/validate.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const FIXTURE = join(import.meta.dirname, "../fixtures/java-spring-project");
const TS_FIXTURE = join(import.meta.dirname, "../fixtures/small-ts-project");

/** The Java pack as if it were not installed. */
const NOT_INSTALLED_JAVA: KnownPack = {
  ...KNOWN_PACKS.find((p) => p.id === "java")!,
  importByResolution: () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-java' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" })),
};
const MAIN = "src/main/java/com/example/clinic";

const edgeKeys = (imports: Imports): string[] => imports.edges.map((e) => `${e.from} -> ${e.to}`);

describe("Java analyze pipeline — Spring Boot-style fixture", () => {
  let inventory: Inventory;

  beforeAll(async () => {
    inventory = await analyzeInventory(FIXTURE, { languageConfig: javaConfig });
  });

  it("writes file-to-file edges across the controller, service, repository and entity layers", async (ctx) => {
    await skipUnlessPackRuns(ctx, "java");
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
    await skipUnlessPackRuns(ctx, "java");
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
    await skipUnlessPackRuns(ctx, "java");
    const imports = await analyzeImports(FIXTURE, inventory, { language: "java" });
    const { zones } = await analyzeZones(inventory, imports, { enrich: false });

    expect(validate(ZonesSchema, zones).ok).toBe(true);
    expect(zones.zones.length).toBeGreaterThanOrEqual(2);
    const zoned = zones.zones.flatMap((z) => z.files);
    for (const layer of ["controller", "service", "repository", "entity"]) {
      expect(zoned.some((f) => f.startsWith(`${MAIN}/${layer}/`)), `${layer} files are zoned`).toBe(true);
    }
  });

  it("re-resolves unchanged Java files on an incremental run, dropping their stale edges", async (ctx) => {
    await skipUnlessPackRuns(ctx, "java");
    const full = await analyzeImports(FIXTURE, inventory, { language: "java" });
    // PetType references nothing: an edge or external from it can only be stale.
    const petType = `${MAIN}/entity/PetType.java`;
    const incremental = await analyzeImports(FIXTURE, inventory, {
      language: "java",
      previousImports: {
        ...full,
        edges: [...full.edges, { from: petType, to: `${MAIN}/entity/Owner.java`, type: "static", symbols: ["Owner"] }],
        external: [...full.external, { package: "org.stale", importedBy: [petType], symbols: ["Gone"] }],
      },
      // Nothing changed on disk; Java files are re-resolved regardless.
      changedFiles: new Set(),
      fileSetChanged: false,
    });
    expect(incremental).toEqual(full);
  });

  describe("without the Java pack", () => {
    let packDir: string;

    beforeAll(() => {
      packDir = mkdtempSync(join(tmpdir(), "sv-no-java-pack-"));
    });
    afterAll(() => rmSync(packDir, { recursive: true, force: true }));

    it("leaves Java inventory-only with a single message naming the install command, and still succeeds", async () => {
      const messages: string[] = [];
      const imports = await analyzeImports(FIXTURE, inventory, {
        language: "java",
        packs: { packs: [NOT_INSTALLED_JAVA], loader: { packDir }, warn: (m) => messages.push(m) },
      });

      expect(messages).toEqual([
        `Java: pack @n-dx/lang-java is not installed; Java files get inventory only. ` +
          "Install it with `ndx sv pack add java`.",
      ]);
      expect(imports.edges).toEqual([]);
      expect(imports.external).toEqual([]);

      const { zones } = await analyzeZones(inventory, imports, { enrich: false });
      expect(validate(ZonesSchema, zones).ok).toBe(true);
    });
  });
});

describe("Java beside a package.json (Spring Boot with a bundled frontend)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-java-frontend-"));
    cpSync(FIXTURE, dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "frontend" }));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps the primary language and adds Java to the detected set", async () => {
    expect(await detectLanguage(dir)).toBe(typescriptConfig);
    expect(await detectLanguages(dir)).toEqual([typescriptConfig, javaSecondaryConfig]);
  });

  it("analyzes the .java files with the detected language set", async (ctx) => {
    await skipUnlessPackRuns(ctx, "java");
    const merged = mergeLanguageConfigs(await detectLanguages(dir));
    const inventory = await analyzeInventory(dir, { languageConfig: merged });
    const imports = await analyzeImports(dir, inventory);

    expect(edgeKeys(imports)).toContain(
      `${MAIN}/controller/OwnerController.java -> ${MAIN}/service/OwnerService.java`,
    );
    expect(imports.external.map((e) => e.package)).toContain("org.springframework.stereotype");
  });
});

describe("repositories with no pack language", () => {
  it("never load a language pack or report a missing one", async () => {
    const tsInventory = await analyzeInventory(TS_FIXTURE, { languageConfig: typescriptConfig });
    const messages: string[] = [];
    const neverLoaded = KNOWN_PACKS.map((pack) => ({
      ...pack,
      importByResolution: () => Promise.reject(new Error(`${pack.packageName} must not be loaded`)),
    }));
    const imports = await analyzeImports(TS_FIXTURE, tsInventory, {
      language: "typescript",
      packs: { packs: neverLoaded, warn: (m) => messages.push(m) },
    });
    expect(messages).toEqual([]);
    expect(imports.edges.length).toBeGreaterThan(0);
  });
});
