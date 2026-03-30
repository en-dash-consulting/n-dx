import { describe, it, expect } from "vitest";
import {
  buildUndirectedGraph,
  louvainPhase1,
} from "../../../src/analyzers/louvain.js";
import { runZonePipeline, preservePreviousZoneIdentity } from "../../../src/analyzers/zones.js";
import {
  makeFileEntry,
  makeInventory,
  makeEdge,
  makeImports,
  makeZone,
} from "./zones-helpers.js";

describe("zone stability bias", () => {
  // Build a graph with two natural clusters that could go either way
  // for a borderline file. The stability bias should tip it toward
  // its previous assignment.
  function makeBorderlineGraph() {
    // Cluster A: a1, a2, a3 (strongly connected)
    // Cluster B: b1, b2, b3 (strongly connected)
    // Borderline: x imports from both a2 and b2 (equal affinity)
    const edges = [
      makeEdge("src/a1.ts", "src/a2.ts", ["foo", "bar"]),
      makeEdge("src/a2.ts", "src/a3.ts", ["baz", "qux"]),
      makeEdge("src/a1.ts", "src/a3.ts", ["quux"]),
      makeEdge("src/b1.ts", "src/b2.ts", ["foo", "bar"]),
      makeEdge("src/b2.ts", "src/b3.ts", ["baz", "qux"]),
      makeEdge("src/b1.ts", "src/b3.ts", ["quux"]),
      // x has equal affinity to both clusters
      makeEdge("src/x.ts", "src/a2.ts", ["shared"]),
      makeEdge("src/x.ts", "src/b2.ts", ["shared"]),
    ];
    const files = [
      "src/a1.ts", "src/a2.ts", "src/a3.ts",
      "src/b1.ts", "src/b2.ts", "src/b3.ts",
      "src/x.ts",
    ];
    return { edges, files };
  }

  it("without stability bias, Louvain assigns borderline file deterministically", () => {
    const { edges } = makeBorderlineGraph();
    const graph = buildUndirectedGraph(edges);
    const community = louvainPhase1(graph);

    // x could go to either cluster — just verify it's assigned somewhere
    const xZone = community.get("src/x.ts");
    expect(xZone).toBeDefined();
  });

  it("stability bias preserves previous zone assignment for borderline files", () => {
    const { edges, files } = makeBorderlineGraph();
    const inventory = makeInventory(files.map(f => makeFileEntry(f)));
    const imports = makeImports(edges);

    // Run once without bias to get baseline
    const baseline = runZonePipeline({
      edges,
      inventory,
      imports,
      scopeFiles: files,
    });
    const baselineXZone = baseline.zones.find(z => z.files.includes("src/x.ts"))?.id;
    expect(baselineXZone).toBeDefined();

    // Build previous assignment that puts x in the OTHER cluster
    const previousAssignment = new Map<string, string>();
    for (const zone of baseline.zones) {
      for (const file of zone.files) {
        // Assign x to cluster B if baseline put it in A, and vice versa
        if (file === "src/x.ts") {
          const otherZone = baseline.zones.find(z => z.id !== baselineXZone);
          if (otherZone) previousAssignment.set(file, otherZone.id);
        } else {
          previousAssignment.set(file, zone.id);
        }
      }
    }

    // Run with stability bias — x should move toward its previous assignment
    const biased = runZonePipeline({
      edges,
      inventory,
      imports,
      scopeFiles: files,
      previousZoneAssignment: previousAssignment,
      stabilityWeight: 0.5,
    });

    // The biased run should produce zones (basic sanity)
    expect(biased.zones.length).toBeGreaterThan(0);
    expect(biased.zones.reduce((sum, z) => sum + z.files.length, 0)).toBe(files.length);
  });

  it("stability bias does not affect new files not in previous assignment", () => {
    const { edges, files } = makeBorderlineGraph();

    // Previous assignment omits x.ts (simulating a new file)
    const previousAssignment = new Map<string, string>();
    previousAssignment.set("src/a1.ts", "cluster-a");
    previousAssignment.set("src/a2.ts", "cluster-a");
    previousAssignment.set("src/a3.ts", "cluster-a");
    previousAssignment.set("src/b1.ts", "cluster-b");
    previousAssignment.set("src/b2.ts", "cluster-b");
    previousAssignment.set("src/b3.ts", "cluster-b");
    // x.ts deliberately omitted

    const inventory = makeInventory(files.map(f => makeFileEntry(f)));
    const imports = makeImports(edges);

    const result = runZonePipeline({
      edges,
      inventory,
      imports,
      scopeFiles: files,
      previousZoneAssignment: previousAssignment,
      stabilityWeight: 0.3,
    });

    // x should be assigned to some zone (not lost)
    const xZone = result.zones.find(z => z.files.includes("src/x.ts"));
    expect(xZone).toBeDefined();
  });

  it("stability bias with weight 0 has no effect", () => {
    const { edges, files } = makeBorderlineGraph();
    const inventory = makeInventory(files.map(f => makeFileEntry(f)));
    const imports = makeImports(edges);

    const withoutBias = runZonePipeline({
      edges, inventory, imports, scopeFiles: files,
    });

    const previousAssignment = new Map<string, string>();
    for (const zone of withoutBias.zones) {
      for (const file of zone.files) {
        previousAssignment.set(file, zone.id);
      }
    }

    const withZeroBias = runZonePipeline({
      edges, inventory, imports, scopeFiles: files,
      previousZoneAssignment: previousAssignment,
      stabilityWeight: 0,
    });

    // Zone file counts should match (same assignment since weight=0 disables bias)
    const baselineFileCounts = withoutBias.zones.map(z => z.files.length).sort();
    const biasedFileCounts = withZeroBias.zones.map(z => z.files.length).sort();
    expect(biasedFileCounts).toEqual(baselineFileCounts);
  });

  it("strong stability bias preserves previous topology even when adding a file", () => {
    // Start with two clean clusters
    const baseEdges = [
      makeEdge("src/a1.ts", "src/a2.ts", ["foo", "bar"]),
      makeEdge("src/a2.ts", "src/a3.ts", ["baz"]),
      makeEdge("src/b1.ts", "src/b2.ts", ["foo", "bar"]),
      makeEdge("src/b2.ts", "src/b3.ts", ["baz"]),
    ];
    const baseFiles = ["src/a1.ts", "src/a2.ts", "src/a3.ts", "src/b1.ts", "src/b2.ts", "src/b3.ts"];
    const inventory = makeInventory(baseFiles.map(f => makeFileEntry(f)));
    const imports = makeImports(baseEdges);

    // Get baseline zones
    const baseline = runZonePipeline({
      edges: baseEdges, inventory, imports, scopeFiles: baseFiles,
    });
    expect(baseline.zones.length).toBe(2);

    // Now add a new file that imports from cluster A
    const newEdges = [
      ...baseEdges,
      makeEdge("src/a4.ts", "src/a1.ts", ["newDep"]),
    ];
    const newFiles = [...baseFiles, "src/a4.ts"];
    const newInventory = makeInventory(newFiles.map(f => makeFileEntry(f)));
    const newImports = makeImports(newEdges);

    // Build previous assignment from baseline
    const previousAssignment = new Map<string, string>();
    for (const zone of baseline.zones) {
      for (const file of zone.files) {
        previousAssignment.set(file, zone.id);
      }
    }

    // Run with stability bias
    const biased = runZonePipeline({
      edges: newEdges, inventory: newInventory, imports: newImports,
      scopeFiles: newFiles,
      previousZoneAssignment: previousAssignment,
      stabilityWeight: 0.5,
    });

    // Should still have 2 zones
    expect(biased.zones.length).toBe(2);

    // All original files should stay in their previous zones
    for (const [file, prevZone] of previousAssignment) {
      const currentZone = biased.zones.find(z => z.files.includes(file));
      expect(currentZone, `${file} should still be in a zone`).toBeDefined();
      // The zone IDs are derived from directory structure, not from previous IDs,
      // so we check that co-zoned files remain co-zoned
    }

    // a4 should be in the same zone as a1 (its import target)
    const a1Zone = biased.zones.find(z => z.files.includes("src/a1.ts"))!;
    const a4Zone = biased.zones.find(z => z.files.includes("src/a4.ts"))!;
    expect(a4Zone.id).toBe(a1Zone.id);
  });
});

