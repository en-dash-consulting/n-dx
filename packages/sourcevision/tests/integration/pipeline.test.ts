import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeZones } from "../../src/analyzers/zones.js";
import { analyzeComponents } from "../../src/analyzers/components.js";
import { validateInventory, validateImports, validateZones, validateComponents } from "../../src/schema/validate.js";

const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/small-ts-project");

describe("full analysis pipeline on small-ts-project", () => {
  it("runs inventory → imports → zones and produces valid output", async () => {
    // Phase 1: Inventory
    const inventory = await analyzeInventory(FIXTURE_DIR);
    const invResult = validateInventory(inventory);
    expect(invResult.ok).toBe(true);
    expect(inventory.files.length).toBeGreaterThan(0);
    expect(inventory.summary.totalFiles).toBe(inventory.files.length);

    // Phase 2: Imports
    const imports = await analyzeImports(FIXTURE_DIR, inventory);
    const impResult = validateImports(imports);
    expect(impResult.ok).toBe(true);
    expect(imports.edges.length).toBeGreaterThan(0);

    // Verify known edges exist
    const hasFormatImport = imports.edges.some(
      (e) => e.from.includes("validate") && e.to.includes("format")
    );
    expect(hasFormatImport).toBe(true);

    const hasUserServiceImport = imports.edges.some(
      (e) => e.from.includes("user-service") && e.to.includes("user")
    );
    expect(hasUserServiceImport).toBe(true);

    // Phase 3: Zones (fast mode, no AI)
    const { zones } = await analyzeZones(inventory, imports, { enrich: false });
    const zonesResult = validateZones(zones);
    expect(zonesResult.ok).toBe(true);
    expect(zones.zones.length).toBeGreaterThan(0);
  });

  it("produces deterministic output on repeated runs", async () => {
    const inventory1 = await analyzeInventory(FIXTURE_DIR);
    const inventory2 = await analyzeInventory(FIXTURE_DIR);
    expect(JSON.stringify(inventory1)).toBe(JSON.stringify(inventory2));

    const imports1 = await analyzeImports(FIXTURE_DIR, inventory1);
    const imports2 = await analyzeImports(FIXTURE_DIR, inventory2);
    expect(JSON.stringify(imports1)).toBe(JSON.stringify(imports2));
  });
});

const REMIX_FIXTURE_DIR = join(import.meta.dirname, "../fixtures/remix-app");

describe("full analysis pipeline on remix-app", () => {
  it("runs inventory → imports → components and detects routes", async () => {
    const inventory = await analyzeInventory(REMIX_FIXTURE_DIR);
    expect(inventory.files.length).toBeGreaterThan(0);

    const imports = await analyzeImports(REMIX_FIXTURE_DIR, inventory);
    const impResult = validateImports(imports);
    expect(impResult.ok).toBe(true);

    const components = await analyzeComponents(REMIX_FIXTURE_DIR, inventory, imports);
    const compResult = validateComponents(components);
    expect(compResult.ok).toBe(true);

    // Should detect route modules
    expect(components.routeModules.length).toBeGreaterThan(0);

    // Should detect the index route
    const indexRoute = components.routeModules.find((m) => m.isIndex);
    expect(indexRoute).toBeDefined();
    expect(indexRoute!.routePattern).toBe("/");

    // Should detect the dynamic user route
    const userRoute = components.routeModules.find((m) => m.file.includes("users.$id"));
    expect(userRoute).toBeDefined();
    expect(userRoute!.routePattern).toBe("/users/:id");
    expect(userRoute!.exports).toContain("loader");
    expect(userRoute!.exports).toContain("action");

    // Should detect the auth layout
    const authLayout = components.routeModules.find((m) => m.file.includes("_auth.tsx"));
    expect(authLayout).toBeDefined();
    expect(authLayout!.isLayout).toBe(true);

    // Should detect components
    expect(components.summary.totalComponents).toBeGreaterThan(0);
  });
});
