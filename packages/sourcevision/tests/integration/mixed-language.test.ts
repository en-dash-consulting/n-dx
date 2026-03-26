/**
 * Integration tests for mixed Go + TypeScript project analysis.
 *
 * Uses the mixed-go-ts fixture (a Go CLI with a TypeScript web frontend) to
 * verify that the analysis pipeline handles both languages end-to-end:
 * - Import edges are produced for both Go and TypeScript source files
 * - Both go.mod and package.json are recorded as detected config files
 */

import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { detectLanguages, mergeLanguageConfigs } from "../../src/language/index.js";
import type { Inventory, Imports } from "../../src/schema/v1.js";
import type { LanguageConfig } from "../../src/language/registry.js";

const MIXED_FIXTURE = join(import.meta.dirname, "../fixtures/mixed-go-ts");

describe("mixed Go + TypeScript fixture — integration", () => {
  let inventory: Inventory;
  let imports: Imports;
  let detectedConfigs: LanguageConfig[];
  let mergedConfig: LanguageConfig;

  beforeAll(async () => {
    detectedConfigs = await detectLanguages(MIXED_FIXTURE);
    mergedConfig = mergeLanguageConfigs(detectedConfigs);

    // Use merged config so both Go and TS files are properly inventoried
    inventory = await analyzeInventory(MIXED_FIXTURE, { languageConfig: mergedConfig });

    // Pass "go" as the language hint — the import analyzer already includes
    // JS/TS extensions for backward compatibility, so Go imports are the
    // ones that need the explicit hint.
    imports = await analyzeImports(MIXED_FIXTURE, inventory, { language: "go" });
  });

  // ── Detection ───────────────────────────────────────────────────────────────

  it("detects both Go and TypeScript languages", () => {
    expect(detectedConfigs.length).toBe(2);
    const ids = detectedConfigs.map((c) => c.id);
    expect(ids).toContain("go");
    expect(ids).toContain("typescript");
  });

  // ── Config file detection ───────────────────────────────────────────────────

  it("records go.mod as a detected config file", () => {
    const goMod = inventory.files.find((f) => f.path === "go.mod");
    expect(goMod, "expected go.mod in inventory").toBeDefined();
    expect(goMod!.role).toBe("config");
  });

  it("records package.json as a detected config file", () => {
    const pkgJson = inventory.files.find((f) => f.path === "package.json");
    expect(pkgJson, "expected package.json in inventory").toBeDefined();
    expect(pkgJson!.role).toBe("config");
  });

  // ── Import edges for Go source files ────────────────────────────────────────

  it("produces import edges for Go source files", () => {
    // cmd/server/main.go imports internal/api
    const goEdge = imports.edges.find(
      (e) => e.from === "cmd/server/main.go" && e.to === "internal/api",
    );
    expect(goEdge, "expected Go import edge cmd/server/main.go → internal/api").toBeDefined();
    expect(goEdge!.type).toBe("static");
  });

  it("includes Go source files in the inventory", () => {
    const goSourceFiles = inventory.files.filter(
      (f) => f.path.endsWith(".go") && f.role === "source",
    );
    expect(goSourceFiles.length).toBeGreaterThanOrEqual(2);

    // Specific files expected
    const mainGo = inventory.files.find((f) => f.path === "cmd/server/main.go");
    expect(mainGo, "expected cmd/server/main.go in inventory").toBeDefined();
    expect(mainGo!.language).toBe("Go");

    const routerGo = inventory.files.find((f) => f.path === "internal/api/router.go");
    expect(routerGo, "expected internal/api/router.go in inventory").toBeDefined();
    expect(routerGo!.language).toBe("Go");
  });

  // ── Import edges for TypeScript source files ────────────────────────────────

  it("produces import edges for TypeScript source files", () => {
    // web/src/components/Header.tsx imports web/src/utils/format.ts
    const tsEdge = imports.edges.find(
      (e) =>
        e.from === "web/src/components/Header.tsx" &&
        e.to === "web/src/utils/format.ts",
    );
    expect(
      tsEdge,
      "expected TS import edge web/src/components/Header.tsx → web/src/utils/format.ts",
    ).toBeDefined();
  });

  it("includes TypeScript source files in the inventory", () => {
    const tsSourceFiles = inventory.files.filter(
      (f) => (f.path.endsWith(".ts") || f.path.endsWith(".tsx")) && f.role === "source",
    );
    expect(tsSourceFiles.length).toBeGreaterThanOrEqual(2);

    const headerTsx = inventory.files.find((f) => f.path === "web/src/components/Header.tsx");
    expect(headerTsx, "expected web/src/components/Header.tsx in inventory").toBeDefined();
    expect(headerTsx!.language).toBe("TypeScript");

    const formatTs = inventory.files.find((f) => f.path === "web/src/utils/format.ts");
    expect(formatTs, "expected web/src/utils/format.ts in inventory").toBeDefined();
    expect(formatTs!.language).toBe("TypeScript");
  });

  // ── Test file classification ────────────────────────────────────────────────

  it("classifies Go _test.go files correctly with merged config", () => {
    const testFile = inventory.files.find((f) => f.path === "internal/api/router_test.go");
    expect(testFile, "expected internal/api/router_test.go in inventory").toBeDefined();
    expect(testFile!.role).toBe("test");
  });

  // ── Skip directories from both languages ────────────────────────────────────

  it("merged config skips vendor/ (Go) and node_modules (TypeScript)", () => {
    expect(mergedConfig.skipDirectories.has("vendor")).toBe(true);
    expect(mergedConfig.skipDirectories.has("node_modules")).toBe(true);
  });

  // ── Both languages have import edges ────────────────────────────────────────

  it("has import edges from both Go and TypeScript source files", () => {
    const goEdges = imports.edges.filter((e) => e.from.endsWith(".go"));
    const tsEdges = imports.edges.filter(
      (e) => e.from.endsWith(".ts") || e.from.endsWith(".tsx"),
    );

    expect(goEdges.length, "expected at least one Go import edge").toBeGreaterThanOrEqual(1);
    expect(tsEdges.length, "expected at least one TypeScript import edge").toBeGreaterThanOrEqual(1);
  });
});