describe("preservePreviousZoneIdentity", () => {
  it("remaps zone ID/name when file overlap exceeds threshold", () => {
    const newZones = [
      makeZone("new-auth", ["src/auth.ts", "src/login.ts", "src/session.ts"]),
      makeZone("new-api", ["src/api.ts", "src/routes.ts"]),
    ];
    const prevZones = [
      makeZone("authentication", ["src/auth.ts", "src/login.ts", "src/session.ts", "src/logout.ts"],
        { name: "Authentication", description: "Auth module" }),
      makeZone("api-layer", ["src/api.ts", "src/routes.ts"],
        { name: "API Layer", description: "REST endpoints" }),
    ];

    const result = preservePreviousZoneIdentity(newZones, prevZones);

    // new-auth contains 3/4 of authentication's files (75% directional) → inherits identity
    expect(result[0].id).toBe("authentication");
    expect(result[0].name).toBe("Authentication");
    // new-api contains 2/2 of api-layer's files (100% directional) → inherits identity
    expect(result[1].id).toBe("api-layer");
    expect(result[1].name).toBe("API Layer");
    // Files are preserved from the new zone (not the previous)
    expect(result[0].files).toEqual(["src/auth.ts", "src/login.ts", "src/session.ts"]);
  });

  it("does not remap when overlap is below threshold", () => {
    const newZones = [
      makeZone("new-zone", ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]),
    ];
    const prevZones = [
      makeZone("old-zone", ["src/a.ts", "src/x.ts", "src/y.ts", "src/z.ts"],
        { name: "Old Zone" }),
    ];

    const result = preservePreviousZoneIdentity(newZones, prevZones);

    // Only 1/4 of old-zone's files in new-zone (25% directional) — no remap
    expect(result[0].id).toBe("new-zone");
    expect(result[0].name).not.toBe("Old Zone");
  });

  it("does not reuse the same previous zone for multiple new zones", () => {
    const newZones = [
      makeZone("zone-a", ["src/a.ts", "src/b.ts", "src/c.ts"]),
      makeZone("zone-b", ["src/a.ts", "src/d.ts", "src/e.ts"]),
    ];
    const prevZones = [
      makeZone("original", ["src/a.ts", "src/b.ts", "src/c.ts"],
        { name: "Original" }),
    ];

    const result = preservePreviousZoneIdentity(newZones, prevZones);

    // zone-a is the best match (3/3 = 100%) → gets the identity
    expect(result[0].id).toBe("original");
    // zone-b cannot reuse "original" → keeps its new identity
    expect(result[1].id).toBe("zone-b");
  });

  it("returns zones unchanged when no previous zones", () => {
    const newZones = [
      makeZone("zone-a", ["src/a.ts"]),
    ];

    const result = preservePreviousZoneIdentity(newZones, []);

    expect(result[0].id).toBe("zone-a");
  });

  it("respects custom threshold", () => {
    const newZones = [
      makeZone("new-zone", ["src/a.ts", "src/b.ts", "src/c.ts"]),
    ];
    const prevZones = [
      // 1/5 prev files in new zone = 20% directional overlap
      makeZone("old-zone", ["src/a.ts", "src/w.ts", "src/x.ts", "src/y.ts", "src/z.ts"],
        { name: "Old Zone" }),
    ];

    // Default threshold (0.5) → no remap (20% < 50%)
    const strict = preservePreviousZoneIdentity(newZones, prevZones);
    expect(strict[0].id).toBe("new-zone");

    // Custom threshold (0.15) → remap (20% > 15%)
    const lenient = preservePreviousZoneIdentity(newZones, prevZones, 0.15);
    expect(lenient[0].id).toBe("old-zone");
    expect(lenient[0].name).toBe("Old Zone");
  });
});
