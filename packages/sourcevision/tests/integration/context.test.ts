import { describe, it, expect } from "vitest";
import { generateContext } from "../../src/analyzers/context.js";
import type { Manifest, Inventory, Imports, Zones, Components } from "../../src/schema/index.js";

const manifest: Manifest = {
  schemaVersion: "1.0.0",
  toolVersion: "0.1.0",
  analyzedAt: "2024-01-01T00:00:00Z",
  gitSha: "abc1234",
  gitBranch: "main",
  targetPath: "/projects/my-app",
  modules: {},
};

const inventory: Inventory = {
  files: [
    { path: "src/index.ts", size: 100, language: "TypeScript", lineCount: 10, hash: "a", role: "source", category: "root" },
  ],
  summary: {
    totalFiles: 1,
    totalLines: 10,
    byLanguage: { TypeScript: 1 },
    byRole: { source: 1 },
    byCategory: { root: 1 },
  },
};

const imports: Imports = {
  edges: [],
  external: [],
  summary: {
    totalEdges: 0,
    totalExternal: 0,
    circularCount: 0,
    circulars: [],
    mostImported: [],
    avgImportsPerFile: 0,
  },
};

const zones: Zones = {
  zones: [{
    id: "core",
    name: "Core",
    description: "Core logic",
    files: ["src/index.ts"],
    entryPoints: ["src/index.ts"],
    cohesion: 0.9,
    coupling: 0.1,
  }],
  crossings: [],
  unzoned: [],
  findings: [
    { type: "anti-pattern", pass: 1, scope: "global", text: "No tests found", severity: "warning" },
  ],
};

describe("generateContext", () => {
  it("generates context with XML markers", () => {
    const result = generateContext(manifest, inventory, imports, zones);

    expect(result).toContain("<architecture>");
    expect(result).toContain("</architecture>");
    expect(result).toContain("<zones>");
    expect(result).toContain("</zones>");
    expect(result).toContain("<findings>");
    expect(result).toContain("</findings>");
  });

  it("includes project metadata with description count", () => {
    const result = generateContext(manifest, inventory, imports, zones);

    expect(result).toContain("Project: my-app");
    expect(result).toContain("Git: main @ abc1234");
    expect(result).toContain("Files: 1");
    expect(result).toContain("Zones: 1, Described: 1");
  });

  it("shows correct description count when some zones lack descriptions", () => {
    const mixedZones: Zones = {
      ...zones,
      zones: [
        { id: "core", name: "Core", description: "Core logic", files: ["src/index.ts"], entryPoints: [], cohesion: 0.9, coupling: 0.1 },
        { id: "utils", name: "Utils", description: "", files: ["src/utils.ts"], entryPoints: [], cohesion: 0.8, coupling: 0.2 },
        { id: "api", name: "API", description: "API layer", files: ["src/api.ts"], entryPoints: [], cohesion: 0.7, coupling: 0.3 },
      ],
    };

    const result = generateContext(manifest, inventory, imports, mixedZones);
    expect(result).toContain("Zones: 3, Described: 2");
  });

  it("includes zone data", () => {
    const result = generateContext(manifest, inventory, imports, zones);

    expect(result).toContain("[core] Core");
    expect(result).toContain("coh=0.90");
  });

  it("only shows warning and critical findings", () => {
    const zonesWithFindings: Zones = {
      ...zones,
      findings: [
        { type: "observation", pass: 1, scope: "global", text: "Info finding", severity: "info" },
        { type: "anti-pattern", pass: 1, scope: "global", text: "Warning finding", severity: "warning" },
        { type: "anti-pattern", pass: 1, scope: "global", text: "Critical finding", severity: "critical" },
      ],
    };

    const result = generateContext(manifest, inventory, imports, zonesWithFindings);

    expect(result).not.toContain("Info finding");
    expect(result).toContain("Warning finding");
    expect(result).toContain("Critical finding");
  });

  it("includes routes section when components provided", () => {
    const components: Components = {
      components: [],
      usageEdges: [],
      routeModules: [
        { file: "routes/_index.tsx", routePattern: "/", exports: ["default"], parentLayout: null, isLayout: false, isIndex: true },
      ],
      routeTree: [
        { file: "routes/_index.tsx", routePattern: "/", children: [] },
      ],
      summary: {
        totalComponents: 0,
        totalRouteModules: 1,
        totalUsageEdges: 0,
        routeConventions: { default: 1 },
        mostUsedComponents: [],
        layoutDepth: 1,
      },
    };

    const result = generateContext(manifest, inventory, imports, zones, components);
    expect(result).toContain("<routes>");
    expect(result).toContain("</routes>");
    expect(result).toContain("Route modules: 1");
  });

  it("instructs LLM to group related and separate unrelated", () => {
    const result = generateContext(manifest, inventory, imports, zones);
    expect(result).toContain("group related");
    expect(result).toContain("separate unrelated");
  });

  it("stays within reasonable token budget", () => {
    const result = generateContext(manifest, inventory, imports, zones);
    // Rough estimate: ~4 chars per token, 8K token budget = ~32K chars
    expect(result.length).toBeLessThan(32000);
  });
});
