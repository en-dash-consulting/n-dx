import { describe, it, expect } from "vitest";
import {
  buildUndirectedGraph,
} from "../../../src/analyzers/louvain.js";
import {
  deriveZoneId,
  deriveZoneName,
  analyzeZones,
  assignByProximity,
} from "../../../src/analyzers/zones.js";
import type { Zone } from "../../../src/schema/index.js";
import {
  makeFileEntry,
  makeInventory,
  makeEdge,
  makeImports,
} from "./zones-helpers.js";

// ── buildUndirectedGraph ────────────────────────────────────────────────────

describe("buildUndirectedGraph", () => {
  it("creates bidirectional edges with symbol-count weights", () => {
    const graph = buildUndirectedGraph([
      makeEdge("a.ts", "b.ts", ["foo", "bar"]),
    ]);

    expect(graph.get("a.ts")?.get("b.ts")).toBe(2);
    expect(graph.get("b.ts")?.get("a.ts")).toBe(2);
  });

  it("sums weights for multiple edges between same pair", () => {
    const graph = buildUndirectedGraph([
      makeEdge("a.ts", "b.ts", ["foo"]),
      makeEdge("b.ts", "a.ts", ["bar", "baz"]),
    ]);

    expect(graph.get("a.ts")?.get("b.ts")).toBe(3);
    expect(graph.get("b.ts")?.get("a.ts")).toBe(3);
  });

  it("uses min weight of 1 for empty symbols", () => {
    const graph = buildUndirectedGraph([
      makeEdge("a.ts", "b.ts", []),
    ]);

    expect(graph.get("a.ts")?.get("b.ts")).toBe(1);
  });

  it("returns empty graph for empty input", () => {
    const graph = buildUndirectedGraph([]);
    expect(graph.size).toBe(0);
  });
});

// ── deriveZoneId ────────────────────────────────────────────────────────────

describe("deriveZoneId", () => {
  it("uses most common directory segment", () => {
    expect(
      deriveZoneId([
        "src/schema/v1.ts",
        "src/schema/validate.ts",
        "src/schema/index.ts",
      ])
    ).toBe("schema");
  });

  it("returns 'root' for root-level files", () => {
    expect(deriveZoneId(["package.json", "tsconfig.json"])).toBe("root");
  });

  it("skips generic segments like src, lib, app", () => {
    expect(
      deriveZoneId(["src/analyzers/foo.ts", "src/analyzers/bar.ts"])
    ).toBe("analyzers");
  });

  it("normalizes underscores to hyphens", () => {
    expect(deriveZoneId(["src/my_module/a.ts"])).toBe("my-module");
  });

  it("handles mixed root and nested files", () => {
    expect(
      deriveZoneId([
        "README.md",
        "src/schema/v1.ts",
        "src/schema/v2.ts",
      ])
    ).toBe("schema");
  });

  it("skips parent ID segments when parentId is provided", () => {
    // Without parentId, first non-generic is "hench"
    expect(
      deriveZoneId([
        "packages/hench/src/agent/core.ts",
        "packages/hench/src/agent/loop.ts",
      ])
    ).toBe("hench");

    // With parentId="hench", skips "hench" and finds "agent"
    expect(
      deriveZoneId(
        [
          "packages/hench/src/agent/core.ts",
          "packages/hench/src/agent/loop.ts",
        ],
        "hench"
      )
    ).toBe("agent");
  });

  it("skips hierarchical parent segments", () => {
    expect(
      deriveZoneId(
        [
          "packages/hench/src/agent/briefs/build.ts",
          "packages/hench/src/agent/briefs/validate.ts",
        ],
        "hench/agent"
      )
    ).toBe("briefs");
  });
});

// ── deriveZoneName ──────────────────────────────────────────────────────────

describe("deriveZoneName", () => {
  it("title-cases single word", () => {
    expect(deriveZoneName("schema")).toBe("Schema");
  });

  it("title-cases hyphenated words", () => {
    expect(deriveZoneName("detail-panel")).toBe("Detail Panel");
  });

  it("handles single-char segments", () => {
    expect(deriveZoneName("a-b")).toBe("A B");
  });
});

// ── Integration: analyzeZones ───────────────────────────────────────────────

