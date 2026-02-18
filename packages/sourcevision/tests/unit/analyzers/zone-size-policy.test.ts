import { describe, it, expect } from "vitest";
import {
  buildUndirectedGraph,
  splitLargeCommunities,
  louvainPhase1,
  mergeSmallCommunities,
  capZoneCount,
} from "../../../src/analyzers/louvain.js";
import { analyzeZones } from "../../../src/analyzers/zones.js";
import {
  makeFileEntry,
  makeInventory,
  makeEdge,
  makeImports,
} from "./zones-helpers.js";

// ── splitLargeCommunities ────────────────────────────────────────────────────

describe("splitLargeCommunities", () => {
  it("leaves communities under the size limit unchanged", () => {
    const graph = buildUndirectedGraph([
      makeEdge("a.ts", "b.ts"),
      makeEdge("b.ts", "c.ts"),
    ]);

    // All 3 nodes in one community
    const community = new Map<string, string>();
    community.set("a.ts", "a.ts");
    community.set("b.ts", "a.ts");
    community.set("c.ts", "a.ts");

    const result = splitLargeCommunities(community, graph, 5);

    // Should stay as one community
    const comms = new Set(result.values());
    expect(comms.size).toBe(1);
  });

  it("splits a community that exceeds the size limit", () => {
    // Create two distinct clusters forced into one community
    const edges = [
      // Cluster A: tightly connected
      makeEdge("src/a/1.ts", "src/a/2.ts", ["x", "y", "z"]),
      makeEdge("src/a/2.ts", "src/a/3.ts", ["x", "y", "z"]),
      makeEdge("src/a/1.ts", "src/a/3.ts", ["x", "y", "z"]),
      makeEdge("src/a/3.ts", "src/a/4.ts", ["x", "y", "z"]),
      makeEdge("src/a/1.ts", "src/a/4.ts", ["x", "y", "z"]),
      // Cluster B: tightly connected
      makeEdge("src/b/1.ts", "src/b/2.ts", ["x", "y", "z"]),
      makeEdge("src/b/2.ts", "src/b/3.ts", ["x", "y", "z"]),
      makeEdge("src/b/1.ts", "src/b/3.ts", ["x", "y", "z"]),
      makeEdge("src/b/3.ts", "src/b/4.ts", ["x", "y", "z"]),
      makeEdge("src/b/1.ts", "src/b/4.ts", ["x", "y", "z"]),
      // Weak cross-cluster link
      makeEdge("src/a/1.ts", "src/b/1.ts"),
    ];

    const graph = buildUndirectedGraph(edges);

    // Force all into one community
    const community = new Map<string, string>();
    for (const node of graph.keys()) {
      community.set(node, "root");
    }

    // maxSize=5 means a community of 8 should be split
    const result = splitLargeCommunities(community, graph, 5);

    const comms = new Set(result.values());
    expect(comms.size).toBe(2);
  });

  it("does not split a monolithic community that Louvain cannot subdivide", () => {
    // Fully connected graph — Louvain will find only 1 community
    const edges = [
      makeEdge("a.ts", "b.ts"),
      makeEdge("a.ts", "c.ts"),
      makeEdge("a.ts", "d.ts"),
      makeEdge("b.ts", "c.ts"),
      makeEdge("b.ts", "d.ts"),
      makeEdge("c.ts", "d.ts"),
    ];

    const graph = buildUndirectedGraph(edges);

    const community = new Map<string, string>();
    for (const node of graph.keys()) {
      community.set(node, "root");
    }

    // maxSize=2 but it's a complete graph — can't meaningfully split
    const result = splitLargeCommunities(community, graph, 2);

    // Should remain as 1 community since Louvain finds no meaningful split
    const comms = new Set(result.values());
    expect(comms.size).toBe(1);
  });

  it("is deterministic", () => {
    const edges = [
      makeEdge("src/a/1.ts", "src/a/2.ts", ["x", "y", "z"]),
      makeEdge("src/a/2.ts", "src/a/3.ts", ["x", "y", "z"]),
      makeEdge("src/a/1.ts", "src/a/3.ts", ["x", "y", "z"]),
      makeEdge("src/b/1.ts", "src/b/2.ts", ["x", "y", "z"]),
      makeEdge("src/b/2.ts", "src/b/3.ts", ["x", "y", "z"]),
      makeEdge("src/b/1.ts", "src/b/3.ts", ["x", "y", "z"]),
      makeEdge("src/a/1.ts", "src/b/1.ts"),
    ];

    const graph = buildUndirectedGraph(edges);

    const community = new Map<string, string>();
    for (const node of graph.keys()) {
      community.set(node, "root");
    }

    const result1 = splitLargeCommunities(community, graph, 4);
    const result2 = splitLargeCommunities(new Map(community), graph, 4);

    expect([...result1.entries()].sort()).toEqual([...result2.entries()].sort());
  });

  it("only splits communities that exceed the limit, leaving smaller ones intact", () => {
    const edges = [
      // Small community A (3 nodes)
      makeEdge("a/1.ts", "a/2.ts"),
      makeEdge("a/2.ts", "a/3.ts"),
      // Large community B (6 nodes, two sub-clusters)
      makeEdge("b/1.ts", "b/2.ts", ["x", "y", "z"]),
      makeEdge("b/2.ts", "b/3.ts", ["x", "y", "z"]),
      makeEdge("b/1.ts", "b/3.ts", ["x", "y", "z"]),
      makeEdge("b/4.ts", "b/5.ts", ["x", "y", "z"]),
      makeEdge("b/5.ts", "b/6.ts", ["x", "y", "z"]),
      makeEdge("b/4.ts", "b/6.ts", ["x", "y", "z"]),
      makeEdge("b/1.ts", "b/4.ts"),
    ];

    const graph = buildUndirectedGraph(edges);

    const community = new Map<string, string>();
    // Small community
    community.set("a/1.ts", "commA");
    community.set("a/2.ts", "commA");
    community.set("a/3.ts", "commA");
    // Large community
    community.set("b/1.ts", "commB");
    community.set("b/2.ts", "commB");
    community.set("b/3.ts", "commB");
    community.set("b/4.ts", "commB");
    community.set("b/5.ts", "commB");
    community.set("b/6.ts", "commB");

    // maxSize=4 means commA (3) stays, commB (6) gets split
    const result = splitLargeCommunities(community, graph, 4);

    // commA should remain intact
    expect(result.get("a/1.ts")).toBe("commA");
    expect(result.get("a/2.ts")).toBe("commA");
    expect(result.get("a/3.ts")).toBe("commA");

    // commB should be split into multiple sub-communities
    const bComms = new Set([
      result.get("b/1.ts"),
      result.get("b/2.ts"),
      result.get("b/3.ts"),
      result.get("b/4.ts"),
      result.get("b/5.ts"),
      result.get("b/6.ts"),
    ]);
    expect(bComms.size).toBe(2);
  });
});

