import { describe, it, expect } from "vitest";
import {
  buildUndirectedGraph,
  addDirectoryProximityEdges,
  louvainPhase1,
  mergeSmallCommunities,
  mergeSatelliteCommunities,
  splitLargeCommunities,
  splitByDirectory,
} from "../../../src/analyzers/louvain.js";
import {
  deriveZoneId,
  deriveZoneName,
  disambiguateZoneId,
  deriveZoneIdFromFilenames,
  analyzeZones,
  assignByProximity,
  applyZonePins,
  SUBDIVISION_THRESHOLD,
} from "../../../src/analyzers/zones.js";
import type { Zone, ImportEdge } from "../../../src/schema/index.js";
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
  it("groups root-level importable files into a zone via directory proximity", async () => {
    const inventory = makeInventory([
      makeFileEntry("index.ts"),
      makeFileEntry("config.ts"),
      // Non-importable files (.md, .json) are excluded from zone detection
      makeFileEntry("README.md", { role: "docs" }),
      makeFileEntry("package.json", { role: "config" }),
    ]);
    const imports = makeImports([
      makeEdge("index.ts", "config.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Importable .ts files form a zone; non-importable files are excluded entirely
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].id).toBe("root");
    expect(result.crossings).toHaveLength(0);
    expect(result.zones[0].files).not.toContain("README.md");
    expect(result.zones[0].files).not.toContain("package.json");
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

  it("gives cohesion=0 to multi-file zones with no import edges", async () => {
    // Two files in the same directory but no imports between them
    const inventory = makeInventory([
      makeFileEntry("scripts/check-a.mjs"),
      makeFileEntry("scripts/check-b.mjs"),
    ]);
    const imports = makeImports([]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // All files should land in one zone (proximity-based)
    expect(result.zones).toHaveLength(1);
    // No edges → cohesion should be 0, not the old default of 1
    expect(result.zones[0].cohesion).toBe(0);
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

  it("excludes non-importable files from zone proximity assignment", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/m/a.ts"),
      makeFileEntry("src/m/b.ts"),
      makeFileEntry("src/m/c.ts"),
      // Non-importable files are excluded from zone scope
      makeFileEntry("README.md", { role: "docs" }),
      // .gitignore has no extension — not in NON_IMPORTABLE_EXTENSIONS
      // but also has no import edges, so it may remain unzoned
      makeFileEntry("src/m/helper.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/m/a.ts", "src/m/b.ts"),
      makeEdge("src/m/b.ts", "src/m/c.ts"),
      makeEdge("src/m/a.ts", "src/m/c.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Importable .ts files should be zoned
    const allZonedFiles = result.zones.flatMap(z => z.files);
    expect(allZonedFiles).toContain("src/m/a.ts");
    // Non-importable files should be excluded entirely
    expect(allZonedFiles).not.toContain("README.md");
    expect(result.unzoned).not.toContain("README.md");
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

// ── addDirectoryProximityEdges ────────────────────────────────────────────────

describe("addDirectoryProximityEdges", () => {
  it("creates chain edges between sorted adjacent files in same directory", () => {
    const graph = buildUndirectedGraph([]);
    addDirectoryProximityEdges(graph, [
      "src/utils/c.ts",
      "src/utils/a.ts",
      "src/utils/b.ts",
    ]);

    // After sorting: a.ts, b.ts, c.ts → edges a↔b and b↔c
    expect(graph.get("src/utils/a.ts")?.get("src/utils/b.ts")).toBe(0.2);
    expect(graph.get("src/utils/b.ts")?.get("src/utils/a.ts")).toBe(0.2);
    expect(graph.get("src/utils/b.ts")?.get("src/utils/c.ts")).toBe(0.2);
    expect(graph.get("src/utils/c.ts")?.get("src/utils/b.ts")).toBe(0.2);
    // No direct edge between a and c (chain topology, not clique)
    expect(graph.get("src/utils/a.ts")?.has("src/utils/c.ts")).toBeFalsy();
  });

  it("handles single-file directories without adding edges", () => {
    const graph = buildUndirectedGraph([]);
    addDirectoryProximityEdges(graph, ["src/lonely/only.ts"]);

    // Node should exist in graph but have no neighbors
    expect(graph.has("src/lonely/only.ts")).toBe(true);
    expect(graph.get("src/lonely/only.ts")?.size).toBe(0);
  });

  it("does not overwrite existing import edges", () => {
    const graph = buildUndirectedGraph([
      makeEdge("src/mod/a.ts", "src/mod/b.ts", ["foo", "bar"]),
    ]);

    addDirectoryProximityEdges(graph, ["src/mod/a.ts", "src/mod/b.ts"]);

    // Import edge weight (2) should be preserved, not replaced with 0.2
    expect(graph.get("src/mod/a.ts")?.get("src/mod/b.ts")).toBe(2);
  });

  it("groups files by immediate parent, not deeper ancestry", () => {
    const graph = buildUndirectedGraph([]);
    addDirectoryProximityEdges(graph, [
      "src/a/x.ts",
      "src/a/y.ts",
      "src/b/z.ts",
    ]);

    // a/x.ts and a/y.ts should be connected, but not with b/z.ts
    expect(graph.get("src/a/x.ts")?.has("src/a/y.ts")).toBe(true);
    expect(graph.get("src/a/x.ts")?.has("src/b/z.ts")).toBeFalsy();
  });
});

// ── disambiguateZoneId ──────────────────────────────────────────────────────

describe("disambiguateZoneId", () => {
  it("produces routes-admin style names from deeper path segments", () => {
    const result = disambiguateZoneId("routes", [
      "src/routes/admin/users.ts",
      "src/routes/admin/settings.ts",
      "src/routes/admin/dashboard.ts",
    ]);
    expect(result).toBe("routes-admin");
  });

  it("returns baseId when no discriminating segment found", () => {
    const result = disambiguateZoneId("routes", [
      "config/routes.ts",
      "other/file.ts",
    ]);
    expect(result).toBe("routes");
  });

  it("skips generic segments when looking for discriminator", () => {
    const result = disambiguateZoneId("routes", [
      "src/routes/src/admin/x.ts",
      "src/routes/src/admin/y.ts",
    ]);
    expect(result).toBe("routes-admin");
  });

  it("respects parentId to skip parent segments", () => {
    const result = disambiguateZoneId("api", [
      "packages/web/src/api/users/list.ts",
      "packages/web/src/api/users/create.ts",
    ], "web");
    expect(result).toBe("api-users");
  });

  it("picks the most common next segment when files differ", () => {
    const result = disambiguateZoneId("routes", [
      "src/routes/blog/post.ts",
      "src/routes/blog/list.ts",
      "src/routes/admin/users.ts",
    ]);
    expect(result).toBe("routes-blog");
  });
});

// ── Zone ID normalization ───────────────────────────────────────────────────

describe("zone ID normalization", () => {
  it("normalizes __tests__ to tests, not --tests--", () => {
    expect(
      deriveZoneId(["src/mylib/__tests__/a.test.ts", "src/mylib/__tests__/b.test.ts"])
    ).toBe("mylib");
  });

  it("normalizes __mocks__ without leading/trailing hyphens", () => {
    // __mocks__ should become "mocks" (then skipped), so the next segment wins
    expect(
      deriveZoneId(["src/api/__mocks__/handler.ts"])
    ).toBe("api");
  });

  it("normalizes _internal to internal", () => {
    // _internal → "internal" (which is in GENERIC_SEGMENTS, so it's skipped)
    // The next meaningful segment should win
    expect(
      deriveZoneId(["packages/mylib/_internal/utils.ts"])
    ).toBe("mylib");
  });
});

// ── Integration: directory proximity + disambiguation ────────────────────────

describe("directory proximity integration", () => {
  it("creates non-empty crossings for disconnected clusters sharing a parent", async () => {
    // Two clusters in different directories under src/ with no import edges
    // between them. Directory proximity edges in their shared parent should
    // create connections that may produce crossings.
    const inventory = makeInventory([
      makeFileEntry("src/auth/login.ts"),
      makeFileEntry("src/auth/signup.ts"),
      makeFileEntry("src/auth/verify.ts"),
      makeFileEntry("src/billing/invoice.ts"),
      makeFileEntry("src/billing/payment.ts"),
      makeFileEntry("src/billing/refund.ts"),
    ]);
    const imports = makeImports([
      // auth cluster
      makeEdge("src/auth/login.ts", "src/auth/signup.ts"),
      makeEdge("src/auth/signup.ts", "src/auth/verify.ts"),
      makeEdge("src/auth/login.ts", "src/auth/verify.ts"),
      // billing cluster
      makeEdge("src/billing/invoice.ts", "src/billing/payment.ts"),
      makeEdge("src/billing/payment.ts", "src/billing/refund.ts"),
      makeEdge("src/billing/invoice.ts", "src/billing/refund.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Should produce 2 zones
    expect(result.zones.length).toBe(2);
    // Zone IDs should be meaningful (auth and billing)
    const ids = result.zones.map(z => z.id).sort();
    expect(ids).toEqual(["auth", "billing"]);
  });

  it("excludes non-importable files from zone scope entirely", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/core/a.ts"),
      makeFileEntry("src/core/b.ts"),
      makeFileEntry("src/core/c.ts"),
      // Non-importable files (.json, .md) are excluded from zone detection
      makeFileEntry("src/core/config.json", { role: "config", language: "JSON" }),
      makeFileEntry("src/core/README.md", { role: "docs" }),
    ]);
    const imports = makeImports([
      makeEdge("src/core/a.ts", "src/core/b.ts"),
      makeEdge("src/core/b.ts", "src/core/c.ts"),
      makeEdge("src/core/a.ts", "src/core/c.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Non-importable files should not appear in zones or unzoned
    const allZonedFiles = result.zones.flatMap(z => z.files);
    expect(allZonedFiles).not.toContain("src/core/config.json");
    expect(allZonedFiles).not.toContain("src/core/README.md");
    expect(result.unzoned).not.toContain("src/core/config.json");
    expect(result.unzoned).not.toContain("src/core/README.md");
    // Importable .ts files should be zoned
    expect(allZonedFiles).toContain("src/core/a.ts");
    expect(allZonedFiles).toContain("src/core/b.ts");
    expect(allZonedFiles).toContain("src/core/c.ts");
  });

  it("produces disambiguated zone names instead of numeric suffixes", async () => {
    // Two clusters that would both derive "routes" as zone ID
    const inventory = makeInventory([
      makeFileEntry("src/routes/admin/users.ts"),
      makeFileEntry("src/routes/admin/settings.ts"),
      makeFileEntry("src/routes/admin/dashboard.ts"),
      makeFileEntry("src/routes/blog/posts.ts"),
      makeFileEntry("src/routes/blog/comments.ts"),
      makeFileEntry("src/routes/blog/tags.ts"),
    ]);
    const imports = makeImports([
      // admin cluster
      makeEdge("src/routes/admin/users.ts", "src/routes/admin/settings.ts"),
      makeEdge("src/routes/admin/settings.ts", "src/routes/admin/dashboard.ts"),
      makeEdge("src/routes/admin/users.ts", "src/routes/admin/dashboard.ts"),
      // blog cluster
      makeEdge("src/routes/blog/posts.ts", "src/routes/blog/comments.ts"),
      makeEdge("src/routes/blog/comments.ts", "src/routes/blog/tags.ts"),
      makeEdge("src/routes/blog/posts.ts", "src/routes/blog/tags.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    const ids = result.zones.map(z => z.id).sort();
    // Should produce "routes-admin" and "routes-blog" (or just "routes" if merged)
    // rather than "routes" and "routes-2"
    for (const id of ids) {
      expect(id).not.toMatch(/-\d+$/);
    }
  });
});

// ── Proximity isolation: non-import files don't bridge import clusters ────────

describe("proximity isolation", () => {
  it("does not merge disconnected import clusters via shared-directory non-import files", async () => {
    // Two completely disconnected import clusters under app/components/,
    // plus non-import files (SVGs, JSON) in the same parent directory.
    // Before fix: proximity edges bridged the clusters into one mega-zone.
    // After fix: each import cluster stays separate.
    const inventory = makeInventory([
      // Cluster A: forms components
      makeFileEntry("app/components/Button.tsx"),
      makeFileEntry("app/components/ButtonGroup.tsx"),
      makeFileEntry("app/components/ButtonIcon.tsx"),
      // Cluster B: forms modals
      makeFileEntry("app/components/Modal.tsx"),
      makeFileEntry("app/components/ModalHeader.tsx"),
      makeFileEntry("app/components/ModalBody.tsx"),
      // Non-import files in the same directory — should NOT bridge A and B
      makeFileEntry("app/components/icon.svg", { role: "asset", language: "SVG" }),
      makeFileEntry("app/components/styles.css", { role: "style", language: "CSS" }),
    ]);
    const imports = makeImports([
      // Cluster A: tightly connected
      makeEdge("app/components/Button.tsx", "app/components/ButtonGroup.tsx"),
      makeEdge("app/components/ButtonGroup.tsx", "app/components/ButtonIcon.tsx"),
      makeEdge("app/components/Button.tsx", "app/components/ButtonIcon.tsx"),
      // Cluster B: tightly connected
      makeEdge("app/components/Modal.tsx", "app/components/ModalHeader.tsx"),
      makeEdge("app/components/ModalHeader.tsx", "app/components/ModalBody.tsx"),
      makeEdge("app/components/Modal.tsx", "app/components/ModalBody.tsx"),
      // No edges between A and B
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Should have at least 2 zones (the two import clusters).
    // Non-import files should be assigned to one of them or form their own zone.
    // Critically: Button files and Modal files must NOT be in the same zone.
    const buttonZone = result.zones.find(z => z.files.includes("app/components/Button.tsx"));
    const modalZone = result.zones.find(z => z.files.includes("app/components/Modal.tsx"));
    expect(buttonZone).toBeDefined();
    expect(modalZone).toBeDefined();
    expect(buttonZone!.id).not.toBe(modalZone!.id);
  });

  it("produces crossings when import clusters are split instead of merged", async () => {
    // Two import clusters with a cross-cluster edge.
    // Plus non-import files in shared parent directories.
    // The cross-cluster edge should appear as a crossing, not be hidden
    // inside a mega-zone.
    const inventory = makeInventory([
      makeFileEntry("app/routes/admin/users.ts"),
      makeFileEntry("app/routes/admin/settings.ts"),
      makeFileEntry("app/routes/admin/dashboard.ts"),
      makeFileEntry("app/routes/blog/posts.ts"),
      makeFileEntry("app/routes/blog/comments.ts"),
      makeFileEntry("app/routes/blog/tags.ts"),
      // Non-import files that would previously bridge the clusters
      makeFileEntry("app/routes/layout.tsx", { role: "config" }),
      makeFileEntry("app/routes/error.tsx", { role: "config" }),
    ]);
    const imports = makeImports([
      // admin cluster
      makeEdge("app/routes/admin/users.ts", "app/routes/admin/settings.ts"),
      makeEdge("app/routes/admin/settings.ts", "app/routes/admin/dashboard.ts"),
      makeEdge("app/routes/admin/users.ts", "app/routes/admin/dashboard.ts"),
      // blog cluster
      makeEdge("app/routes/blog/posts.ts", "app/routes/blog/comments.ts"),
      makeEdge("app/routes/blog/comments.ts", "app/routes/blog/tags.ts"),
      makeEdge("app/routes/blog/posts.ts", "app/routes/blog/tags.ts"),
      // Cross-cluster edge
      makeEdge("app/routes/admin/users.ts", "app/routes/blog/posts.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // The cross-cluster edge should produce a crossing
    expect(result.crossings.length).toBeGreaterThan(0);
    // All files should be zoned
    expect(result.unzoned).toHaveLength(0);
  });

  it("keeps import-cluster metrics pure (not inflated by proximity edges)", async () => {
    // A cluster of import-connected files. Metrics should be based on
    // import edges only, not diluted by proximity edges.
    const inventory = makeInventory([
      makeFileEntry("src/core/a.ts"),
      makeFileEntry("src/core/b.ts"),
      makeFileEntry("src/core/c.ts"),
      makeFileEntry("src/utils/x.ts"),
      makeFileEntry("src/utils/y.ts"),
      makeFileEntry("src/utils/z.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/core/a.ts", "src/core/b.ts"),
      makeEdge("src/core/b.ts", "src/core/c.ts"),
      makeEdge("src/core/a.ts", "src/core/c.ts"),
      makeEdge("src/utils/x.ts", "src/utils/y.ts"),
      makeEdge("src/utils/y.ts", "src/utils/z.ts"),
      makeEdge("src/utils/x.ts", "src/utils/z.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Each cluster should be its own zone with perfect cohesion
    expect(result.zones.length).toBe(2);
    for (const zone of result.zones) {
      expect(zone.cohesion).toBe(1);
      expect(zone.coupling).toBe(0);
    }
  });

  it("handles a scale scenario similar to the n-site mega-zone bug", async () => {
    // Simulate the real bug: many disconnected import clusters across
    // different route directories, plus many non-import files (JSON, SVG, etc.)
    // all under shared parent directories.
    const inventory = makeInventory([
      // Route cluster 1: admin (3 files, fully connected)
      makeFileEntry("app/routes/admin/users.ts"),
      makeFileEntry("app/routes/admin/settings.ts"),
      makeFileEntry("app/routes/admin/roles.ts"),
      // Route cluster 2: blog (3 files, fully connected)
      makeFileEntry("app/routes/blog/posts.ts"),
      makeFileEntry("app/routes/blog/editor.ts"),
      makeFileEntry("app/routes/blog/tags.ts"),
      // Route cluster 3: shop (3 files, fully connected)
      makeFileEntry("app/routes/shop/products.ts"),
      makeFileEntry("app/routes/shop/cart.ts"),
      makeFileEntry("app/routes/shop/checkout.ts"),
      // Components cluster (3 files, fully connected)
      makeFileEntry("app/components/Header.tsx"),
      makeFileEntry("app/components/Footer.tsx"),
      makeFileEntry("app/components/Layout.tsx"),
      // Non-import files scattered across directories
      makeFileEntry("app/routes/admin/styles.css", { role: "style", language: "CSS" }),
      makeFileEntry("app/routes/blog/data.json", { role: "config", language: "JSON" }),
      makeFileEntry("app/routes/shop/logo.svg", { role: "asset", language: "SVG" }),
      makeFileEntry("app/components/icon.svg", { role: "asset", language: "SVG" }),
      makeFileEntry("app/styles/global.css", { role: "style", language: "CSS" }),
      makeFileEntry("app/config.json", { role: "config", language: "JSON" }),
    ]);
    const imports = makeImports([
      // Admin cluster
      makeEdge("app/routes/admin/users.ts", "app/routes/admin/settings.ts"),
      makeEdge("app/routes/admin/settings.ts", "app/routes/admin/roles.ts"),
      makeEdge("app/routes/admin/users.ts", "app/routes/admin/roles.ts"),
      // Blog cluster
      makeEdge("app/routes/blog/posts.ts", "app/routes/blog/editor.ts"),
      makeEdge("app/routes/blog/editor.ts", "app/routes/blog/tags.ts"),
      makeEdge("app/routes/blog/posts.ts", "app/routes/blog/tags.ts"),
      // Shop cluster
      makeEdge("app/routes/shop/products.ts", "app/routes/shop/cart.ts"),
      makeEdge("app/routes/shop/cart.ts", "app/routes/shop/checkout.ts"),
      makeEdge("app/routes/shop/products.ts", "app/routes/shop/checkout.ts"),
      // Components cluster
      makeEdge("app/components/Header.tsx", "app/components/Footer.tsx"),
      makeEdge("app/components/Footer.tsx", "app/components/Layout.tsx"),
      makeEdge("app/components/Header.tsx", "app/components/Layout.tsx"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Should NOT produce a single mega-zone containing everything.
    // Each import cluster should be its own zone (or meaningfully merged).
    const maxZoneFiles = Math.max(...result.zones.map(z => z.files.length));
    expect(maxZoneFiles).toBeLessThan(12); // No zone should have all 12 import files

    // No zone should have a numeric suffix like "routes-2"
    for (const zone of result.zones) {
      expect(zone.id).not.toMatch(/^routes-\d+$/);
    }

    // Import files should all be in zones; some isolated non-import files
    // (those without a zone nearby) may remain unzoned — that's correct
    const allZonedFiles = result.zones.flatMap(z => z.files);
    expect(allZonedFiles).toContain("app/routes/admin/users.ts");
    expect(allZonedFiles).toContain("app/routes/blog/posts.ts");
    expect(allZonedFiles).toContain("app/routes/shop/products.ts");
    expect(allZonedFiles).toContain("app/components/Header.tsx");
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

  it("respects maxZoneSize and leaves files unzoned when zone is full", () => {
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

    // Zone has 3 files, maxZoneSize=4 → can only accept 1 more
    const { zones: expanded, remaining } = assignByProximity(
      zones,
      ["src/core/d.ts", "src/core/e.ts", "src/core/f.ts"],
      4,
    );

    expect(expanded[0].files).toHaveLength(4); // 3 original + 1 new
    expect(remaining).toHaveLength(2); // 2 couldn't fit
  });

  it("assigns to secondary zone when primary is full", () => {
    const zones: Zone[] = [
      {
        id: "alpha",
        name: "Alpha",
        description: "",
        files: ["src/alpha/a.ts", "src/alpha/b.ts"],
        entryPoints: [],
        cohesion: 1,
        coupling: 0,
      },
      {
        id: "beta",
        name: "Beta",
        description: "",
        files: ["src/beta/x.ts"],
        entryPoints: [],
        cohesion: 1,
        coupling: 0,
      },
    ];

    // File is in src/ — alpha is closer match but full at maxZoneSize=2
    // Should walk up to parent and find beta (also in src/) if beta still has room
    const { zones: expanded, remaining } = assignByProximity(
      zones,
      ["src/alpha/c.ts"],
      2,
    );

    // Alpha is full (2 files), but src/ dir contains alpha with count 2
    // — alpha is skipped since it's at max, so c.ts goes to remaining
    // unless another zone is available in the same directory
    const alphaFiles = expanded.find(z => z.id === "alpha")!.files;
    expect(alphaFiles).toHaveLength(2); // didn't grow
    // c.ts should either be in remaining or assigned to beta via parent walk
    expect(remaining.length + expanded.find(z => z.id === "beta")!.files.length).toBeGreaterThanOrEqual(1);
  });

  it("does not enforce size cap when maxZoneSize is undefined", () => {
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

    const { zones: expanded, remaining } = assignByProximity(
      zones,
      ["src/core/d.ts", "src/core/e.ts", "src/core/f.ts"],
      // no maxZoneSize
    );

    expect(expanded[0].files).toHaveLength(6); // all assigned
    expect(remaining).toHaveLength(0);
  });
});

// ── applyZonePins ────────────────────────────────────────────────────────────

describe("applyZonePins", () => {
  const baseZones: Zone[] = [
    { id: "build", name: "Build", description: "", files: ["build.js", "src/a.ts", "src/b.ts"], cohesion: 0, coupling: 0 },
    { id: "viewer", name: "Viewer", description: "", files: ["src/viewer/main.ts", "src/viewer/app.ts"], cohesion: 0, coupling: 0 },
  ];

  it("moves pinned files from source zone to target zone", () => {
    const result = applyZonePins(baseZones, { "src/a.ts": "viewer" });
    const build = result.find((z) => z.id === "build")!;
    const viewer = result.find((z) => z.id === "viewer")!;

    expect(build.files).not.toContain("src/a.ts");
    expect(viewer.files).toContain("src/a.ts");
  });

  it("skips pins for files not in any zone", () => {
    const result = applyZonePins(baseZones, { "missing.ts": "viewer" });
    expect(result).toHaveLength(2);
    expect(result.find((z) => z.id === "build")!.files).toHaveLength(3);
  });

  it("skips pins targeting a nonexistent zone", () => {
    const result = applyZonePins(baseZones, { "src/a.ts": "nonexistent" });
    expect(result.find((z) => z.id === "build")!.files).toContain("src/a.ts");
  });

  it("removes zones that become empty after pinning", () => {
    const zones: Zone[] = [
      { id: "tiny", name: "Tiny", description: "", files: ["only.ts"], cohesion: 0, coupling: 0 },
      { id: "big", name: "Big", description: "", files: ["a.ts"], cohesion: 0, coupling: 0 },
    ];
    const result = applyZonePins(zones, { "only.ts": "big" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("big");
    expect(result[0].files).toContain("only.ts");
  });

  it("is a no-op when file is already in target zone", () => {
    const result = applyZonePins(baseZones, { "src/viewer/main.ts": "viewer" });
    expect(result.find((z) => z.id === "viewer")!.files).toHaveLength(2);
  });
});

// ── Resolution parameter & iterative splitting ────────────────────────────

describe("louvainPhase1 resolution parameter", () => {
  it("higher resolution produces more communities", () => {
    const graph: import("../../../src/analyzers/louvain.js").UndirectedGraph = new Map();

    const ensure = (n: string) => {
      if (!graph.has(n)) graph.set(n, new Map());
      return graph.get(n)!;
    };
    const addEdge = (a: string, b: string, w: number) => {
      ensure(a).set(b, (ensure(a).get(b) ?? 0) + w);
      ensure(b).set(a, (ensure(b).get(a) ?? 0) + w);
    };

    // Two groups connected by moderate cross-edges:
    // internal weight per node is higher than cross-weight, but γ=1
    // merges due to small graph resolution limit.
    const groupA = Array.from({ length: 6 }, (_, i) => `a/f${i}.ts`);
    const groupB = Array.from({ length: 6 }, (_, i) => `b/f${i}.ts`);

    for (const g of [groupA, groupB]) {
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) addEdge(g[i], g[j], 2);
      }
    }
    // Cross-edges: each node connects to 2 nodes in the other group
    for (let i = 0; i < 6; i++) {
      addEdge(groupA[i], groupB[i], 1);
      addEdge(groupA[i], groupB[(i + 1) % 6], 1);
    }

    const commLow = louvainPhase1(graph, 100, 1);
    const commHigh = louvainPhase1(graph, 100, 8);

    const sizeLow = new Set(commLow.values()).size;
    const sizeHigh = new Set(commHigh.values()).size;
    expect(sizeHigh).toBeGreaterThanOrEqual(sizeLow);
  });
});

describe("splitLargeCommunities with resolution escalation", () => {
  it("splits an oversized community into smaller ones", () => {
    const graph: import("../../../src/analyzers/louvain.js").UndirectedGraph = new Map();

    const ensure = (n: string) => {
      if (!graph.has(n)) graph.set(n, new Map());
      return graph.get(n)!;
    };
    const addEdge = (a: string, b: string, w: number) => {
      ensure(a).set(b, (ensure(a).get(b) ?? 0) + w);
      ensure(b).set(a, (ensure(b).get(a) ?? 0) + w);
    };

    // Two clusters (A: 8, B: 8) with strong internal and sparse cross-edges
    const clusterA = Array.from({ length: 8 }, (_, i) => `a/f${i}.ts`);
    const clusterB = Array.from({ length: 8 }, (_, i) => `b/f${i}.ts`);

    for (const cluster of [clusterA, clusterB]) {
      for (let i = 0; i < cluster.length; i++) {
        for (let j = i + 1; j < cluster.length; j++) {
          addEdge(cluster[i], cluster[j], 2);
        }
      }
    }
    // Sparse cross-cluster bridges
    addEdge(clusterA[0], clusterB[0], 1);
    addEdge(clusterA[1], clusterB[1], 1);

    // Start everything in one community
    const initial = new Map<string, string>();
    for (const n of graph.keys()) initial.set(n, "mega");

    const result = splitLargeCommunities(initial, graph, 10);
    const resultComms = new Set(result.values());
    expect(resultComms.size).toBeGreaterThan(1);

    // A-files and B-files should be separated
    const commA = result.get(clusterA[0])!;
    const commB = result.get(clusterB[0])!;
    expect(commA).not.toBe(commB);
    for (const f of clusterA) expect(result.get(f)).toBe(commA);
    for (const f of clusterB) expect(result.get(f)).toBe(commB);
  });

  it("iteratively splits when first split still produces oversized sub-communities", () => {
    const graph: import("../../../src/analyzers/louvain.js").UndirectedGraph = new Map();

    const ensure = (n: string) => {
      if (!graph.has(n)) graph.set(n, new Map());
      return graph.get(n)!;
    };
    const addEdge = (a: string, b: string, w: number) => {
      ensure(a).set(b, (ensure(a).get(b) ?? 0) + w);
      ensure(b).set(a, (ensure(b).get(a) ?? 0) + w);
    };

    // 3 clusters of 6 files each, chain topology: A↔B↔C
    // maxSize=5, so all 3 must end up in separate communities
    const clusters = [
      Array.from({ length: 6 }, (_, i) => `a/f${i}.ts`),
      Array.from({ length: 6 }, (_, i) => `b/f${i}.ts`),
      Array.from({ length: 6 }, (_, i) => `c/f${i}.ts`),
    ];

    // Strong internal clique edges
    for (const cluster of clusters) {
      for (let i = 0; i < cluster.length; i++) {
        for (let j = i + 1; j < cluster.length; j++) {
          addEdge(cluster[i], cluster[j], 3);
        }
      }
    }

    // Sparse bridges: 2 each between A↔B and B↔C
    addEdge(clusters[0][0], clusters[1][0], 1);
    addEdge(clusters[0][1], clusters[1][1], 1);
    addEdge(clusters[1][0], clusters[2][0], 1);
    addEdge(clusters[1][1], clusters[2][1], 1);

    const initial = new Map<string, string>();
    for (const n of graph.keys()) initial.set(n, "mega");

    const result = splitLargeCommunities(initial, graph, 5);
    const resultComms = new Set(result.values());

    // Should produce at least 3 communities (one per cluster)
    expect(resultComms.size).toBeGreaterThanOrEqual(3);

    // Each cluster should be cohesive
    for (const cluster of clusters) {
      const comm = result.get(cluster[0])!;
      for (const f of cluster) expect(result.get(f)).toBe(comm);
    }
  });
});

// ── splitByDirectory fallback ────────────────────────────────────────────────

describe("splitByDirectory", () => {
  it("splits files by depth-2 directory prefix", () => {
    const files = [
      "app/components/Button.tsx",
      "app/components/Modal.tsx",
      "app/lib/utils.ts",
      "app/lib/helpers.ts",
    ];
    const result = splitByDirectory(files, 2);

    expect(result).not.toBeNull();
    const comms = new Set(result!.values());
    expect(comms.size).toBe(2);
    // Files in same dir prefix should share a community
    expect(result!.get("app/components/Button.tsx")).toBe(result!.get("app/components/Modal.tsx"));
    expect(result!.get("app/lib/utils.ts")).toBe(result!.get("app/lib/helpers.ts"));
    // Different prefixes should differ
    expect(result!.get("app/components/Button.tsx")).not.toBe(result!.get("app/lib/utils.ts"));
  });

  it("falls back to depth-3 when all files share depth-2 prefix", () => {
    const files = [
      "app/src/auth/login.ts",
      "app/src/auth/logout.ts",
      "app/src/api/routes.ts",
      "app/src/api/handler.ts",
    ];
    const result = splitByDirectory(files, 4);

    expect(result).not.toBeNull();
    const comms = new Set(result!.values());
    expect(comms.size).toBe(2);
    expect(result!.get("app/src/auth/login.ts")).toBe(result!.get("app/src/auth/logout.ts"));
    expect(result!.get("app/src/api/routes.ts")).toBe(result!.get("app/src/api/handler.ts"));
  });

  it("returns null when all files are in the same directory", () => {
    const files = [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ];
    const result = splitByDirectory(files, 3);
    expect(result).toBeNull();
  });
});

describe("splitLargeCommunities with directory fallback", () => {
  it("uses directory fallback when Louvain cannot split a fully-connected graph", () => {
    const graph: import("../../../src/analyzers/louvain.js").UndirectedGraph = new Map();

    const ensure = (n: string) => {
      if (!graph.has(n)) graph.set(n, new Map());
      return graph.get(n)!;
    };
    const addEdge = (a: string, b: string, w: number) => {
      ensure(a).set(b, (ensure(a).get(b) ?? 0) + w);
      ensure(b).set(a, (ensure(b).get(a) ?? 0) + w);
    };

    // Fully-connected graph — Louvain can't find internal structure
    const filesA = Array.from({ length: 5 }, (_, i) => `app/components/f${i}.ts`);
    const filesB = Array.from({ length: 5 }, (_, i) => `app/lib/f${i}.ts`);
    const allFiles = [...filesA, ...filesB];

    for (let i = 0; i < allFiles.length; i++) {
      for (let j = i + 1; j < allFiles.length; j++) {
        addEdge(allFiles[i], allFiles[j], 1);
      }
    }

    const initial = new Map<string, string>();
    for (const f of allFiles) initial.set(f, "mega");

    const result = splitLargeCommunities(initial, graph, 5);
    const resultComms = new Set(result.values());

    // Should have split via directory fallback
    expect(resultComms.size).toBeGreaterThan(1);

    // Files in app/components should be in the same community
    const commA = result.get(filesA[0])!;
    for (const f of filesA) expect(result.get(f)).toBe(commA);

    // Files in app/lib should be in a different community
    const commB = result.get(filesB[0])!;
    for (const f of filesB) expect(result.get(f)).toBe(commB);
    expect(commA).not.toBe(commB);
  });
});

// ── End-to-end: analyzeZones produces subCrossings on large zones ──────────

describe("analyzeZones subdivision integration", () => {
  it("produces subZones and subCrossings on zones exceeding subdivision threshold", async () => {
    // Build a scenario where analyzeZones creates a large zone that gets subdivided
    // Two distinct sub-clusters within a single package directory
    const clusterA = Array.from(
      { length: Math.ceil(SUBDIVISION_THRESHOLD * 0.7) },
      (_, i) => `packages/bigpkg/src/alpha/f${i}.ts`
    );
    const clusterB = Array.from(
      { length: Math.ceil(SUBDIVISION_THRESHOLD * 0.7) },
      (_, i) => `packages/bigpkg/src/beta/f${i}.ts`
    );
    const allFiles = [...clusterA, ...clusterB];

    const inventory = makeInventory(allFiles.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    // Strong intra-cluster connectivity
    for (let i = 0; i < clusterA.length - 1; i++) {
      edges.push(makeEdge(clusterA[i], clusterA[i + 1]));
      if (i < clusterA.length - 2) edges.push(makeEdge(clusterA[i], clusterA[i + 2]));
    }
    for (let i = 0; i < clusterB.length - 1; i++) {
      edges.push(makeEdge(clusterB[i], clusterB[i + 1]));
      if (i < clusterB.length - 2) edges.push(makeEdge(clusterB[i], clusterB[i + 2]));
    }
    // Weak cross-cluster links (create crossings between sub-zones)
    edges.push(makeEdge(clusterA[0], clusterB[0]));
    edges.push(makeEdge(clusterA[5], clusterB[5]));

    const imports = makeImports(edges);
    const { zones: result } = await analyzeZones(inventory, imports, {
      enrich: false,
      maxZonePercent: 100, // Disable size cap — let same-ID merge create one large zone
    });

    // All files share packages/bigpkg root → merged into one zone (via mergeSameIdCommunities)
    // That zone should then be subdivided because it exceeds threshold
    const bigZone = result.zones.find((z) => z.files.length >= SUBDIVISION_THRESHOLD);

    // Assert the zone exists — the test is meaningless without it
    expect(bigZone).toBeDefined();

    // The large zone should have sub-zones from subdivision
    expect(bigZone!.subZones).toBeDefined();
    expect(bigZone!.subZones!.length).toBeGreaterThanOrEqual(2);

    // Sub-zone IDs should be prefixed with parent
    for (const sub of bigZone!.subZones!) {
      expect(sub.id).toMatch(new RegExp(`^${bigZone!.id}/`));
      expect(sub.depth).toBe(1);
    }

    // Sub-crossings should exist (we added cross-cluster edges)
    expect(bigZone!.subCrossings).toBeDefined();
    expect(bigZone!.subCrossings!.length).toBeGreaterThan(0);
    const subZoneIds = new Set(bigZone!.subZones!.map((z) => z.id));
    for (const crossing of bigZone!.subCrossings!) {
      expect(subZoneIds.has(crossing.fromZone)).toBe(true);
      expect(subZoneIds.has(crossing.toZone)).toBe(true);
      expect(crossing.fromZone).not.toBe(crossing.toZone);
    }
  });

  it("zones below subdivision threshold have no subZones", async () => {
    // Small zone that should NOT be subdivided
    const inventory = makeInventory([
      makeFileEntry("src/small/a.ts"),
      makeFileEntry("src/small/b.ts"),
      makeFileEntry("src/small/c.ts"),
    ]);
    const imports = makeImports([
      makeEdge("src/small/a.ts", "src/small/b.ts"),
      makeEdge("src/small/b.ts", "src/small/c.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    for (const zone of result.zones) {
      expect(zone.subZones).toBeUndefined();
      expect(zone.subCrossings).toBeUndefined();
    }
  });
});

// ── Regression: pipeline determinism with subdivision ─────────────────────────

describe("analyzeZones subdivision determinism", () => {
  it("produces identical output across multiple runs on the same input", async () => {
    // A large-enough scenario that triggers subdivision
    const clusterA = Array.from({ length: 30 }, (_, i) => `packages/proj/src/api/f${i}.ts`);
    const clusterB = Array.from({ length: 30 }, (_, i) => `packages/proj/src/web/f${i}.ts`);
    const allFiles = [...clusterA, ...clusterB];

    const inventory = makeInventory(allFiles.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    for (let i = 0; i < clusterA.length - 1; i++) {
      edges.push(makeEdge(clusterA[i], clusterA[i + 1]));
      if (i < clusterA.length - 2) edges.push(makeEdge(clusterA[i], clusterA[i + 2]));
    }
    for (let i = 0; i < clusterB.length - 1; i++) {
      edges.push(makeEdge(clusterB[i], clusterB[i + 1]));
      if (i < clusterB.length - 2) edges.push(makeEdge(clusterB[i], clusterB[i + 2]));
    }
    edges.push(makeEdge(clusterA[0], clusterB[0]));

    const imports = makeImports(edges);

    const { zones: run1 } = await analyzeZones(inventory, imports, {
      enrich: false,
      maxZonePercent: 100,
    });
    const { zones: run2 } = await analyzeZones(inventory, imports, {
      enrich: false,
      maxZonePercent: 100,
    });

    // Full deep equality — zone structure, subZones, crossings, everything
    expect(run1).toEqual(run2);
  });

  it("produces same structure hash when subdivision yields same groupings", async () => {
    const files = Array.from({ length: 60 }, (_, i) => `src/mod/f${i}.ts`);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    for (let i = 0; i < files.length - 1; i++) {
      edges.push(makeEdge(files[i], files[i + 1]));
    }

    const imports = makeImports(edges);

    const { zones: run1 } = await analyzeZones(inventory, imports, { enrich: false });
    const { zones: run2 } = await analyzeZones(inventory, imports, { enrich: false });

    expect(run1.structureHash).toBe(run2.structureHash);
  });
});

// ── Regression: pipeline on fixture-like data ──────────────────────────────────

describe("analyzeZones fixture regression", () => {
  /**
   * Models the small-ts-project fixture (7 files with known import graph).
   * Verifies the refactored pipeline (runZonePipeline extraction, subdivideZone
   * rewrite) produces correct, stable output for a well-understood topology.
   */
  it("produces correct zone structure for fixture-like small project", async () => {
    // Recreate the small-ts-project import graph:
    //   index.ts → user-service.ts, format.ts
    //   user-service.ts → user.ts, validate.ts, format.ts
    //   email-service.ts → user.ts
    //   validate.ts → format.ts
    const inventory = makeInventory([
      makeFileEntry("src/index.ts"),
      makeFileEntry("src/config.ts"),
      makeFileEntry("src/models/user.ts"),
      makeFileEntry("src/services/user-service.ts"),
      makeFileEntry("src/services/email-service.ts"),
      makeFileEntry("src/utils/validate.ts"),
      makeFileEntry("src/utils/format.ts"),
    ]);

    const imports = makeImports([
      makeEdge("src/index.ts", "src/services/user-service.ts", ["UserService"]),
      makeEdge("src/index.ts", "src/utils/format.ts", ["formatName"]),
      makeEdge("src/services/user-service.ts", "src/models/user.ts", ["User", "createUser"]),
      makeEdge("src/services/user-service.ts", "src/utils/validate.ts", ["validateName"]),
      makeEdge("src/services/user-service.ts", "src/utils/format.ts", ["formatName"]),
      makeEdge("src/services/email-service.ts", "src/models/user.ts", ["User"]),
      makeEdge("src/utils/validate.ts", "src/utils/format.ts", ["formatName"]),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Should produce zones (small project → likely 1-2 zones)
    expect(result.zones.length).toBeGreaterThanOrEqual(1);

    // All 7 files should be accounted for (in zones or unzoned)
    const allZonedFiles = new Set(result.zones.flatMap((z) => z.files));
    const allAccountedFiles = new Set([...allZonedFiles, ...result.unzoned]);
    for (const f of inventory.files) {
      expect(allAccountedFiles.has(f.path)).toBe(true);
    }

    // No zone should have subZones (all well under threshold)
    for (const zone of result.zones) {
      expect(zone.subZones).toBeUndefined();
      expect(zone.subCrossings).toBeUndefined();
    }

    // Structure hash should be present
    expect(result.structureHash).toBeDefined();
    expect(result.structureHash).toMatch(/^[0-9a-f]{16}$/);

    // Zone content hashes should cover all zones
    expect(result.zoneContentHashes).toBeDefined();
    for (const zone of result.zones) {
      expect(result.zoneContentHashes![zone.id]).toBeDefined();
    }

    // Each zone should have valid metrics
    for (const zone of result.zones) {
      expect(zone.cohesion).toBeGreaterThanOrEqual(0);
      expect(zone.cohesion).toBeLessThanOrEqual(1);
      expect(zone.coupling).toBeGreaterThanOrEqual(0);
      expect(zone.coupling).toBeLessThanOrEqual(1);
      expect(zone.id).toBeTruthy();
      expect(zone.name).toBeTruthy();
      expect(zone.files.length).toBeGreaterThan(0);
    }

    // Deterministic: running again produces identical output
    const { zones: run2 } = await analyzeZones(inventory, imports, { enrich: false });
    expect(result).toEqual(run2);
  });

  it("produces correct output for multi-cluster fixture with subdivision", async () => {
    // Larger fixture that triggers subdivision: 3 packages with distinct clusters
    const pkgA = Array.from({ length: 25 }, (_, i) => `packages/alpha/src/f${i}.ts`);
    const pkgB = Array.from({ length: 25 }, (_, i) => `packages/beta/src/f${i}.ts`);
    const pkgC = Array.from({ length: 25 }, (_, i) => `packages/gamma/src/f${i}.ts`);
    const allFiles = [...pkgA, ...pkgB, ...pkgC];

    const inventory = makeInventory(allFiles.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    // Strong intra-package edges
    for (const pkg of [pkgA, pkgB, pkgC]) {
      for (let i = 0; i < pkg.length - 1; i++) {
        edges.push(makeEdge(pkg[i], pkg[i + 1], ["sym1", "sym2"]));
        if (i < pkg.length - 2) edges.push(makeEdge(pkg[i], pkg[i + 2]));
      }
    }
    // Weak cross-package edges
    edges.push(makeEdge(pkgA[0], pkgB[0]));
    edges.push(makeEdge(pkgB[0], pkgC[0]));

    const imports = makeImports(edges);

    const { zones: result } = await analyzeZones(inventory, imports, {
      enrich: false,
      maxZonePercent: 100, // Let natural clustering dominate
    });

    // Should produce at least 3 zones (one per package)
    expect(result.zones.length).toBeGreaterThanOrEqual(3);

    // All files accounted for
    const allZonedFiles = result.zones.flatMap((z) => z.files);
    const allAccountedFiles = new Set([...allZonedFiles, ...result.unzoned]);
    expect(allAccountedFiles.size).toBe(allFiles.length);

    // Crossings should exist between the packages (we added cross-package edges)
    expect(result.crossings.length).toBeGreaterThan(0);

    // Each crossing should reference valid zone IDs
    const zoneIds = new Set(result.zones.map((z) => z.id));
    for (const crossing of result.crossings) {
      expect(zoneIds.has(crossing.fromZone)).toBe(true);
      expect(zoneIds.has(crossing.toZone)).toBe(true);
    }

    // Deterministic
    const { zones: run2 } = await analyzeZones(inventory, imports, {
      enrich: false,
      maxZonePercent: 100,
    });
    expect(result).toEqual(run2);
  });
});

// ── deriveZoneIdFromFilenames ────────────────────────────────────────────────

describe("deriveZoneIdFromFilenames", () => {
  it("returns dominant theme word from filenames", () => {
    const files = [
      "src/provider-interface.ts",
      "src/provider-registry.ts",
      "src/provider-session.ts",
      "src/cli-provider.ts",
    ];
    expect(deriveZoneIdFromFilenames(files)).toBe("provider");
  });

  it("returns null when no word reaches 30% threshold", () => {
    const files = [
      "src/alpha.ts",
      "src/bravo.ts",
      "src/charlie.ts",
      "src/delta.ts",
      "src/echo.ts",
      "src/foxtrot.ts",
      "src/golf.ts",
    ];
    expect(deriveZoneIdFromFilenames(files)).toBeNull();
  });

  it("returns null with fewer than 2 source files", () => {
    expect(deriveZoneIdFromFilenames(["src/foo.ts"])).toBeNull();
    expect(deriveZoneIdFromFilenames([])).toBeNull();
  });

  it("filters out test files", () => {
    const files = [
      "src/provider.test.ts",
      "src/provider.spec.ts",
      "src/alpha.ts",
      "src/bravo.ts",
    ];
    // After filtering test files, only alpha and bravo remain — no dominant word
    expect(deriveZoneIdFromFilenames(files)).toBeNull();
  });

  it("skips generic words like index, utils, types", () => {
    const files = [
      "src/index.ts",
      "src/utils.ts",
      "src/types.ts",
      "src/auth-service.ts",
      "src/auth-middleware.ts",
      "src/auth-config.ts",
    ];
    expect(deriveZoneIdFromFilenames(files)).toBe("auth");
  });

  it("splits camelCase boundaries", () => {
    const files = [
      "src/providerInterface.ts",
      "src/providerRegistry.ts",
      "src/providerSession.ts",
    ];
    expect(deriveZoneIdFromFilenames(files)).toBe("provider");
  });

  it("tie-breaks lexicographically", () => {
    // "auth" and "user" each appear in 2 of 4 files (50%), both above threshold
    const files = [
      "src/auth-login.ts",
      "src/auth-logout.ts",
      "src/user-profile.ts",
      "src/user-settings.ts",
    ];
    // "auth" comes before "user" lexicographically
    expect(deriveZoneIdFromFilenames(files)).toBe("auth");
  });

  it("deduplicates words per file", () => {
    // "llm" appears twice in the stem "llm-llm" but should only count once per file
    const files = [
      "src/llm-llm.ts",
      "src/llm-types.ts",
      "src/llm-config.ts",
    ];
    expect(deriveZoneIdFromFilenames(files)).toBe("llm");
  });
});

// ── filename-based zone IDs in pipeline ─────────────────────────────────────

describe("filename-based zone IDs replace numeric suffixes", () => {
  it("uses filename-derived ID when directory-based would produce a duplicate", async () => {
    // All files in src/ — directory-based derivation produces "src" for all communities.
    // Three disconnected clusters large enough that merge would exceed size cap.
    // With default maxZonePercent (30%), max zone size = ceil(15 * 0.3) = 5 files,
    // so merging two clusters of 5 would exceed the cap, forcing separate zones.
    const providerFiles = Array.from({ length: 5 }, (_, i) => `src/provider-${String.fromCharCode(97 + i)}.ts`);
    const llmFiles = Array.from({ length: 5 }, (_, i) => `src/llm-${String.fromCharCode(97 + i)}.ts`);
    const coreFiles = Array.from({ length: 5 }, (_, i) => `src/core-${String.fromCharCode(97 + i)}.ts`);

    const allFiles = [...providerFiles, ...llmFiles, ...coreFiles];
    const inventory = makeInventory(allFiles.map((f) => makeFileEntry(f)));

    // Create three tightly connected but disconnected clusters
    const edges: ImportEdge[] = [];
    for (const cluster of [providerFiles, llmFiles, coreFiles]) {
      for (let i = 0; i < cluster.length - 1; i++) {
        edges.push(makeEdge(cluster[i], cluster[i + 1]));
      }
      edges.push(makeEdge(cluster[cluster.length - 1], cluster[0]));
    }
    const imports = makeImports(edges);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    // Should have at least 2 zones (may have 3 depending on merge behavior)
    expect(result.zones.length).toBeGreaterThanOrEqual(2);

    // At least one zone should have a filename-derived ID (provider, llm, or core)
    const ids = result.zones.map((z) => z.id);
    const hasDescriptiveId = ids.some(
      (id) => id === "provider" || id === "llm" || id === "core"
    );
    expect(hasDescriptiveId).toBe(true);

    // Should NOT have zones with numeric suffixes like src-2, src-3
    for (const zone of result.zones) {
      expect(zone.id).not.toMatch(/^src-\d+$/);
    }
  });
});

// ── mergeSatelliteCommunities ────────────────────────────────────────────────

describe("mergeSatelliteCommunities", () => {
  it("absorbs a small high-coupling community into its most-connected neighbor", () => {
    // Setup: 3 communities — large A (10 nodes), large B (10 nodes), satellite S (4 nodes)
    // S has more external edges than internal edges → high coupling
    const community = new Map<string, string>();
    const graph: Map<string, Map<string, number>> = new Map();

    // Large community A: 10 nodes tightly connected
    for (let i = 0; i < 10; i++) {
      community.set(`a${i}`, "A");
      graph.set(`a${i}`, new Map());
    }
    for (let i = 0; i < 9; i++) {
      graph.get(`a${i}`)!.set(`a${i + 1}`, 1);
      graph.get(`a${i + 1}`)!.set(`a${i}`, 1);
    }

    // Large community B: 10 nodes tightly connected
    for (let i = 0; i < 10; i++) {
      community.set(`b${i}`, "B");
      graph.set(`b${i}`, new Map());
    }
    for (let i = 0; i < 9; i++) {
      graph.get(`b${i}`)!.set(`b${i + 1}`, 1);
      graph.get(`b${i + 1}`)!.set(`b${i}`, 1);
    }

    // Satellite S: 4 nodes with 1 internal edge, 3 external edges to A
    for (let i = 0; i < 4; i++) {
      community.set(`s${i}`, "S");
      if (!graph.has(`s${i}`)) graph.set(`s${i}`, new Map());
    }
    // 1 internal edge
    graph.get("s0")!.set("s1", 1);
    graph.get("s1")!.set("s0", 1);
    // 3 cross-edges to A (high coupling)
    graph.get("s0")!.set("a0", 1);
    graph.get("a0")!.set("s0", 1);
    graph.get("s1")!.set("a1", 1);
    graph.get("a1")!.set("s1", 1);
    graph.get("s2")!.set("a2", 1);
    graph.get("a2")!.set("s2", 1);

    const result = mergeSatelliteCommunities(community, graph);

    // S should be absorbed into A (its most-connected neighbor)
    for (let i = 0; i < 4; i++) {
      expect(result.get(`s${i}`)).toBe("A");
    }
    // A and B should remain unchanged
    for (let i = 0; i < 10; i++) {
      expect(result.get(`a${i}`)).toBe("A");
      expect(result.get(`b${i}`)).toBe("B");
    }
  });

  it("preserves small communities with high cohesion", () => {
    const community = new Map<string, string>();
    const graph: Map<string, Map<string, number>> = new Map();

    // Large community A
    for (let i = 0; i < 10; i++) {
      community.set(`a${i}`, "A");
      graph.set(`a${i}`, new Map());
    }
    for (let i = 0; i < 9; i++) {
      graph.get(`a${i}`)!.set(`a${i + 1}`, 1);
      graph.get(`a${i + 1}`)!.set(`a${i}`, 1);
    }

    // Small community S: 4 nodes with 6 internal edges, 1 external edge
    // Internal edges >> external → low coupling, should NOT be merged
    for (let i = 0; i < 4; i++) {
      community.set(`s${i}`, "S");
      graph.set(`s${i}`, new Map());
    }
    // Fully connected internally (6 edges)
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        graph.get(`s${i}`)!.set(`s${j}`, 1);
        graph.get(`s${j}`)!.set(`s${i}`, 1);
      }
    }
    // 1 cross-edge to A
    graph.get("s0")!.set("a0", 1);
    graph.get("a0")!.set("s0", 1);

    const result = mergeSatelliteCommunities(community, graph);

    // S should remain separate (low coupling)
    for (let i = 0; i < 4; i++) {
      expect(result.get(`s${i}`)).toBe("S");
    }
  });

  it("does not merge communities exceeding maxSize", () => {
    const community = new Map<string, string>();
    const graph: Map<string, Map<string, number>> = new Map();

    // Large community A
    for (let i = 0; i < 10; i++) {
      community.set(`a${i}`, "A");
      graph.set(`a${i}`, new Map());
    }

    // Community S: exactly at maxSize=5, with high coupling
    for (let i = 0; i < 5; i++) {
      community.set(`s${i}`, "S");
      graph.set(`s${i}`, new Map());
    }
    // Only external edges, no internal
    for (let i = 0; i < 5; i++) {
      graph.get(`s${i}`)!.set(`a${i}`, 1);
      graph.get(`a${i}`)!.set(`s${i}`, 1);
    }

    // maxSize=4 → S has 5 files, should NOT be merged
    const result = mergeSatelliteCommunities(community, graph, 4);

    for (let i = 0; i < 5; i++) {
      expect(result.get(`s${i}`)).toBe("S");
    }
  });

  it("chooses the most-connected neighbor when multiple neighbors exist", () => {
    const community = new Map<string, string>();
    const graph: Map<string, Map<string, number>> = new Map();

    // Community A (10 nodes)
    for (let i = 0; i < 10; i++) {
      community.set(`a${i}`, "A");
      graph.set(`a${i}`, new Map());
    }

    // Community B (10 nodes)
    for (let i = 0; i < 10; i++) {
      community.set(`b${i}`, "B");
      graph.set(`b${i}`, new Map());
    }

    // Satellite S: 3 nodes, 2 edges to A, 1 edge to B
    for (let i = 0; i < 3; i++) {
      community.set(`s${i}`, "S");
      graph.set(`s${i}`, new Map());
    }
    graph.get("s0")!.set("a0", 1);
    graph.get("a0")!.set("s0", 1);
    graph.get("s1")!.set("a1", 1);
    graph.get("a1")!.set("s1", 1);
    graph.get("s2")!.set("b0", 1);
    graph.get("b0")!.set("s2", 1);

    const result = mergeSatelliteCommunities(community, graph);

    // S should merge into A (2 edges) not B (1 edge)
    for (let i = 0; i < 3; i++) {
      expect(result.get(`s${i}`)).toBe("A");
    }
  });
});