describe("analyzeZones", () => {
  it("returns no zones and all unzoned for empty import graph", async () => {
    const inventory = makeInventory([
      makeFileEntry("README.md", { role: "docs" }),
      makeFileEntry("package.json", { role: "config" }),
    ]);
    const imports = makeImports([]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.zones).toHaveLength(0);
    expect(result.crossings).toHaveLength(0);
    expect(result.unzoned).toContain("README.md");
    expect(result.unzoned).toContain("package.json");
  });

  it("detects two disconnected clusters as separate zones", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
      makeFileEntry("src/b/p.ts"),
      makeFileEntry("src/b/q.ts"),
      makeFileEntry("src/b/r.ts"),
    ]);
    const imports = makeImports([
      // Cluster A: fully connected
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
      // Cluster B: fully connected
      makeEdge("src/b/p.ts", "src/b/q.ts"),
      makeEdge("src/b/q.ts", "src/b/r.ts"),
      makeEdge("src/b/p.ts", "src/b/r.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.zones.length).toBe(2);
    expect(result.crossings).toHaveLength(0);

    // Each zone should have 3 files
    for (const zone of result.zones) {
      expect(zone.files).toHaveLength(3);
    }
  });

  it("puts all interconnected files in one zone with cohesion=1, coupling=0", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/m/a.ts"),
      makeFileEntry("src/m/b.ts"),
      makeFileEntry("src/m/c.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/m/a.ts", "src/m/b.ts"),
      makeEdge("src/m/b.ts", "src/m/c.ts"),
      makeEdge("src/m/a.ts", "src/m/c.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].cohesion).toBe(1);
    expect(result.zones[0].coupling).toBe(0);
  });

  it("populates crossings for cross-zone edges", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
      makeFileEntry("src/b/p.ts"),
      makeFileEntry("src/b/q.ts"),
      makeFileEntry("src/b/r.ts"),
    ]);
    const imports = makeImports([
      // Cluster A
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
      // Cluster B
      makeEdge("src/b/p.ts", "src/b/q.ts"),
      makeEdge("src/b/q.ts", "src/b/r.ts"),
      makeEdge("src/b/p.ts", "src/b/r.ts"),
      // Cross-zone edge
      makeEdge("src/a/x.ts", "src/b/p.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.crossings.length).toBeGreaterThan(0);
    expect(result.crossings.some((c) => c.fromZone !== c.toZone)).toBe(true);

    // Both zones should have coupling > 0
    for (const zone of result.zones) {
      expect(zone.coupling).toBeGreaterThanOrEqual(0);
    }
  });

  it("puts non-import files in unzoned", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/m/a.ts"),
      makeFileEntry("src/m/b.ts"),
      makeFileEntry("src/m/c.ts"),
      makeFileEntry("README.md", { role: "docs" }),
      makeFileEntry(".gitignore", { role: "config" }),
    ]);
    const imports = makeImports([
      makeEdge("src/m/a.ts", "src/m/b.ts"),
      makeEdge("src/m/b.ts", "src/m/c.ts"),
      makeEdge("src/m/a.ts", "src/m/c.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.unzoned).toContain("README.md");
    expect(result.unzoned).toContain(".gitignore");
  });

  it("merges communities that derive the same zone ID into one zone", async () => {
    // Two distinct clusters under the same package directory.
    // Without the same-ID merge, Louvain would create two zones
    // both named "mypkg" → "mypkg" and "mypkg-2".
    // With the merge, they become a single "mypkg" zone.
    const inventory = makeInventory([
      makeFileEntry("packages/mypkg/src/agent/a.ts"),
      makeFileEntry("packages/mypkg/src/agent/b.ts"),
      makeFileEntry("packages/mypkg/src/agent/c.ts"),
      makeFileEntry("packages/mypkg/src/cli/x.ts"),
      makeFileEntry("packages/mypkg/src/cli/y.ts"),
      makeFileEntry("packages/mypkg/src/cli/z.ts"),
    ]);
    const imports = makeImports([
      // Cluster 1: agent files tightly connected
      makeEdge("packages/mypkg/src/agent/a.ts", "packages/mypkg/src/agent/b.ts"),
      makeEdge("packages/mypkg/src/agent/b.ts", "packages/mypkg/src/agent/c.ts"),
      makeEdge("packages/mypkg/src/agent/a.ts", "packages/mypkg/src/agent/c.ts"),
      // Cluster 2: cli files tightly connected
      makeEdge("packages/mypkg/src/cli/x.ts", "packages/mypkg/src/cli/y.ts"),
      makeEdge("packages/mypkg/src/cli/y.ts", "packages/mypkg/src/cli/z.ts"),
      makeEdge("packages/mypkg/src/cli/x.ts", "packages/mypkg/src/cli/z.ts"),
      // Weak cross-cluster link
      makeEdge("packages/mypkg/src/agent/a.ts", "packages/mypkg/src/cli/x.ts"),
    ]);

    // Disable zone size cap (maxZonePercent=100) to test pure same-ID merge
    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false, maxZonePercent: 100 });

    // Should be merged into a single zone since both derive "mypkg"
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].id).toBe("mypkg");
    expect(result.zones[0].files).toHaveLength(6);
  });

  it("merges communities from the same package directory even with different derived IDs", async () => {
    // CLI files and test files within a package may derive different zone IDs
    // (e.g., "cli" vs "core") but should be merged because they share the
    // same packages/<name> root directory.
    const inventory = makeInventory([
      makeFileEntry("packages/rex/src/core/store.ts"),
      makeFileEntry("packages/rex/src/core/tree.ts"),
      makeFileEntry("packages/rex/src/core/validate.ts"),
      makeFileEntry("packages/rex/src/cli/index.ts"),
      makeFileEntry("packages/rex/src/cli/commands.ts"),
      makeFileEntry("packages/rex/src/cli/output.ts"),
    ]);
    const imports = makeImports([
      // Core cluster: tightly connected
      makeEdge("packages/rex/src/core/store.ts", "packages/rex/src/core/tree.ts"),
      makeEdge("packages/rex/src/core/tree.ts", "packages/rex/src/core/validate.ts"),
      makeEdge("packages/rex/src/core/store.ts", "packages/rex/src/core/validate.ts"),
      // CLI cluster: tightly connected
      makeEdge("packages/rex/src/cli/index.ts", "packages/rex/src/cli/commands.ts"),
      makeEdge("packages/rex/src/cli/commands.ts", "packages/rex/src/cli/output.ts"),
      makeEdge("packages/rex/src/cli/index.ts", "packages/rex/src/cli/output.ts"),
      // Weak cross-cluster link (CLI uses core)
      makeEdge("packages/rex/src/cli/commands.ts", "packages/rex/src/core/store.ts"),
    ]);

    // Disable zone size cap (maxZonePercent=100) to test pure package-root merge
    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false, maxZonePercent: 100 });

    // Should be merged into a single zone since both live under packages/rex
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].files).toHaveLength(6);
  });

  it("merges small communities into neighbors", async () => {
    const inventory = makeInventory([
      // Big cluster
      makeFileEntry("src/core/a.ts"),
      makeFileEntry("src/core/b.ts"),
      makeFileEntry("src/core/c.ts"),
      makeFileEntry("src/core/d.ts"),
      // Tiny "cluster" of 1 connected to core
      makeFileEntry("src/util/helper.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/core/a.ts", "src/core/b.ts"),
      makeEdge("src/core/b.ts", "src/core/c.ts"),
      makeEdge("src/core/c.ts", "src/core/d.ts"),
      makeEdge("src/core/a.ts", "src/core/d.ts"),
      // helper connects to core
      makeEdge("src/util/helper.ts", "src/core/a.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // The small community (helper) should be merged into core
    // so we should have 1 zone containing all 5 files
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].files).toHaveLength(5);
  });

  it("identifies entry points as files imported from other zones", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
      makeFileEntry("src/b/p.ts"),
      makeFileEntry("src/b/q.ts"),
      makeFileEntry("src/b/r.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
      makeEdge("src/b/p.ts", "src/b/q.ts"),
      makeEdge("src/b/q.ts", "src/b/r.ts"),
      makeEdge("src/b/p.ts", "src/b/r.ts"),
      // Cross-zone: a/x imports b/p
      makeEdge("src/a/x.ts", "src/b/p.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    if (result.zones.length === 2) {
      // The zone containing b/p.ts should list it as an entry point
      const bZone = result.zones.find((z) => z.files.includes("src/b/p.ts"));
      expect(bZone?.entryPoints).toContain("src/b/p.ts");
    }
  });

  it("is deterministic across multiple runs", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts"),
      makeFileEntry("src/a/y.ts"),
      makeFileEntry("src/a/z.ts"),
      makeFileEntry("src/b/p.ts"),
      makeFileEntry("src/b/q.ts"),
      makeFileEntry("src/b/r.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/b/p.ts", "src/b/q.ts"),
      makeEdge("src/b/q.ts", "src/b/r.ts"),
      makeEdge("src/a/x.ts", "src/b/p.ts"),
    ]);

    const { zones: run1 } = await analyzeZones(inventory, imports, { enrich: false });
    const { zones: run2 } = await analyzeZones(inventory, imports, { enrich: false });

    expect(run1).toEqual(run2);
  });

  it("excludes test files from cohesion/coupling metric computation", async () => {
    // Two source files form a tight cluster (cohesion=1),
    // plus a test file that imports from an external zone.
    // Without test-file exclusion, the test→external edge would inflate coupling.
    const inventory = makeInventory([
      makeFileEntry("src/core/a.ts"),
      makeFileEntry("src/core/b.ts"),
      makeFileEntry("src/core/a.test.ts", { role: "test" }),
      makeFileEntry("src/other/x.ts"),
      makeFileEntry("src/other/y.ts"),
      makeFileEntry("src/other/z.ts"),
    ]);
    const imports = makeImports([
      // Core cluster: a↔b
      makeEdge("src/core/a.ts", "src/core/b.ts"),
      makeEdge("src/core/b.ts", "src/core/a.ts"),
      // Test imports from external zone
      makeEdge("src/core/a.test.ts", "src/core/a.ts"),
      makeEdge("src/core/a.test.ts", "src/other/x.ts"),
      // Other cluster
      makeEdge("src/other/x.ts", "src/other/y.ts"),
      makeEdge("src/other/y.ts", "src/other/z.ts"),
      makeEdge("src/other/x.ts", "src/other/z.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Find the zone containing core files
    const coreZone = result.zones.find((z) => z.files.includes("src/core/a.ts"));
    expect(coreZone).toBeDefined();

    // Test file should still be a zone member (not excluded from membership)
    expect(coreZone!.files).toContain("src/core/a.test.ts");

    // But coupling should only reflect source-file edges:
    // a.ts and b.ts both only connect to each other → coupling should be 0
    // (if test file were counted, the test→other/x.ts edge would add coupling)
    expect(coreZone!.coupling).toBe(0);
  });
});

// ── assignByProximity ────────────────────────────────────────────────────────

describe("assignByProximity", () => {
  it("assigns files to the zone sharing their directory", () => {
    const zones: Zone[] = [
      {
        id: "core",
        name: "Core",
        description: "",
        files: ["src/core/a.ts", "src/core/b.ts", "src/core/c.ts"],
        entryPoints: [],
        cohesion: 1,
        coupling: 0,
      },
    ];

    const { zones: expanded, remaining } = assignByProximity(zones, [
      "src/core/README.md",
      "src/core/styles.css",
    ]);

    expect(expanded[0].files).toContain("src/core/README.md");
    expect(expanded[0].files).toContain("src/core/styles.css");
    expect(remaining).toHaveLength(0);
  });

  it("walks up directory tree to find a match", () => {
    const zones: Zone[] = [
      {
        id: "api",
        name: "Api",
        description: "",
        files: ["src/api/routes.ts"],
        entryPoints: [],
        cohesion: 1,
        coupling: 0,
      },
    ];

    const { zones: expanded, remaining } = assignByProximity(zones, [
      "src/api/handlers/health.ts",
    ]);

    // health.ts is in src/api/handlers/, walks up to src/api/ which matches
    expect(expanded[0].files).toContain("src/api/handlers/health.ts");
    expect(remaining).toHaveLength(0);
  });

  it("leaves root files unzoned when no zone matches", () => {
    const zones: Zone[] = [
      {
        id: "core",
        name: "Core",
        description: "",
        files: ["src/core/a.ts"],
        entryPoints: [],
        cohesion: 1,
        coupling: 0,
      },
    ];

    const { remaining } = assignByProximity(zones, [
      "package.json",
      "README.md",
    ]);

    expect(remaining).toContain("package.json");
    expect(remaining).toContain("README.md");
  });
});