// ── Integration: maxZonePercent option ────────────────────────────────────────

describe("analyzeZones maxZonePercent", () => {
  it("splits a dominant zone when maxZonePercent is set", async () => {
    // Create a graph with two natural clusters of very different sizes.
    // The large cluster (8 files) would normally dominate.
    const inventory = makeInventory([
      // Large cluster
      makeFileEntry("src/web/a.ts"),
      makeFileEntry("src/web/b.ts"),
      makeFileEntry("src/web/c.ts"),
      makeFileEntry("src/web/d.ts"),
      makeFileEntry("src/web/e.ts"),
      makeFileEntry("src/web/f.ts"),
      makeFileEntry("src/web/g.ts"),
      makeFileEntry("src/web/h.ts"),
      // Separate small cluster
      makeFileEntry("src/api/x.ts"),
      makeFileEntry("src/api/y.ts"),
      makeFileEntry("src/api/z.ts"),
    ]);

    // Web files form two sub-clusters connected by a weak link
    const imports = makeImports([
      // Sub-cluster 1: web/a-d
      makeEdge("src/web/a.ts", "src/web/b.ts", ["x", "y", "z"]),
      makeEdge("src/web/b.ts", "src/web/c.ts", ["x", "y", "z"]),
      makeEdge("src/web/c.ts", "src/web/d.ts", ["x", "y", "z"]),
      makeEdge("src/web/a.ts", "src/web/d.ts", ["x", "y", "z"]),
      makeEdge("src/web/a.ts", "src/web/c.ts", ["x", "y", "z"]),
      makeEdge("src/web/b.ts", "src/web/d.ts", ["x", "y", "z"]),
      // Sub-cluster 2: web/e-h
      makeEdge("src/web/e.ts", "src/web/f.ts", ["x", "y", "z"]),
      makeEdge("src/web/f.ts", "src/web/g.ts", ["x", "y", "z"]),
      makeEdge("src/web/g.ts", "src/web/h.ts", ["x", "y", "z"]),
      makeEdge("src/web/e.ts", "src/web/h.ts", ["x", "y", "z"]),
      makeEdge("src/web/e.ts", "src/web/g.ts", ["x", "y", "z"]),
      makeEdge("src/web/f.ts", "src/web/h.ts", ["x", "y", "z"]),
      // Weak link between web sub-clusters
      makeEdge("src/web/a.ts", "src/web/e.ts"),
      // API cluster
      makeEdge("src/api/x.ts", "src/api/y.ts", ["x", "y", "z"]),
      makeEdge("src/api/y.ts", "src/api/z.ts", ["x", "y", "z"]),
      makeEdge("src/api/x.ts", "src/api/z.ts", ["x", "y", "z"]),
    ]);

    // Without zone size cap, web files should cluster together (~73%)
    const { zones: uncapped } = await analyzeZones(inventory, imports, {
      enrich: false,
      maxZonePercent: 100,
    });

    // With a 50% cap, the large web zone should be split
    const { zones: capped } = await analyzeZones(inventory, imports, {
      enrich: false,
      maxZonePercent: 50,
    });

    // The capped result should have more zones than uncapped
    expect(capped.zones.length).toBeGreaterThanOrEqual(uncapped.zones.length);

    // No zone in the capped result should exceed ~50% of total files
    const totalFiles = inventory.files.length;
    const maxAllowed = Math.ceil(totalFiles * 0.5);
    for (const zone of capped.zones) {
      expect(zone.files.length).toBeLessThanOrEqual(maxAllowed + 1); // +1 for rounding
    }
  });

  it("defaults to 30% max zone size", async () => {
    // Create four distinct clusters that naturally split under 30% policy.
    // 20 files total → 30% = max 6 files per zone.
    // Without the policy, two weak bridges might merge clusters.
    const inventory = makeInventory([
      // Cluster A (5 files) — separate directory
      ...["a1", "a2", "a3", "a4", "a5"].map(f => makeFileEntry(`packages/alpha/src/${f}.ts`)),
      // Cluster B (5 files) — separate directory
      ...["b1", "b2", "b3", "b4", "b5"].map(f => makeFileEntry(`packages/beta/src/${f}.ts`)),
      // Cluster C (5 files) — separate directory
      ...["c1", "c2", "c3", "c4", "c5"].map(f => makeFileEntry(`packages/gamma/src/${f}.ts`)),
      // Cluster D (5 files) — separate directory
      ...["d1", "d2", "d3", "d4", "d5"].map(f => makeFileEntry(`packages/delta/src/${f}.ts`)),
    ]);

    const edges = [
      // Cluster A: tightly connected chain
      ...["a1", "a2", "a3", "a4", "a5"].flatMap((from, i, arr) =>
        arr.slice(i + 1).map(to =>
          makeEdge(`packages/alpha/src/${from}.ts`, `packages/alpha/src/${to}.ts`, ["x", "y", "z"])
        )
      ),
      // Cluster B: tightly connected chain
      ...["b1", "b2", "b3", "b4", "b5"].flatMap((from, i, arr) =>
        arr.slice(i + 1).map(to =>
          makeEdge(`packages/beta/src/${from}.ts`, `packages/beta/src/${to}.ts`, ["x", "y", "z"])
        )
      ),
      // Cluster C: tightly connected
      ...["c1", "c2", "c3", "c4", "c5"].flatMap((from, i, arr) =>
        arr.slice(i + 1).map(to =>
          makeEdge(`packages/gamma/src/${from}.ts`, `packages/gamma/src/${to}.ts`, ["x", "y", "z"])
        )
      ),
      // Cluster D: tightly connected
      ...["d1", "d2", "d3", "d4", "d5"].flatMap((from, i, arr) =>
        arr.slice(i + 1).map(to =>
          makeEdge(`packages/delta/src/${from}.ts`, `packages/delta/src/${to}.ts`, ["x", "y", "z"])
        )
      ),
      // Weak bridges between clusters
      makeEdge("packages/alpha/src/a1.ts", "packages/beta/src/b1.ts"),
      makeEdge("packages/gamma/src/c1.ts", "packages/delta/src/d1.ts"),
    ];
    const imports = makeImports(edges);

    // Default (30%) should ensure no zone exceeds ceil(20 * 0.30) = 6 files
    const { zones: result } = await analyzeZones(inventory, imports, {
      enrich: false,
    });

    const maxAllowed = Math.ceil(inventory.files.length * 0.3);
    for (const zone of result.zones) {
      expect(zone.files.length).toBeLessThanOrEqual(maxAllowed);
    }

    // Should have at least 4 zones (one per cluster)
    expect(result.zones.length).toBeGreaterThanOrEqual(4);
  });
});
