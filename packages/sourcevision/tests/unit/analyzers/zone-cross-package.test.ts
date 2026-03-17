/**
 * Tests that analyzeZones computes cross-package crossings when subAnalyses
 * are present, making foundation-tier coupling visible in the monorepo graph.
 */
import { describe, it, expect, vi } from "vitest";
import { analyzeZones } from "../../../src/analyzers/zones.js";
import type { SubAnalysis } from "../../../src/analyzers/workspace.js";
import type {
  Zone,
  ZoneCrossing,
  Zones,
  Imports,
  ExternalImport,
  Manifest,
} from "../../../src/schema/index.js";
import { makeFileEntry, makeInventory, makeEdge, makeImports, makeZone } from "./zones-helpers.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeManifest(): Manifest {
  return {
    schemaVersion: "1.0.0",
    toolVersion: "0.1.0",
    analyzedAt: "2024-01-01T00:00:00Z",
    targetPath: "/test",
    modules: {},
  };
}

function makeSubAnalysis(overrides: Partial<SubAnalysis> & Pick<SubAnalysis, "id" | "prefix" | "svDir">): SubAnalysis {
  return {
    manifest: makeManifest(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("analyzeZones cross-package crossings", () => {
  it("computes crossings between sub-analyzed packages via external imports", async () => {
    // Set up two sub-analyzed packages:
    // - "foundation" (like @n-dx/llm-client) with zones containing source files
    // - "consumer" (like rex) that imports foundation via npm package name

    const foundationZone = makeZone("core", [
      "src/client.ts",
      "src/types.ts",
      "src/public.ts",
    ]);

    const consumerZone = makeZone("agent", [
      "src/agent.ts",
      "src/runner.ts",
    ]);

    const foundation: SubAnalysis = makeSubAnalysis({
      id: "packages-foundation",
      prefix: "packages/foundation",
      svDir: "/test/packages/foundation/.sourcevision",
      zones: {
        zones: [foundationZone],
        crossings: [],
        unzoned: [],
      },
      imports: {
        edges: [
          { from: "src/client.ts", to: "src/types.ts", type: "static", symbols: ["Config"] },
        ],
        external: [],
        summary: {
          totalEdges: 1, totalExternal: 0, circularCount: 0,
          circulars: [], mostImported: [], avgImportsPerFile: 1,
        },
      },
      inventory: {
        files: [
          makeFileEntry("src/client.ts"),
          makeFileEntry("src/types.ts"),
          makeFileEntry("src/public.ts"),
        ],
        summary: { totalFiles: 3, totalLines: 30, byLanguage: {}, byRole: {}, byCategory: {} },
      },
    });

    const consumer: SubAnalysis = makeSubAnalysis({
      id: "packages-consumer",
      prefix: "packages/consumer",
      svDir: "/test/packages/consumer/.sourcevision",
      zones: {
        zones: [consumerZone],
        crossings: [],
        unzoned: [],
      },
      imports: {
        edges: [
          { from: "src/agent.ts", to: "src/runner.ts", type: "static", symbols: ["run"] },
        ],
        external: [
          {
            package: "@test/foundation",
            importedBy: ["src/agent.ts"],
            symbols: ["createClient"],
          },
        ],
        summary: {
          totalEdges: 1, totalExternal: 1, circularCount: 0,
          circulars: [], mostImported: [], avgImportsPerFile: 1,
        },
      },
      inventory: {
        files: [
          makeFileEntry("src/agent.ts"),
          makeFileEntry("src/runner.ts"),
        ],
        summary: { totalFiles: 2, totalLines: 20, byLanguage: {}, byRole: {}, byCategory: {} },
      },
    });

    // Mock readMemberPackageInfo by mocking the workspace-crossings module
    // We need to inject the package map. The real readMemberPackageInfo reads
    // from disk, so we mock it.
    const { buildPackageMap } = await import("../../../src/analyzers/workspace-crossings.js");

    // Provide a custom readInfo function that returns package names
    vi.mock("../../../src/analyzers/workspace-crossings.js", async (importOriginal) => {
      const actual = await importOriginal() as Record<string, unknown>;
      return {
        ...actual,
        buildPackageMap: (members: SubAnalysis[]) => {
          // Call original but with a custom readInfo
          return (actual.buildPackageMap as typeof buildPackageMap)(members, (member) => {
            if (member.id === "packages-foundation") {
              return { name: "@test/foundation", entryFile: "src/public.ts" };
            }
            if (member.id === "packages-consumer") {
              return { name: "@test/consumer", entryFile: "src/agent.ts" };
            }
            return null;
          });
        },
      };
    });

    // Root-level analysis has no files of its own (all are sub-analyzed)
    const rootInventory = makeInventory([]);
    const rootImports = makeImports([]);

    const { zones: result } = await analyzeZones(rootInventory, rootImports, {
      enrich: false,
      subAnalyses: [foundation, consumer],
    });

    // Verify promoted zones exist
    const promotedZoneIds = result.zones.map((z) => z.id);
    expect(promotedZoneIds).toContain("packages-foundation:core");
    expect(promotedZoneIds).toContain("packages-consumer:agent");

    // Verify cross-package crossing was computed
    const crossPackageCrossings = result.crossings.filter(
      (c) =>
        c.fromZone.startsWith("packages-consumer") &&
        c.toZone.startsWith("packages-foundation"),
    );
    expect(crossPackageCrossings.length).toBeGreaterThan(0);

    // The crossing should be from consumer's agent.ts to foundation's public.ts
    const crossing = crossPackageCrossings[0];
    expect(crossing.from).toBe("packages/consumer/src/agent.ts");
    expect(crossing.to).toBe("packages/foundation/src/public.ts");
    expect(crossing.fromZone).toBe("packages-consumer:agent");
    expect(crossing.toZone).toBe("packages-foundation:core");

    vi.restoreAllMocks();
  });

  it("produces no cross-package crossings when there are no sub-analyses", async () => {
    // Simple single-repo scenario with no sub-analyses
    const files = [
      makeFileEntry("src/a.ts"),
      makeFileEntry("src/b.ts"),
      makeFileEntry("src/c.ts"),
    ];
    const inventory = makeInventory(files);
    const imports = makeImports([
      makeEdge("src/a.ts", "src/b.ts"),
      makeEdge("src/b.ts", "src/c.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, {
      enrich: false,
    });

    // Should have zones but no cross-package crossings
    expect(result.zones.length).toBeGreaterThan(0);
    // All crossings (if any) should be between root-level zones, not cross-package
    for (const c of result.crossings) {
      expect(c.fromZone).not.toContain(":");
      expect(c.toZone).not.toContain(":");
    }
  });
});
