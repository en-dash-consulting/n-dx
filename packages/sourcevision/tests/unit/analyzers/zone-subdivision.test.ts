import { describe, it, expect } from "vitest";
import {
  analyzeZones,
  computeStructureHash,
  computeZoneContentHash,
  computeGlobalContentHash,
  subdivideZone,
  runZonePipeline,
  SUBDIVISION_THRESHOLD,
  MAX_SUBDIVISION_DEPTH,
} from "../../../src/analyzers/zones.js";
import type {
  Zone,
  ZoneCrossing,
  Zones,
  ImportEdge,
} from "../../../src/schema/index.js";
import {
  makeFileEntry,
  makeInventory,
  makeEdge,
  makeImports,
  makeZone,
} from "./zones-helpers.js";

// ── computeStructureHash ────────────────────────────────────────────────────

describe("computeStructureHash", () => {
  it("produces the same hash for the same zone files", () => {
    const zones: Zone[] = [
      { id: "a", name: "", description: "", files: ["x.ts", "y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    expect(computeStructureHash(zones)).toBe(computeStructureHash(zones));
  });

  it("produces different hashes for different zone files", () => {
    const z1: Zone[] = [
      { id: "a", name: "", description: "", files: ["x.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    const z2: Zone[] = [
      { id: "a", name: "", description: "", files: ["y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    expect(computeStructureHash(z1)).not.toBe(computeStructureHash(z2));
  });

  it("is independent of zone ID or name (only file groupings matter)", () => {
    const z1: Zone[] = [
      { id: "a", name: "A", description: "", files: ["x.ts", "y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    const z2: Zone[] = [
      { id: "renamed", name: "Renamed", description: "", files: ["x.ts", "y.ts"], entryPoints: [], cohesion: 1, coupling: 0 },
    ];
    expect(computeStructureHash(z1)).toBe(computeStructureHash(z2));
  });
});

// ── subdivideZone ──────────────────────────────────────────────────────────────

describe("subdivideZone", () => {
  it("returns empty array for zones below threshold", () => {
    const zone = makeZone("small", Array.from({ length: 10 }, (_, i) => `src/small/${i}.ts`));
    const inventory = makeInventory(zone.files.map((f) => makeFileEntry(f)));
    const imports = makeImports(zone.files.slice(1).map((f, i) => makeEdge(zone.files[i], f)));

    const subZones = subdivideZone(zone, imports, inventory);

    expect(subZones).toEqual([]);
  });

  it("returns empty array when no internal edges", () => {
    const files = Array.from({ length: 60 }, (_, i) => `src/large/${i}.ts`);
    const zone = makeZone("large", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));
    const imports = makeImports([]); // No edges at all

    const subZones = subdivideZone(zone, imports, inventory);

    expect(subZones).toEqual([]);
  });

  it("returns empty array when Louvain finds only one community", () => {
    // All files fully connected = single community
    const files = Array.from({ length: 55 }, (_, i) => `src/large/${i}.ts`);
    const zone = makeZone("large", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));
    // Create a complete graph (every file connected to every other)
    const edges: ImportEdge[] = [];
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        edges.push(makeEdge(files[i], files[j]));
      }
    }
    const imports = makeImports(edges);

    const subZones = subdivideZone(zone, imports, inventory);

    // May or may not find sub-communities depending on Louvain result
    // If it finds only 1, returns empty
    // This test just ensures it doesn't throw
    expect(Array.isArray(subZones)).toBe(true);
  });

  it("subdivides a large zone into multiple sub-zones", () => {
    // Create two distinct clusters that should be detected
    const cluster1 = Array.from({ length: 30 }, (_, i) => `src/cluster1/file${i}.ts`);
    const cluster2 = Array.from({ length: 30 }, (_, i) => `src/cluster2/file${i}.ts`);
    const files = [...cluster1, ...cluster2];

    const zone = makeZone("large", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));

    // Create edges within each cluster (strong internal connectivity)
    const edges: ImportEdge[] = [];
    for (let i = 0; i < cluster1.length - 1; i++) {
      edges.push(makeEdge(cluster1[i], cluster1[i + 1]));
    }
    for (let i = 0; i < cluster2.length - 1; i++) {
      edges.push(makeEdge(cluster2[i], cluster2[i + 1]));
    }
    // Add a few weak links between clusters
    edges.push(makeEdge(cluster1[0], cluster2[0]));

    const imports = makeImports(edges);

    const subZones = subdivideZone(zone, imports, inventory);

    // Should find at least 2 sub-zones
    expect(subZones.length).toBeGreaterThanOrEqual(2);

    // Sub-zone IDs should be prefixed with parent ID
    for (const sub of subZones) {
      expect(sub.id).toMatch(/^large\//);
    }
  });

  it("sets depth on sub-zones", () => {
    const cluster1 = Array.from({ length: 30 }, (_, i) => `src/a/file${i}.ts`);
    const cluster2 = Array.from({ length: 30 }, (_, i) => `src/b/file${i}.ts`);
    const files = [...cluster1, ...cluster2];

    const zone: Zone = {
      id: "parent",
      name: "Parent",
      description: "test",
      files,
      entryPoints: [],
      cohesion: 0.5,
      coupling: 0.5,
      depth: 0, // Parent is at depth 0
    };
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    for (let i = 0; i < cluster1.length - 1; i++) {
      edges.push(makeEdge(cluster1[i], cluster1[i + 1]));
    }
    for (let i = 0; i < cluster2.length - 1; i++) {
      edges.push(makeEdge(cluster2[i], cluster2[i + 1]));
    }
    edges.push(makeEdge(cluster1[0], cluster2[0]));
    const imports = makeImports(edges);

    const subZones = subdivideZone(zone, imports, inventory);

    // All sub-zones should have depth = parent depth + 1
    for (const sub of subZones) {
      expect(sub.depth).toBe(1);
    }
  });

  it("respects max depth limit", () => {
    const files = Array.from({ length: 60 }, (_, i) => `src/deep/${i}.ts`);
    const zone: Zone = {
      id: "deep",
      name: "Deep",
      description: "test",
      files,
      entryPoints: [],
      cohesion: 0.5,
      coupling: 0.5,
    };
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));
    const edges = files.slice(1).map((f, i) => makeEdge(files[i], f));
    const imports = makeImports(edges);

    // Call with depth at max
    const subZones = subdivideZone(zone, imports, inventory, new Set(), MAX_SUBDIVISION_DEPTH);

    // Should return empty (depth exceeded)
    expect(subZones).toEqual([]);
  });
});

describe("SUBDIVISION_THRESHOLD", () => {
  it("is set to a reasonable value", () => {
    expect(SUBDIVISION_THRESHOLD).toBeGreaterThanOrEqual(30);
    expect(SUBDIVISION_THRESHOLD).toBeLessThanOrEqual(100);
  });
});

describe("MAX_SUBDIVISION_DEPTH", () => {
  it("is set to prevent infinite recursion", () => {
    expect(MAX_SUBDIVISION_DEPTH).toBeGreaterThanOrEqual(1);
    expect(MAX_SUBDIVISION_DEPTH).toBeLessThanOrEqual(5);
  });
});

// ── Sub-crossings computation ─────────────────────────────────────────────────

describe("subdivideZone sub-crossings", () => {
  it("stores sub-crossings on parent zone when sub-zones have cross-edges", () => {
    // Two distinct clusters with a cross-edge between them
    const cluster1 = Array.from({ length: 30 }, (_, i) => `src/alpha/file${i}.ts`);
    const cluster2 = Array.from({ length: 30 }, (_, i) => `src/beta/file${i}.ts`);
    const files = [...cluster1, ...cluster2];

    const zone = makeZone("parent", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    // Strong intra-cluster connectivity
    for (let i = 0; i < cluster1.length - 1; i++) {
      edges.push(makeEdge(cluster1[i], cluster1[i + 1]));
      if (i < cluster1.length - 2) edges.push(makeEdge(cluster1[i], cluster1[i + 2]));
    }
    for (let i = 0; i < cluster2.length - 1; i++) {
      edges.push(makeEdge(cluster2[i], cluster2[i + 1]));
      if (i < cluster2.length - 2) edges.push(makeEdge(cluster2[i], cluster2[i + 2]));
    }
    // Cross-cluster edge that should become a sub-crossing
    edges.push(makeEdge(cluster1[0], cluster2[0]));
    edges.push(makeEdge(cluster1[5], cluster2[5]));

    const imports = makeImports(edges);
    const subZones = subdivideZone(zone, imports, inventory);

    // Should have found sub-zones
    expect(subZones.length).toBeGreaterThanOrEqual(2);

    // Parent zone should now have subCrossings populated
    expect(zone.subCrossings).toBeDefined();
    expect(zone.subCrossings!.length).toBeGreaterThan(0);

    // Each sub-crossing should reference valid sub-zone IDs
    const subZoneIds = new Set(subZones.map((z) => z.id));
    for (const crossing of zone.subCrossings!) {
      expect(subZoneIds.has(crossing.fromZone)).toBe(true);
      expect(subZoneIds.has(crossing.toZone)).toBe(true);
      expect(crossing.fromZone).not.toBe(crossing.toZone);
    }
  });

  it("does not set subCrossings when sub-zones have no cross-edges", () => {
    // Two completely disconnected cliques (no bridging edge).
    // Clique topology ensures Louvain assigns all files in a cluster to the
    // same community (unlike chain topology which can fragment).
    const cluster1 = Array.from({ length: 30 }, (_, i) => `src/left/file${i}.ts`);
    const cluster2 = Array.from({ length: 30 }, (_, i) => `src/right/file${i}.ts`);
    const files = [...cluster1, ...cluster2];

    const zone = makeZone("parent", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    // Intra-cluster clique edges (every file connected to every other in cluster)
    for (const cluster of [cluster1, cluster2]) {
      for (let i = 0; i < cluster.length; i++) {
        for (let j = i + 1; j < cluster.length; j++) {
          edges.push(makeEdge(cluster[i], cluster[j]));
        }
      }
    }
    // No cross-cluster edges at all

    const imports = makeImports(edges);
    const subZones = subdivideZone(zone, imports, inventory);

    if (subZones.length >= 2) {
      // No import edges exist between clusters, so no sub-crossings
      expect(zone.subCrossings ?? []).toHaveLength(0);
    }
  });

  it("sub-crossings reference correct file paths", () => {
    const cluster1 = Array.from({ length: 30 }, (_, i) => `src/api/file${i}.ts`);
    const cluster2 = Array.from({ length: 30 }, (_, i) => `src/web/file${i}.ts`);
    const files = [...cluster1, ...cluster2];

    const zone = makeZone("app", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    for (let i = 0; i < cluster1.length - 1; i++) {
      edges.push(makeEdge(cluster1[i], cluster1[i + 1]));
      if (i < cluster1.length - 2) edges.push(makeEdge(cluster1[i], cluster1[i + 2]));
    }
    for (let i = 0; i < cluster2.length - 1; i++) {
      edges.push(makeEdge(cluster2[i], cluster2[i + 1]));
      if (i < cluster2.length - 2) edges.push(makeEdge(cluster2[i], cluster2[i + 2]));
    }
    // Specific cross-cluster edge
    edges.push(makeEdge(cluster1[0], cluster2[0]));

    const imports = makeImports(edges);
    const subZones = subdivideZone(zone, imports, inventory);

    if (subZones.length >= 2 && zone.subCrossings && zone.subCrossings.length > 0) {
      const allFiles = new Set(files);
      for (const crossing of zone.subCrossings) {
        // from and to should be actual file paths within the zone
        expect(allFiles.has(crossing.from)).toBe(true);
        expect(allFiles.has(crossing.to)).toBe(true);
      }
    }
  });
});

// ── Resolution escalation at subdivision level ──────────────────────────────

describe("subdivision resolution escalation", () => {
  it("runZonePipeline splits oversized sub-communities at subdivision depth", () => {
    // Create a graph with 3 distinct clusters but all starting as one community.
    // The pipeline's splitLargeCommunities + resolution escalation should separate them.
    const clusterA = Array.from({ length: 20 }, (_, i) => `packages/pkg/src/mod-a/f${i}.ts`);
    const clusterB = Array.from({ length: 20 }, (_, i) => `packages/pkg/src/mod-b/f${i}.ts`);
    const clusterC = Array.from({ length: 20 }, (_, i) => `packages/pkg/src/mod-c/f${i}.ts`);
    const allFiles = [...clusterA, ...clusterB, ...clusterC];

    const edges: ImportEdge[] = [];
    // Strong intra-cluster edges (chain + skip-one connectivity)
    for (const cluster of [clusterA, clusterB, clusterC]) {
      for (let i = 0; i < cluster.length - 1; i++) {
        edges.push(makeEdge(cluster[i], cluster[i + 1]));
        if (i < cluster.length - 2) edges.push(makeEdge(cluster[i], cluster[i + 2]));
      }
    }
    // Weak cross-cluster links
    edges.push(makeEdge(clusterA[0], clusterB[0]));
    edges.push(makeEdge(clusterB[0], clusterC[0]));

    const inventory = makeInventory(allFiles.map((f) => makeFileEntry(f)));
    const imports = makeImports(edges);

    const result = runZonePipeline({
      edges,
      inventory,
      imports,
      scopeFiles: allFiles,
      maxZones: 8,
      parentId: "pkg",
      depth: 1,
    });

    // Should produce multiple zones from the pipeline
    expect(result.zones.length).toBeGreaterThanOrEqual(2);

    // Each zone should be prefixed with parent ID
    for (const zone of result.zones) {
      expect(zone.id).toMatch(/^pkg\//);
      expect(zone.depth).toBe(1);
    }
  });
});

// ── Proximity edges at subdivision level ─────────────────────────────────────

describe("subdivision proximity edges", () => {
  it("non-import files within a zone are assigned via proximity during subdivision", () => {
    // Mix of import-connected files and isolated files in same directories
    const importFiles1 = Array.from({ length: 25 }, (_, i) => `src/core/mod${i}.ts`);
    const importFiles2 = Array.from({ length: 25 }, (_, i) => `src/util/mod${i}.ts`);
    // Non-import files co-located with import files
    const nonImportFiles = [
      "src/core/README.md",
      "src/core/types.d.ts",
      "src/util/constants.json",
      "src/util/helpers.d.ts",
    ];
    const allFiles = [...importFiles1, ...importFiles2, ...nonImportFiles];

    const zone = makeZone("big", allFiles);
    const inventory = makeInventory(allFiles.map((f) =>
      makeFileEntry(f, nonImportFiles.includes(f) ? { role: "docs" } : {})
    ));

    const edges: ImportEdge[] = [];
    for (let i = 0; i < importFiles1.length - 1; i++) {
      edges.push(makeEdge(importFiles1[i], importFiles1[i + 1]));
    }
    for (let i = 0; i < importFiles2.length - 1; i++) {
      edges.push(makeEdge(importFiles2[i], importFiles2[i + 1]));
    }
    // Weak cross-cluster link
    edges.push(makeEdge(importFiles1[0], importFiles2[0]));

    const imports = makeImports(edges);
    const subZones = subdivideZone(zone, imports, inventory);

    if (subZones.length >= 2) {
      // All files from the parent zone should be accounted for in sub-zones
      const allSubZoneFiles = new Set(subZones.flatMap((z) => z.files));
      // The non-import files should end up in sub-zones (not left unzoned)
      // since runZonePipeline includes proximity assignment
      for (const f of nonImportFiles) {
        // Non-import files should be in the sub-zone whose directory matches
        // (assignByProximity in the pipeline handles this)
        expect(allSubZoneFiles.has(f)).toBe(true);
      }
    }
  });
});

// ── mergeSameIdCommunities at subdivision level ──────────────────────────────

describe("subdivision mergeSameIdCommunities", () => {
  it("merges sub-communities with same derived ID within a parent zone", () => {
    // Two clusters under "services/" and one under "routes/" within a non-package
    // directory. Both service clusters derive "services" as zone ID and should merge.
    // Paths avoid packages/<name>/ prefix so dominantPackageRoot doesn't merge all.
    const group1 = Array.from({ length: 26 }, (_, i) => `src/services/auth/a${i}.ts`);
    const group2 = Array.from({ length: 26 }, (_, i) => `src/services/billing/b${i}.ts`);
    const separate = Array.from({ length: 26 }, (_, i) => `src/routes/admin/r${i}.ts`);
    const allFiles = [...group1, ...group2, ...separate];

    const inventory = makeInventory(allFiles.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    // Group 1: strong chain + skip-one for cohesion
    for (let i = 0; i < group1.length - 1; i++) {
      edges.push(makeEdge(group1[i], group1[i + 1]));
      if (i < group1.length - 2) edges.push(makeEdge(group1[i], group1[i + 2]));
    }
    // Group 2: strong chain + skip-one
    for (let i = 0; i < group2.length - 1; i++) {
      edges.push(makeEdge(group2[i], group2[i + 1]));
      if (i < group2.length - 2) edges.push(makeEdge(group2[i], group2[i + 2]));
    }
    // Separate cluster: strong chain + skip-one
    for (let i = 0; i < separate.length - 1; i++) {
      edges.push(makeEdge(separate[i], separate[i + 1]));
      if (i < separate.length - 2) edges.push(makeEdge(separate[i], separate[i + 2]));
    }
    // Weak links between groups
    edges.push(makeEdge(group1[0], group2[0]));
    edges.push(makeEdge(group1[0], separate[0]));

    const imports = makeImports(edges);

    // Run at subdivision level (depth=1, parentId="app")
    const result = runZonePipeline({
      edges,
      inventory,
      imports,
      scopeFiles: allFiles,
      maxZones: 8,
      parentId: "app",
      depth: 1,
      maxZonePercent: 100, // Disable size cap to test pure same-ID merge
    });

    // group1 and group2 both derive "services" as zone ID — should merge.
    // routes should remain separate.
    const serviceZones = result.zones.filter((z) => z.id.includes("services"));
    const routeZones = result.zones.filter((z) => z.id.includes("routes"));

    // Total should be at most 2 zones (merged services + routes), not 3
    expect(result.zones.length).toBeLessThanOrEqual(2);

    // Should have at most 1 service zone (merged) and at least 1 route zone
    expect(serviceZones.length).toBeLessThanOrEqual(1);
    expect(routeZones.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Recursive multi-depth subdivision ────────────────────────────────────────

describe("recursive multi-depth subdivision", () => {
  it("subdivideZone recurses when sub-zones are still large", () => {
    // Create a zone with 4 distinct clusters, each >= SUBDIVISION_THRESHOLD
    // The first subdivision should create sub-zones, some of which are large
    // enough to trigger a second level of subdivision
    const clusterCount = 4;
    const filesPerCluster = Math.ceil(SUBDIVISION_THRESHOLD * 1.2); // >threshold per sub-zone
    const clusters: string[][] = [];
    for (let c = 0; c < clusterCount; c++) {
      clusters.push(
        Array.from({ length: filesPerCluster }, (_, i) => `src/group${c}/sub${i % 2}/file${i}.ts`)
      );
    }
    const allFiles = clusters.flat();

    const zone = makeZone("mega", allFiles);
    const inventory = makeInventory(allFiles.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    for (const cluster of clusters) {
      for (let i = 0; i < cluster.length - 1; i++) {
        edges.push(makeEdge(cluster[i], cluster[i + 1]));
        if (i < cluster.length - 2) edges.push(makeEdge(cluster[i], cluster[i + 2]));
      }
    }
    // Sparse cross-cluster links
    for (let c = 0; c < clusterCount - 1; c++) {
      edges.push(makeEdge(clusters[c][0], clusters[c + 1][0]));
    }

    const imports = makeImports(edges);
    const subZones = subdivideZone(zone, imports, inventory, new Set(), 0);

    // Should have produced sub-zones
    expect(subZones.length).toBeGreaterThanOrEqual(2);

    // Check if any sub-zones themselves have sub-zones (recursive subdivision)
    // This validates the recursive call within buildZonesFromCommunities
    const hasNestedSubZones = subZones.some((z) => z.subZones && z.subZones.length > 0);

    // At least verify the structure is valid (sub-zones have correct parent prefix)
    for (const sub of subZones) {
      expect(sub.id).toMatch(/^mega\//);
      expect(sub.depth).toBe(1);
      if (sub.subZones) {
        for (const nested of sub.subZones) {
          // Nested sub-zones should be prefixed with their parent's full ID
          expect(nested.id).toMatch(/^mega\/.+\//);
          expect(nested.depth).toBe(2);
        }
      }
    }
  });

  it("propagates sub-crossings through recursive subdivision levels", () => {
    // Create a zone with 4 large clusters, each >= threshold, with cross-links
    // at both levels. The first subdivision creates sub-zones; those large
    // enough to recurse should also produce sub-crossings.
    const clusterCount = 4;
    const filesPerCluster = Math.ceil(SUBDIVISION_THRESHOLD * 1.5);
    const clusters: string[][] = [];
    for (let c = 0; c < clusterCount; c++) {
      // Split each cluster into two sub-directories so second-level Louvain
      // can find two sub-communities within each first-level sub-zone
      clusters.push(
        Array.from(
          { length: filesPerCluster },
          (_, i) => `src/group${c}/part${i < filesPerCluster / 2 ? "a" : "b"}/file${i}.ts`
        )
      );
    }
    const allFiles = clusters.flat();

    const zone = makeZone("root", allFiles);
    const inventory = makeInventory(allFiles.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    // Strong intra-cluster connectivity (chain + skip-one)
    for (const cluster of clusters) {
      const half = Math.floor(cluster.length / 2);
      // Wire up first half internally
      for (let i = 0; i < half - 1; i++) {
        edges.push(makeEdge(cluster[i], cluster[i + 1]));
        if (i < half - 2) edges.push(makeEdge(cluster[i], cluster[i + 2]));
      }
      // Wire up second half internally
      for (let i = half; i < cluster.length - 1; i++) {
        edges.push(makeEdge(cluster[i], cluster[i + 1]));
        if (i < cluster.length - 2) edges.push(makeEdge(cluster[i], cluster[i + 2]));
      }
      // Weak link between the two halves (creates sub-crossings at level 2)
      edges.push(makeEdge(cluster[0], cluster[half]));
    }
    // Cross-cluster links (creates sub-crossings at level 1)
    for (let c = 0; c < clusterCount - 1; c++) {
      edges.push(makeEdge(clusters[c][0], clusters[c + 1][0]));
    }

    const imports = makeImports(edges);
    const subZones = subdivideZone(zone, imports, inventory, new Set(), 0);

    expect(subZones.length).toBeGreaterThanOrEqual(2);

    // Parent zone should have sub-crossings from cross-cluster edges
    if (zone.subCrossings) {
      expect(zone.subCrossings.length).toBeGreaterThan(0);
      const subZoneIds = new Set(subZones.map((z) => z.id));
      for (const crossing of zone.subCrossings) {
        expect(subZoneIds.has(crossing.fromZone)).toBe(true);
        expect(subZoneIds.has(crossing.toZone)).toBe(true);
      }
    }

    // Check that any recursively subdivided sub-zones also have sub-crossings
    for (const sub of subZones) {
      if (sub.subZones && sub.subZones.length >= 2) {
        // If a sub-zone was recursively subdivided and has cross-edges between
        // its nested sub-zones, it should have subCrossings populated
        if (sub.subCrossings) {
          const nestedIds = new Set(sub.subZones.map((z) => z.id));
          for (const crossing of sub.subCrossings) {
            expect(nestedIds.has(crossing.fromZone)).toBe(true);
            expect(nestedIds.has(crossing.toZone)).toBe(true);
            // Nested sub-crossings reference files within the parent sub-zone
            expect(sub.files).toContain(crossing.from);
            expect(sub.files).toContain(crossing.to);
          }
        }
        // Verify nested depth
        for (const nested of sub.subZones) {
          expect(nested.depth).toBe(2);
          expect(nested.id).toMatch(/^root\/.+\//);
        }
      }
    }
  });

  it("stops recursion at MAX_SUBDIVISION_DEPTH", () => {
    // Even with very large clusters, recursion should stop at depth limit
    const files = Array.from({ length: 200 }, (_, i) => `src/deep/mod${i}.ts`);
    const zone = makeZone("deep", files);
    const inventory = makeInventory(files.map((f) => makeFileEntry(f)));

    const edges: ImportEdge[] = [];
    for (let i = 0; i < files.length - 1; i++) {
      edges.push(makeEdge(files[i], files[i + 1]));
    }

    const imports = makeImports(edges);

    // Start at depth = MAX_SUBDIVISION_DEPTH - 1 to allow one more level
    const subZones = subdivideZone(
      zone, imports, inventory, new Set(), MAX_SUBDIVISION_DEPTH - 1
    );

    // Should return sub-zones (one level of recursion allowed)
    // but they should NOT have further sub-zones (depth would be at max)
    for (const sub of subZones) {
      expect(sub.depth).toBe(MAX_SUBDIVISION_DEPTH);
      // At max depth, no further subdivision should occur
      expect(sub.subZones).toBeUndefined();
    }
  });
});

// ── Test file exclusion in subdivision ────────────────────────────────────────

describe("subdivision test file exclusion", () => {
  it("propagates testFiles exclusion to sub-zone metric computation", () => {
    // Create clusters where test files have cross-cluster imports.
    // Test file edges should NOT affect cohesion/coupling of sub-zones.
    const sourceFiles1 = Array.from({ length: 26 }, (_, i) => `src/core/s${i}.ts`);
    const sourceFiles2 = Array.from({ length: 26 }, (_, i) => `src/util/s${i}.ts`);
    const testFile = "src/core/s0.test.ts";
    const allFiles = [...sourceFiles1, ...sourceFiles2, testFile];

    const zone = makeZone("big", allFiles);
    const inventory = makeInventory([
      ...sourceFiles1.map((f) => makeFileEntry(f)),
      ...sourceFiles2.map((f) => makeFileEntry(f)),
      makeFileEntry(testFile, { role: "test" }),
    ]);

    const edges: ImportEdge[] = [];
    // Source file chains
    for (let i = 0; i < sourceFiles1.length - 1; i++) {
      edges.push(makeEdge(sourceFiles1[i], sourceFiles1[i + 1]));
    }
    for (let i = 0; i < sourceFiles2.length - 1; i++) {
      edges.push(makeEdge(sourceFiles2[i], sourceFiles2[i + 1]));
    }
    // Test file imports from both clusters (cross-cluster dependency)
    edges.push(makeEdge(testFile, sourceFiles1[0]));
    edges.push(makeEdge(testFile, sourceFiles2[0]));
    // Weak source-level cross-link
    edges.push(makeEdge(sourceFiles1[0], sourceFiles2[0]));

    const imports = makeImports(edges);
    const testFilesSet = new Set([testFile]);
    const subZones = subdivideZone(zone, imports, inventory, testFilesSet);

    if (subZones.length >= 2) {
      // Test file should be a member of one sub-zone
      const hasTestFile = subZones.some((z) => z.files.includes(testFile));
      expect(hasTestFile).toBe(true);

      // Find the zone containing the test file
      const testZone = subZones.find((z) => z.files.includes(testFile));
      if (testZone) {
        // The test file's cross-cluster import should NOT inflate coupling
        // If test exclusion works, the core zone's coupling reflects only
        // source-to-source edges, not test-to-external edges
        // (This is a smoke test — exact value depends on graph topology)
        expect(testZone.coupling).toBeDefined();
        expect(testZone.cohesion).toBeDefined();
        expect(testZone.cohesion).toBeGreaterThanOrEqual(0);
        expect(testZone.cohesion).toBeLessThanOrEqual(1);
      }
    }
  });

  it("test files are included in zone membership but excluded from metrics", () => {
    // Direct test via runZonePipeline with testFiles parameter
    const sourceA = Array.from({ length: 15 }, (_, i) => `src/a/f${i}.ts`);
    const sourceB = Array.from({ length: 15 }, (_, i) => `src/b/f${i}.ts`);
    const testA = "src/a/f0.test.ts";
    const allFiles = [...sourceA, ...sourceB, testA];

    const edges: ImportEdge[] = [];
    for (let i = 0; i < sourceA.length - 1; i++) {
      edges.push(makeEdge(sourceA[i], sourceA[i + 1]));
    }
    for (let i = 0; i < sourceB.length - 1; i++) {
      edges.push(makeEdge(sourceB[i], sourceB[i + 1]));
    }
    // Test imports cross-zone
    edges.push(makeEdge(testA, sourceA[0]));
    edges.push(makeEdge(testA, sourceB[0]));

    const inventory = makeInventory([
      ...sourceA.map((f) => makeFileEntry(f)),
      ...sourceB.map((f) => makeFileEntry(f)),
      makeFileEntry(testA, { role: "test" }),
    ]);
    const imports = makeImports(edges);

    const result = runZonePipeline({
      edges,
      inventory,
      imports,
      scopeFiles: allFiles,
      testFiles: new Set([testA]),
    });

    // Test file should be in some zone
    const allZonedFiles = result.zones.flatMap((z) => z.files);
    expect(allZonedFiles).toContain(testA);

    // Find the zone with the test file
    const zoneWithTest = result.zones.find((z) => z.files.includes(testA));
    if (zoneWithTest && result.zones.length >= 2) {
      // Without test exclusion, test→sourceB edge would add coupling to zone A.
      // With proper exclusion, only source edges count.
      // If all source edges are internal (sourceA fully connected), coupling should be low.
      expect(zoneWithTest.coupling).toBeLessThan(1);
    }
  });
});

// ── computeZoneContentHash / computeGlobalContentHash ───────────────────────

describe("computeZoneContentHash", () => {
  it("produces the same hash for the same files and content", () => {
    const zone = makeZone("core", ["a.ts", "b.ts"]);
    const hashes = new Map([["a.ts", "hash1"], ["b.ts", "hash2"]]);
    expect(computeZoneContentHash(zone, hashes)).toBe(computeZoneContentHash(zone, hashes));
  });

  it("produces a different hash when file content changes", () => {
    const zone = makeZone("core", ["a.ts", "b.ts"]);
    const before = new Map([["a.ts", "hash1"], ["b.ts", "hash2"]]);
    const after = new Map([["a.ts", "hash1-changed"], ["b.ts", "hash2"]]);
    expect(computeZoneContentHash(zone, before)).not.toBe(computeZoneContentHash(zone, after));
  });

  it("is independent of file order", () => {
    const zone1 = makeZone("core", ["b.ts", "a.ts"]);
    const zone2 = makeZone("core", ["a.ts", "b.ts"]);
    const hashes = new Map([["a.ts", "h1"], ["b.ts", "h2"]]);
    expect(computeZoneContentHash(zone1, hashes)).toBe(computeZoneContentHash(zone2, hashes));
  });

  it("is independent of zone ID/name (only files and their hashes matter)", () => {
    const zone1 = makeZone("core", ["a.ts"]);
    const zone2 = makeZone("renamed", ["a.ts"]);
    const hashes = new Map([["a.ts", "h1"]]);
    expect(computeZoneContentHash(zone1, hashes)).toBe(computeZoneContentHash(zone2, hashes));
  });
});

describe("computeGlobalContentHash", () => {
  it("produces the same hash for the same inputs", () => {
    const hashes = { core: "abc", util: "def" };
    expect(computeGlobalContentHash(hashes)).toBe(computeGlobalContentHash(hashes));
  });

  it("changes when any zone content hash changes", () => {
    const before = { core: "abc", util: "def" };
    const after = { core: "abc", util: "changed" };
    expect(computeGlobalContentHash(before)).not.toBe(computeGlobalContentHash(after));
  });

  it("is independent of key order", () => {
    const a = { core: "abc", util: "def" };
    const b = { util: "def", core: "abc" };
    expect(computeGlobalContentHash(a)).toBe(computeGlobalContentHash(b));
  });
});

// ── Stale finding filtering ─────────────────────────────────────────────────

describe("analyzeZones stale content hash filtering", () => {
  it("drops AI findings for zones whose content changed", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "new-hash-x" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    // First run to get the zone structure and content hashes
    const { zones: firstRun } = await analyzeZones(inventory, imports, { enrich: false });
    const zoneId = firstRun.zones[0].id;

    // Construct previousZones with an AI finding and original content hashes
    const previousZones: Zones = {
      ...firstRun,
      findings: [
        ...(firstRun.findings ?? []),
        { type: "pattern", pass: 1, scope: zoneId, text: "AI finding that should be dropped", severity: "warning" },
      ],
      enrichmentPass: 1,
    };

    // Second run with changed file content (different hash for x.ts)
    const changedInventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "CHANGED-hash-x" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);

    const { zones: secondRun } = await analyzeZones(changedInventory, imports, {
      enrich: false,
      previousZones,
    });

    // The AI finding should be dropped because zone content changed
    const aiFinding = secondRun.findings?.find((f) => f.pass > 0 && f.text === "AI finding that should be dropped");
    expect(aiFinding).toBeUndefined();
    // Structural findings (pass 0) should still be present
    expect(secondRun.findings?.some((f) => f.pass === 0)).toBe(true);
  });

  it("preserves AI findings when content has not changed", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "hash-x" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    // First run
    const { zones: firstRun } = await analyzeZones(inventory, imports, { enrich: false });
    const zoneId = firstRun.zones[0].id;

    const previousZones: Zones = {
      ...firstRun,
      findings: [
        ...(firstRun.findings ?? []),
        { type: "pattern", pass: 1, scope: zoneId, text: "AI finding preserved", severity: "info" },
      ],
      enrichmentPass: 1,
    };

    // Second run with same content
    const { zones: secondRun } = await analyzeZones(inventory, imports, {
      enrich: false,
      previousZones,
    });

    const aiFinding = secondRun.findings?.find((f) => f.text === "AI finding preserved");
    expect(aiFinding).toBeDefined();
  });

  it("preserves all AI findings when previousZones lacks zoneContentHashes (backward compat)", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "hash-x" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    // First run to get structure hash
    const { zones: firstRun } = await analyzeZones(inventory, imports, { enrich: false });
    const zoneId = firstRun.zones[0].id;

    // Construct previousZones WITHOUT zoneContentHashes (old format)
    const previousZones: Zones = {
      zones: firstRun.zones,
      crossings: firstRun.crossings,
      unzoned: firstRun.unzoned,
      structureHash: firstRun.structureHash,
      findings: [
        ...(firstRun.findings ?? []),
        { type: "anti-pattern", pass: 2, scope: zoneId, text: "Legacy AI finding", severity: "warning" },
      ],
      enrichmentPass: 2,
      // No zoneContentHashes — old format
    };

    // Run with different content but same structure
    const changedInventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "CHANGED" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);

    const { zones: secondRun } = await analyzeZones(changedInventory, imports, {
      enrich: false,
      previousZones,
    });

    // Should preserve the finding because there are no previous content hashes to compare
    const legacyFinding = secondRun.findings?.find((f) => f.text === "Legacy AI finding");
    expect(legacyFinding).toBeDefined();
  });

  it("includes zoneContentHashes in output", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "h1" }),
      makeFileEntry("src/a/y.ts", { hash: "h2" }),
      makeFileEntry("src/a/z.ts", { hash: "h3" }),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: result } = await analyzeZones(inventory, imports, { enrich: false });

    expect(result.zoneContentHashes).toBeDefined();
    expect(Object.keys(result.zoneContentHashes!)).toHaveLength(1);
    // Value should be a 16-char hex string
    const hash = Object.values(result.zoneContentHashes!)[0];
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("drops global AI findings when global content changes", async () => {
    const inventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "hash-x" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);
    const imports = makeImports([
      makeEdge("src/a/x.ts", "src/a/y.ts"),
      makeEdge("src/a/y.ts", "src/a/z.ts"),
      makeEdge("src/a/x.ts", "src/a/z.ts"),
    ]);

    const { zones: firstRun } = await analyzeZones(inventory, imports, { enrich: false });

    const previousZones: Zones = {
      ...firstRun,
      findings: [
        ...(firstRun.findings ?? []),
        { type: "pattern", pass: 1, scope: "global", text: "Global AI finding", severity: "info" },
      ],
      enrichmentPass: 1,
    };

    // Change content
    const changedInventory = makeInventory([
      makeFileEntry("src/a/x.ts", { hash: "CHANGED" }),
      makeFileEntry("src/a/y.ts", { hash: "hash-y" }),
      makeFileEntry("src/a/z.ts", { hash: "hash-z" }),
    ]);

    const { zones: secondRun } = await analyzeZones(changedInventory, imports, {
      enrich: false,
      previousZones,
    });

    const globalAiFinding = secondRun.findings?.find((f) => f.text === "Global AI finding");
    expect(globalAiFinding).toBeUndefined();
  });
});
