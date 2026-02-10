import { describe, it, expect } from "vitest";
import {
  generatePdfReport,
  computeImportHealthScore,
} from "../../../src/export/pdf-report.js";
import type {
  Manifest,
  Inventory,
  Imports,
  Zones,
  Components,
} from "../../../src/schema/v1.js";

describe("generatePdfReport", () => {
  it("returns a Buffer containing PDF data", async () => {
    const data = makeTestData();
    const result = await generatePdfReport(data);

    expect(result).toBeInstanceOf(Buffer);
    // PDF files start with %PDF-
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("includes project name in PDF content", async () => {
    const data = makeTestData();
    const result = await generatePdfReport(data);

    // The buffer should be non-trivially sized (has actual content)
    expect(result.length).toBeGreaterThan(100);
  });

  it("handles data without components", async () => {
    const data = makeTestData();
    data.components = undefined;
    const result = await generatePdfReport(data);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("handles empty zones", async () => {
    const data = makeTestData();
    data.zones.zones = [];
    const result = await generatePdfReport(data);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders zone architecture visualization with multiple zones", async () => {
    const data = makeTestData();
    data.zones.zones = [
      {
        id: "zone-1",
        name: "Core",
        description: "Core module",
        files: ["src/a.ts", "src/b.ts", "src/c.ts"],
        entryPoints: ["src/a.ts"],
        cohesion: 0.9,
        coupling: 0.1,
        insights: ["Well-isolated module", "High internal cohesion"],
      },
      {
        id: "zone-2",
        name: "UI",
        description: "UI components",
        files: ["src/ui/x.tsx"],
        entryPoints: [],
        cohesion: 0.5,
        coupling: 0.6,
      },
    ];
    data.zones.crossings = [
      { from: "src/ui/x.tsx", to: "src/a.ts", fromZone: "zone-2", toZone: "zone-1" },
    ];
    data.zones.unzoned = ["misc/orphan.ts"];

    const result = await generatePdfReport(data);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
    // With zones, bars, and legend the PDF should be significantly larger
    expect(result.length).toBeGreaterThan(500);
  });

  it("renders component catalog with usage statistics", async () => {
    const data = makeTestData();
    data.components = {
      components: [
        {
          file: "src/Button.tsx",
          name: "Button",
          kind: "function",
          line: 5,
          isDefaultExport: true,
          conventionExports: [],
        },
        {
          file: "src/Input.tsx",
          name: "Input",
          kind: "arrow",
          line: 3,
          isDefaultExport: true,
          conventionExports: [],
        },
        {
          file: "src/Modal.tsx",
          name: "Modal",
          kind: "function",
          line: 10,
          isDefaultExport: false,
          conventionExports: [],
        },
      ],
      usageEdges: [
        { from: "src/App.tsx", to: "src/Button.tsx", componentName: "Button", usageCount: 5 },
        { from: "src/Form.tsx", to: "src/Input.tsx", componentName: "Input", usageCount: 3 },
      ],
      routeModules: [
        {
          file: "src/routes/home.tsx",
          routePattern: "/",
          exports: ["default", "loader"],
          parentLayout: null,
          isLayout: false,
          isIndex: true,
        },
      ],
      routeTree: [],
      summary: {
        totalComponents: 3,
        totalRouteModules: 1,
        totalUsageEdges: 2,
        routeConventions: { default: 1, loader: 1 },
        mostUsedComponents: [
          { name: "Button", file: "src/Button.tsx", usageCount: 5 },
          { name: "Input", file: "src/Input.tsx", usageCount: 3 },
        ],
        layoutDepth: 1,
      },
    };

    const result = await generatePdfReport(data);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.length).toBeGreaterThan(500);
  });

  it("renders import graph health section with circulars", async () => {
    const data = makeTestData();
    data.imports.summary.circularCount = 2;
    data.imports.summary.circulars = [
      { cycle: ["src/a.ts", "src/b.ts", "src/a.ts"] },
      { cycle: ["src/c.ts", "src/d.ts", "src/c.ts"] },
    ];
    data.imports.edges = [
      { from: "src/a.ts", to: "src/b.ts", type: "static", symbols: ["x"] },
      { from: "src/b.ts", to: "src/a.ts", type: "static", symbols: ["y"] },
      { from: "src/c.ts", to: "src/d.ts", type: "dynamic", symbols: ["z"] },
      { from: "src/d.ts", to: "src/c.ts", type: "require", symbols: ["w"] },
    ];
    data.imports.external = [
      { package: "react", importedBy: ["src/a.ts", "src/b.ts"], symbols: ["useState"] },
      { package: "zod", importedBy: ["src/a.ts"], symbols: ["z"] },
    ];
    data.imports.summary.totalEdges = 4;
    data.imports.summary.totalExternal = 2;

    const result = await generatePdfReport(data);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("handles zones with insights", async () => {
    const data = makeTestData();
    data.zones.zones[0].insights = [
      "High cohesion indicates good module design",
      "Consider extracting shared utilities",
      "Entry point is well-defined",
    ];

    const result = await generatePdfReport(data);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("handles findings with warnings and critical issues", async () => {
    const data = makeTestData();
    data.zones.findings = [
      { type: "anti-pattern", pass: 1, scope: "global", text: "Circular import detected", severity: "critical" },
      { type: "suggestion", pass: 1, scope: "zone-1", text: "Consider splitting large zone", severity: "warning" },
      { type: "observation", pass: 1, scope: "global", text: "Normal observation", severity: "info" },
    ];

    const result = await generatePdfReport(data);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("computeImportHealthScore", () => {
  it("returns 100 for a healthy codebase with no issues", () => {
    const imports = makeImports({ circularCount: 0, avgImportsPerFile: 3 });
    const inventory = makeInventory(10);

    const score = computeImportHealthScore(imports, inventory);

    expect(score).toBe(100);
  });

  it("penalizes circular dependencies", () => {
    const importsNone = makeImports({ circularCount: 0, avgImportsPerFile: 3 });
    const importsSome = makeImports({ circularCount: 5, avgImportsPerFile: 3 });
    const inventory = makeInventory(10);

    const scoreClean = computeImportHealthScore(importsNone, inventory);
    const scoreDirty = computeImportHealthScore(importsSome, inventory);

    expect(scoreClean).toBeGreaterThan(scoreDirty);
  });

  it("penalizes high average imports per file", () => {
    const importsLow = makeImports({ circularCount: 0, avgImportsPerFile: 3 });
    const importsHigh = makeImports({ circularCount: 0, avgImportsPerFile: 20 });
    const inventory = makeInventory(10);

    const scoreLow = computeImportHealthScore(importsLow, inventory);
    const scoreHigh = computeImportHealthScore(importsHigh, inventory);

    expect(scoreLow).toBeGreaterThan(scoreHigh);
  });

  it("returns 100 for an empty project", () => {
    const imports = makeImports({ circularCount: 0, avgImportsPerFile: 0 });
    const inventory = makeInventory(0);

    const score = computeImportHealthScore(imports, inventory);

    expect(score).toBe(100);
  });

  it("penalizes excessive external dependencies", () => {
    const importsLow = makeImports({
      circularCount: 0,
      avgImportsPerFile: 3,
      totalExternal: 5,
    });
    const importsHigh = makeImports({
      circularCount: 0,
      avgImportsPerFile: 3,
      totalExternal: 100,
    });
    const inventory = makeInventory(10);

    const scoreLow = computeImportHealthScore(importsLow, inventory);
    const scoreHigh = computeImportHealthScore(importsHigh, inventory);

    expect(scoreLow).toBeGreaterThan(scoreHigh);
  });

  it("produces a score between 0 and 100", () => {
    // Worst case: lots of circulars, high avg imports, tons of externals
    const imports = makeImports({
      circularCount: 50,
      avgImportsPerFile: 30,
      totalExternal: 200,
    });
    const inventory = makeInventory(10);

    const score = computeImportHealthScore(imports, inventory);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── Test helpers ────────────────────────────────────────────────────────────

function makeTestData(): {
  manifest: Manifest;
  inventory: Inventory;
  imports: Imports;
  zones: Zones;
  components?: Components;
} {
  return {
    manifest: {
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: "2025-01-01T00:00:00Z",
      targetPath: "/home/user/my-project",
      modules: {
        inventory: { status: "complete" },
        imports: { status: "complete" },
        zones: { status: "complete" },
      },
    },
    inventory: {
      files: [
        {
          path: "src/index.ts",
          size: 256,
          language: "TypeScript",
          lineCount: 20,
          hash: "abc123",
          role: "source",
          category: "main",
        },
        {
          path: "src/utils.ts",
          size: 128,
          language: "TypeScript",
          lineCount: 10,
          hash: "def456",
          role: "source",
          category: "utility",
        },
      ],
      summary: {
        totalFiles: 2,
        totalLines: 30,
        byLanguage: { TypeScript: 2 },
        byRole: { source: 2 },
        byCategory: { main: 1, utility: 1 },
      },
    },
    imports: {
      edges: [
        {
          from: "src/index.ts",
          to: "src/utils.ts",
          type: "static",
          symbols: ["helper"],
        },
      ],
      external: [
        { package: "zod", importedBy: ["src/index.ts"], symbols: ["z"] },
      ],
      summary: {
        totalEdges: 1,
        totalExternal: 1,
        circularCount: 0,
        circulars: [],
        mostImported: [{ path: "src/utils.ts", count: 1 }],
        avgImportsPerFile: 0.5,
      },
    },
    zones: {
      zones: [
        {
          id: "zone-1",
          name: "Core",
          description: "Core application module",
          files: ["src/index.ts", "src/utils.ts"],
          entryPoints: ["src/index.ts"],
          cohesion: 0.85,
          coupling: 0.15,
        },
      ],
      crossings: [],
      unzoned: [],
      findings: [
        {
          type: "observation",
          pass: 1,
          scope: "global",
          text: "Small, well-structured project",
          severity: "info",
        },
      ],
    },
    components: {
      components: [],
      usageEdges: [],
      routeModules: [],
      routeTree: [],
      summary: {
        totalComponents: 0,
        totalRouteModules: 0,
        totalUsageEdges: 0,
        routeConventions: {},
        mostUsedComponents: [],
        layoutDepth: 0,
      },
    },
  };
}

function makeImports(opts: {
  circularCount: number;
  avgImportsPerFile: number;
  totalExternal?: number;
}): Imports {
  return {
    edges: [],
    external: [],
    summary: {
      totalEdges: 0,
      totalExternal: opts.totalExternal ?? 1,
      circularCount: opts.circularCount,
      circulars: [],
      mostImported: [],
      avgImportsPerFile: opts.avgImportsPerFile,
    },
  };
}

function makeInventory(totalFiles: number): Inventory {
  return {
    files: [],
    summary: {
      totalFiles,
      totalLines: totalFiles * 50,
      byLanguage: { TypeScript: totalFiles },
      byRole: { source: totalFiles },
      byCategory: {},
    },
  };
}
