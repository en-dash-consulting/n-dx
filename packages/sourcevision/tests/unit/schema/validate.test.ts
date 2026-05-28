import { describe, it, expect } from "vitest";
import {
  validate,
  validateModule,
  formatValidationErrors,
  ManifestSchema,
  InventorySchema,
  ImportsSchema,
  ZonesSchema,
  ComponentsSchema,
  ClassificationsSchema,
} from "../../../src/schema/validate.js";

// Test-local convenience wrappers. The production validate*() helpers were
// inlined to validate(Schema, data) in 799a48194; these keep the call sites
// below readable without reintroducing the wrappers in production code.
const validateManifest = (data: unknown) => validate(ManifestSchema, data);
const validateInventory = (data: unknown) => validate(InventorySchema, data);
const validateImports = (data: unknown) => validate(ImportsSchema, data);
const validateZones = (data: unknown) => validate(ZonesSchema, data);
const validateComponents = (data: unknown) => validate(ComponentsSchema, data);
const validateClassifications = (data: unknown) =>
  validate(ClassificationsSchema, data);

describe("validateManifest", () => {
  it("accepts valid manifest", () => {
    const result = validateManifest({
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: "2024-01-01T00:00:00Z",
      targetPath: "/test",
      modules: {},
    });
    expect(result.ok).toBe(true);
  });

  it("rejects manifest missing required fields", () => {
    const result = validateManifest({ schemaVersion: "1.0.0" });
    expect(result.ok).toBe(false);
  });

  it("accepts manifest with optional git fields", () => {
    const result = validateManifest({
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: "2024-01-01T00:00:00Z",
      targetPath: "/test",
      modules: {},
      gitSha: "abc123",
      gitBranch: "main",
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateInventory", () => {
  it("accepts valid inventory", () => {
    const result = validateInventory({
      files: [{
        path: "src/index.ts",
        size: 100,
        language: "TypeScript",
        lineCount: 10,
        hash: "abc",
        role: "source",
        category: "root",
      }],
      summary: {
        totalFiles: 1,
        totalLines: 10,
        byLanguage: { TypeScript: 1 },
        byRole: { source: 1 },
        byCategory: { root: 1 },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects negative file size", () => {
    const result = validateInventory({
      files: [{
        path: "test.ts",
        size: -1,
        language: "TypeScript",
        lineCount: 0,
        hash: "abc",
        role: "source",
        category: "root",
      }],
      summary: { totalFiles: 1, totalLines: 0, byLanguage: {}, byRole: {}, byCategory: {} },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = validateInventory({
      files: [{
        path: "test.ts",
        size: 0,
        language: "TypeScript",
        lineCount: 0,
        hash: "abc",
        role: "invalid",
        category: "root",
      }],
      summary: { totalFiles: 1, totalLines: 0, byLanguage: {}, byRole: {}, byCategory: {} },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts file entry with lastModified", () => {
    const result = validateInventory({
      files: [{
        path: "src/index.ts",
        size: 100,
        language: "TypeScript",
        lineCount: 10,
        hash: "abc",
        role: "source",
        category: "root",
        lastModified: 1700000000000,
      }],
      summary: {
        totalFiles: 1,
        totalLines: 10,
        byLanguage: { TypeScript: 1 },
        byRole: { source: 1 },
        byCategory: { root: 1 },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts file entry without lastModified", () => {
    const result = validateInventory({
      files: [{
        path: "src/index.ts",
        size: 100,
        language: "TypeScript",
        lineCount: 10,
        hash: "abc",
        role: "source",
        category: "root",
      }],
      summary: {
        totalFiles: 1,
        totalLines: 10,
        byLanguage: { TypeScript: 1 },
        byRole: { source: 1 },
        byCategory: { root: 1 },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects negative lastModified", () => {
    const result = validateInventory({
      files: [{
        path: "src/index.ts",
        size: 100,
        language: "TypeScript",
        lineCount: 10,
        hash: "abc",
        role: "source",
        category: "root",
        lastModified: -1,
      }],
      summary: {
        totalFiles: 1,
        totalLines: 10,
        byLanguage: { TypeScript: 1 },
        byRole: { source: 1 },
        byCategory: { root: 1 },
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateImports", () => {
  const validImports = {
    edges: [{
      from: "src/a.ts",
      to: "src/b.ts",
      type: "static",
      symbols: ["default"],
    }],
    external: [{
      package: "react",
      importedBy: ["src/a.ts"],
      symbols: ["useState"],
    }],
    summary: {
      totalEdges: 1,
      totalExternal: 1,
      circularCount: 0,
      circulars: [],
      mostImported: [{ path: "src/b.ts", count: 1 }],
      avgImportsPerFile: 1,
    },
  };

  it("accepts valid imports data", () => {
    const result = validateImports(validImports);
    expect(result.ok).toBe(true);
  });

  it("accepts empty imports", () => {
    const result = validateImports({
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
    });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid import type", () => {
    const result = validateImports({
      ...validImports,
      edges: [{ from: "a.ts", to: "b.ts", type: "invalid", symbols: [] }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts all valid import types", () => {
    const types = ["static", "dynamic", "require", "reexport", "type"];
    for (const type of types) {
      const result = validateImports({
        ...validImports,
        edges: [{ from: "a.ts", to: "b.ts", type, symbols: ["x"] }],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("accepts circular dependencies", () => {
    const result = validateImports({
      ...validImports,
      summary: {
        ...validImports.summary,
        circularCount: 1,
        circulars: [{ cycle: ["a.ts", "b.ts", "a.ts"] }],
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing summary fields", () => {
    const result = validateImports({
      edges: [],
      external: [],
      summary: { totalEdges: 0 },
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateZones", () => {
  const validZones = {
    zones: [{
      id: "core",
      name: "Core",
      description: "Core logic",
      files: ["src/a.ts"],
      entryPoints: ["src/a.ts"],
      cohesion: 0.85,
      coupling: 0.15,
    }],
    crossings: [],
    unzoned: [],
  };

  it("accepts valid zones data", () => {
    const result = validateZones(validZones);
    expect(result.ok).toBe(true);
  });

  it("accepts empty zones", () => {
    const result = validateZones({
      zones: [],
      crossings: [],
      unzoned: [],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts zones with optional fields", () => {
    const result = validateZones({
      ...validZones,
      insights: ["Some insight"],
      findings: [{
        type: "observation",
        pass: 0,
        scope: "core",
        text: "High cohesion",
        severity: "info",
      }],
      enrichmentPass: 2,
      metaEvaluationCount: 1,
      structureHash: "abc123",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects cohesion out of range", () => {
    const result = validateZones({
      ...validZones,
      zones: [{ ...validZones.zones[0], cohesion: 1.5 }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects negative coupling", () => {
    const result = validateZones({
      ...validZones,
      zones: [{ ...validZones.zones[0], coupling: -0.1 }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts zone crossings", () => {
    const result = validateZones({
      ...validZones,
      crossings: [{
        from: "src/a.ts",
        to: "src/b.ts",
        fromZone: "core",
        toZone: "util",
      }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid finding type", () => {
    const result = validateZones({
      ...validZones,
      findings: [{
        type: "invalid",
        pass: 0,
        scope: "core",
        text: "Test",
      }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts all valid finding types", () => {
    const types = ["observation", "pattern", "relationship", "anti-pattern", "suggestion"];
    for (const type of types) {
      const result = validateZones({
        ...validZones,
        findings: [{ type, pass: 0, scope: "core", text: "Test" }],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects missing required zone fields", () => {
    const result = validateZones({
      zones: [{ id: "test", name: "Test" }],
      crossings: [],
      unzoned: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateComponents", () => {
  it("accepts valid components data", () => {
    const result = validateComponents({
      components: [{
        file: "src/Button.tsx",
        name: "Button",
        kind: "function",
        line: 1,
        isDefaultExport: false,
        conventionExports: [],
      }],
      usageEdges: [{
        from: "src/App.tsx",
        to: "src/Button.tsx",
        componentName: "Button",
        usageCount: 3,
      }],
      routeModules: [],
      routeTree: [],
      serverRoutes: [],
      summary: {
        totalComponents: 1,
        totalRouteModules: 0,
        totalServerRoutes: 0,
        totalUsageEdges: 1,
        routeConventions: {},
        mostUsedComponents: [{ name: "Button", file: "src/Button.tsx", usageCount: 3 }],
        layoutDepth: 0,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid component kind", () => {
    const result = validateComponents({
      components: [{
        file: "test.tsx",
        name: "X",
        kind: "invalid",
        line: 1,
        isDefaultExport: false,
        conventionExports: [],
      }],
      usageEdges: [],
      routeModules: [],
      routeTree: [],
      serverRoutes: [],
      summary: {
        totalComponents: 1,
        totalRouteModules: 0,
        totalServerRoutes: 0,
        totalUsageEdges: 0,
        routeConventions: {},
        mostUsedComponents: [],
        layoutDepth: 0,
      },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts route modules with convention exports", () => {
    const result = validateComponents({
      components: [],
      usageEdges: [],
      routeModules: [{
        file: "app/routes/_index.tsx",
        routePattern: "/",
        exports: ["loader", "default", "meta"],
        parentLayout: null,
        isLayout: false,
        isIndex: true,
      }],
      routeTree: [{
        file: "app/routes/_index.tsx",
        routePattern: "/",
        children: [],
      }],
      serverRoutes: [],
      summary: {
        totalComponents: 0,
        totalRouteModules: 1,
        totalServerRoutes: 0,
        totalUsageEdges: 0,
        routeConventions: { loader: 1, default: 1, meta: 1 },
        mostUsedComponents: [],
        layoutDepth: 1,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts nested route tree", () => {
    const result = validateComponents({
      components: [],
      usageEdges: [],
      routeModules: [],
      routeTree: [{
        file: "app/routes/users.tsx",
        routePattern: "/users",
        children: [{
          file: "app/routes/users.$id.tsx",
          routePattern: "/users/:id",
          children: [],
        }],
      }],
      serverRoutes: [],
      summary: {
        totalComponents: 0,
        totalRouteModules: 0,
        totalServerRoutes: 0,
        totalUsageEdges: 0,
        routeConventions: {},
        mostUsedComponents: [],
        layoutDepth: 2,
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateClassifications", () => {
  const validClassifications = {
    archetypes: [{
      id: "utility",
      name: "Utility",
      description: "Shared utility modules",
      signals: [{ kind: "directory", pattern: "/utils/", weight: 0.8 }],
    }],
    files: [{
      path: "src/utils/format.ts",
      archetype: "utility",
      confidence: 0.8,
      source: "algorithmic",
    }],
    summary: {
      totalClassified: 1,
      totalUnclassified: 0,
      byArchetype: { utility: 1 },
      bySource: { algorithmic: 1 },
    },
  };

  it("accepts valid classifications", () => {
    const result = validateClassifications(validClassifications);
    expect(result.ok).toBe(true);
  });

  it("accepts empty classifications", () => {
    const result = validateClassifications({
      archetypes: [],
      files: [],
      summary: {
        totalClassified: 0,
        totalUnclassified: 0,
        byArchetype: {},
        bySource: {},
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts file with null archetype", () => {
    const result = validateClassifications({
      ...validClassifications,
      files: [{
        path: "src/unknown.ts",
        archetype: null,
        confidence: 0,
        source: "algorithmic",
      }],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts file with secondary archetypes and evidence", () => {
    const result = validateClassifications({
      ...validClassifications,
      files: [{
        path: "src/config/index.ts",
        archetype: "entrypoint",
        secondaryArchetypes: ["config"],
        confidence: 0.8,
        source: "algorithmic",
        evidence: [{
          archetypeId: "entrypoint",
          signalKind: "filename",
          detail: "filename matches pattern",
          weight: 0.8,
        }],
      }],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts all valid source values", () => {
    const sources = ["algorithmic", "llm", "user-override"];
    for (const source of sources) {
      const result = validateClassifications({
        ...validClassifications,
        files: [{ ...validClassifications.files[0], source }],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects invalid source value", () => {
    const result = validateClassifications({
      ...validClassifications,
      files: [{ ...validClassifications.files[0], source: "invalid" }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts all valid signal kinds", () => {
    const kinds = ["path", "import", "export", "filename", "directory"];
    for (const kind of kinds) {
      const result = validateClassifications({
        ...validClassifications,
        archetypes: [{
          ...validClassifications.archetypes[0],
          signals: [{ kind, pattern: "test", weight: 0.5 }],
        }],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects invalid signal kind", () => {
    const result = validateClassifications({
      ...validClassifications,
      archetypes: [{
        ...validClassifications.archetypes[0],
        signals: [{ kind: "invalid", pattern: "test", weight: 0.5 }],
      }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = validateClassifications({ archetypes: [] });
    expect(result.ok).toBe(false);
  });

  it("accepts archetype with analysisHints", () => {
    const result = validateClassifications({
      ...validClassifications,
      archetypes: [{
        ...validClassifications.archetypes[0],
        analysisHints: { deadExports: "skip", description: "test" },
      }],
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateModule", () => {
  it("dispatches to correct validator", () => {
    const result = validateModule("manifest", {
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: "2024-01-01T00:00:00Z",
      targetPath: "/test",
      modules: {},
    });
    expect(result.ok).toBe(true);
  });

  it("validates components module", () => {
    const result = validateModule("components", {
      components: [],
      usageEdges: [],
      routeModules: [],
      routeTree: [],
      serverRoutes: [],
      summary: {
        totalComponents: 0,
        totalRouteModules: 0,
        totalServerRoutes: 0,
        totalUsageEdges: 0,
        routeConventions: {},
        mostUsedComponents: [],
        layoutDepth: 0,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("returns error for unknown module", () => {
    const result = validateModule("unknown", {});
    expect(result.ok).toBe(false);
  });

  it("dispatches inventory validation", () => {
    const result = validateModule("inventory", {
      files: [],
      summary: {
        totalFiles: 0,
        totalLines: 0,
        byLanguage: {},
        byRole: {},
        byCategory: {},
      },
    });
    expect(result.ok).toBe(true);
  });

  it("dispatches imports validation", () => {
    const result = validateModule("imports", {
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
    });
    expect(result.ok).toBe(true);
  });

  it("dispatches zones validation", () => {
    const result = validateModule("zones", {
      zones: [],
      crossings: [],
      unzoned: [],
    });
    expect(result.ok).toBe(true);
  });

  it("dispatches classifications validation", () => {
    const result = validateModule("classifications", {
      archetypes: [],
      files: [],
      summary: {
        totalClassified: 0,
        totalUnclassified: 0,
        byArchetype: {},
        bySource: {},
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateManifest edge cases", () => {
  it("accepts manifest with module info", () => {
    const result = validateManifest({
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: "2024-01-01T00:00:00Z",
      targetPath: "/test",
      modules: {
        inventory: { status: "complete", startedAt: "2024-01-01T00:00:00Z", completedAt: "2024-01-01T00:00:01Z" },
        imports: { status: "error", error: "Parse failure" },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects manifest with invalid module status", () => {
    const result = validateManifest({
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: "2024-01-01T00:00:00Z",
      targetPath: "/test",
      modules: {
        inventory: { status: "invalid_status" },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts all valid module status values", () => {
    const statuses = ["pending", "running", "complete", "error"];
    for (const status of statuses) {
      const result = validateManifest({
        schemaVersion: "1.0.0",
        toolVersion: "0.1.0",
        analyzedAt: "2024-01-01T00:00:00Z",
        targetPath: "/test",
        modules: { test: { status } },
      });
      expect(result.ok).toBe(true);
    }
  });
});

describe("validateInventory edge cases", () => {
  it("accepts all valid file roles", () => {
    const roles = ["source", "test", "config", "docs", "generated", "asset", "build", "other"];
    for (const role of roles) {
      const result = validateInventory({
        files: [{
          path: "test.ts",
          size: 0,
          language: "TypeScript",
          lineCount: 0,
          hash: "abc",
          role,
          category: "root",
        }],
        summary: { totalFiles: 1, totalLines: 0, byLanguage: {}, byRole: {}, byCategory: {} },
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects negative lineCount", () => {
    const result = validateInventory({
      files: [{
        path: "test.ts",
        size: 0,
        language: "TypeScript",
        lineCount: -5,
        hash: "abc",
        role: "source",
        category: "root",
      }],
      summary: { totalFiles: 0, totalLines: 0, byLanguage: {}, byRole: {}, byCategory: {} },
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateZones edge cases", () => {
  it("accepts zones with findings including severity and related", () => {
    const result = validateZones({
      zones: [],
      crossings: [],
      unzoned: [],
      findings: [{
        type: "anti-pattern",
        pass: 1,
        scope: "global",
        text: "Circular dependency detected",
        severity: "critical",
        related: ["zone-a", "zone-b"],
      }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects findings with invalid severity", () => {
    const result = validateZones({
      zones: [],
      crossings: [],
      unzoned: [],
      findings: [{
        type: "observation",
        pass: 0,
        scope: "global",
        text: "Test",
        severity: "high",
      }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts all valid severity values", () => {
    const severities = ["info", "warning", "critical"];
    for (const severity of severities) {
      const result = validateZones({
        zones: [],
        crossings: [],
        unzoned: [],
        findings: [{
          type: "observation",
          pass: 0,
          scope: "global",
          text: "Test",
          severity,
        }],
      });
      expect(result.ok).toBe(true);
    }
  });
});

describe("formatValidationErrors", () => {
  it("formats field-level errors with path", () => {
    const result = validateManifest({ schemaVersion: "1.0.0" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = formatValidationErrors(result.errors);
      expect(messages.length).toBeGreaterThan(0);
      // Should mention the missing field
      expect(messages.some((m) => m.includes("toolVersion") || m.includes("targetPath"))).toBe(true);
    }
  });

  it("formats nested field errors for invalid values", () => {
    const result = validateInventory({
      files: [{
        path: "test.ts",
        size: -1,
        language: "TypeScript",
        lineCount: 0,
        hash: "abc",
        role: "source",
        category: "root",
      }],
      summary: { totalFiles: 0, totalLines: 0, byLanguage: {}, byRole: {}, byCategory: {} },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = formatValidationErrors(result.errors);
      expect(messages.some((m) => m.includes("size"))).toBe(true);
    }
  });

  it("provides actionable messages for invalid enum values", () => {
    const result = validateImports({
      edges: [{ from: "a.ts", to: "b.ts", type: "invalid_type", symbols: [] }],
      external: [],
      summary: {
        totalEdges: 0,
        totalExternal: 0,
        circularCount: 0,
        circulars: [],
        mostImported: [],
        avgImportsPerFile: 0,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = formatValidationErrors(result.errors);
      expect(messages.some((m) => m.includes("type"))).toBe(true);
    }
  });
});
