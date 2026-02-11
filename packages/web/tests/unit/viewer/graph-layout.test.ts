import { describe, it, expect } from "vitest";
import {
  computeForceParams,
  hashPosition,
  initZoneClusteredPositions,
  computeZoneCentroids,
  applyZoneCentroidRepulsion,
  type PhysicsNode,
  type PhysicsLink,
  type SimState,
  tick,
  type TickCallbacks,
} from "../../../src/viewer/graph/physics.js";

// ── computeForceParams ───────────────────────────────────────────────────────

describe("computeForceParams", () => {
  it("returns all required parameters", () => {
    const params = computeForceParams(50);
    expect(params.alphaDecay).toBe(0.02);
    expect(params.velocityDecay).toBe(0.6);
    expect(params.repulsionStrength).toBeLessThan(0);
    expect(params.centerGravityStrength).toBe(0.01);
    expect(params.linkRestLength).toBeGreaterThan(0);
    expect(params.crossZoneLinkMultiplier).toBeGreaterThan(1);
    expect(params.zoneCohesionStrength).toBeGreaterThan(0);
    expect(params.zoneRepulsionStrength).toBeLessThan(0);
  });

  it("cross-zone multiplier is > 1 to keep groups separated", () => {
    const params = computeForceParams(100);
    expect(params.crossZoneLinkMultiplier).toBe(2.5);
  });

  it("zone repulsion is stronger than base repulsion", () => {
    const params = computeForceParams(100);
    expect(Math.abs(params.zoneRepulsionStrength)).toBeGreaterThan(
      Math.abs(params.repulsionStrength),
    );
  });

  it("uses Barnes-Hut for large graphs", () => {
    expect(computeForceParams(50).useBH).toBe(false);
    expect(computeForceParams(201).useBH).toBe(true);
  });
});

// ── initZoneClusteredPositions ───────────────────────────────────────────────

describe("initZoneClusteredPositions", () => {
  function makeNodes(zones: Record<string, number>, unzoned = 0): PhysicsNode[] {
    const nodes: PhysicsNode[] = [];
    for (const [zone, count] of Object.entries(zones)) {
      for (let i = 0; i < count; i++) {
        nodes.push({ id: `${zone}/file${i}.ts`, zone });
      }
    }
    for (let i = 0; i < unzoned; i++) {
      nodes.push({ id: `unzoned/file${i}.ts` });
    }
    return nodes;
  }

  it("places zoned nodes near their zone centroid", () => {
    const nodes = makeNodes({ A: 5, B: 5 });
    initZoneClusteredPositions(nodes, 800, 600);

    // All nodes should have positions
    for (const n of nodes) {
      expect(n.x).toBeDefined();
      expect(n.y).toBeDefined();
      expect(n.vx).toBe(0);
      expect(n.vy).toBe(0);
    }

    // Zone A centroid should be different from zone B centroid
    const zoneA = nodes.filter((n) => n.zone === "A");
    const zoneB = nodes.filter((n) => n.zone === "B");
    const centroidA = {
      x: zoneA.reduce((s, n) => s + n.x!, 0) / zoneA.length,
      y: zoneA.reduce((s, n) => s + n.y!, 0) / zoneA.length,
    };
    const centroidB = {
      x: zoneB.reduce((s, n) => s + n.x!, 0) / zoneB.length,
      y: zoneB.reduce((s, n) => s + n.y!, 0) / zoneB.length,
    };
    const dist = Math.hypot(centroidA.x - centroidB.x, centroidA.y - centroidB.y);
    expect(dist).toBeGreaterThan(50); // zones should be well-separated
  });

  it("places unzoned nodes near center", () => {
    const nodes = makeNodes({ A: 3 }, 5);
    initZoneClusteredPositions(nodes, 800, 600);

    const unzoned = nodes.filter((n) => !n.zone);
    for (const n of unzoned) {
      // Should be within 15% of center
      expect(Math.abs(n.x! - 400)).toBeLessThan(800 * 0.15);
      expect(Math.abs(n.y! - 300)).toBeLessThan(600 * 0.15);
    }
  });

  it("produces deterministic positions for the same node id", () => {
    const nodes1 = makeNodes({ A: 3 });
    const nodes2 = makeNodes({ A: 3 });
    initZoneClusteredPositions(nodes1, 800, 600);
    initZoneClusteredPositions(nodes2, 800, 600);

    for (let i = 0; i < nodes1.length; i++) {
      expect(nodes1[i].x).toBe(nodes2[i].x);
      expect(nodes1[i].y).toBe(nodes2[i].y);
    }
  });

  it("separates multiple zones on a circle", () => {
    const nodes = makeNodes({ A: 3, B: 3, C: 3, D: 3 });
    initZoneClusteredPositions(nodes, 800, 600);

    // Each zone pair should be separated
    const zoneIds = ["A", "B", "C", "D"];
    const centroids = new Map<string, { x: number; y: number }>();
    for (const zid of zoneIds) {
      const members = nodes.filter((n) => n.zone === zid);
      centroids.set(zid, {
        x: members.reduce((s, n) => s + n.x!, 0) / members.length,
        y: members.reduce((s, n) => s + n.y!, 0) / members.length,
      });
    }

    for (let i = 0; i < zoneIds.length; i++) {
      for (let j = i + 1; j < zoneIds.length; j++) {
        const ci = centroids.get(zoneIds[i])!;
        const cj = centroids.get(zoneIds[j])!;
        const dist = Math.hypot(ci.x - cj.x, ci.y - cj.y);
        expect(dist).toBeGreaterThan(30);
      }
    }
  });
});

// ── applyZoneCentroidRepulsion ──────────────────────────────────────────────

describe("applyZoneCentroidRepulsion", () => {
  function makeZonedNodes(): PhysicsNode[] {
    return [
      { id: "a1", zone: "A", x: 100, y: 100, vx: 0, vy: 0 },
      { id: "a2", zone: "A", x: 120, y: 100, vx: 0, vy: 0 },
      { id: "b1", zone: "B", x: 300, y: 100, vx: 0, vy: 0 },
      { id: "b2", zone: "B", x: 320, y: 100, vx: 0, vy: 0 },
    ];
  }

  it("pushes zones apart", () => {
    const nodes = makeZonedNodes();
    const centroids = computeZoneCentroids(nodes);
    applyZoneCentroidRepulsion(nodes, centroids, -500, 1.0);

    // Zone A nodes should get negative vx (pushed left, away from B)
    expect(nodes[0].vx!).toBeLessThan(0);
    expect(nodes[1].vx!).toBeLessThan(0);
    // Zone B nodes should get positive vx (pushed right, away from A)
    expect(nodes[2].vx!).toBeGreaterThan(0);
    expect(nodes[3].vx!).toBeGreaterThan(0);
  });

  it("distributes force equally among zone members", () => {
    const nodes = makeZonedNodes();
    const centroids = computeZoneCentroids(nodes);
    applyZoneCentroidRepulsion(nodes, centroids, -500, 1.0);

    // Both members of zone A should receive the same force
    expect(nodes[0].vx).toBe(nodes[1].vx);
    expect(nodes[0].vy).toBe(nodes[1].vy);
  });

  it("does nothing with fewer than 2 zones", () => {
    const nodes: PhysicsNode[] = [
      { id: "a1", zone: "A", x: 100, y: 100, vx: 0, vy: 0 },
    ];
    const centroids = computeZoneCentroids(nodes);
    applyZoneCentroidRepulsion(nodes, centroids, -500, 1.0);
    expect(nodes[0].vx).toBe(0);
    expect(nodes[0].vy).toBe(0);
  });

  it("applies stronger force when zones are closer", () => {
    const close = makeZonedNodes();
    close[2].x = 150; close[3].x = 170; // B close to A
    const closeCentroids = computeZoneCentroids(close);
    applyZoneCentroidRepulsion(close, closeCentroids, -500, 1.0);

    const far = makeZonedNodes(); // B is at 300/320
    const farCentroids = computeZoneCentroids(far);
    applyZoneCentroidRepulsion(far, farCentroids, -500, 1.0);

    // Force on close zones should be stronger (higher magnitude vx)
    expect(Math.abs(close[0].vx!)).toBeGreaterThan(Math.abs(far[0].vx!));
  });

  it("respects alpha multiplier", () => {
    const nodes1 = makeZonedNodes();
    const c1 = computeZoneCentroids(nodes1);
    applyZoneCentroidRepulsion(nodes1, c1, -500, 1.0);

    const nodes2 = makeZonedNodes();
    const c2 = computeZoneCentroids(nodes2);
    applyZoneCentroidRepulsion(nodes2, c2, -500, 0.5);

    // Half alpha should produce half the force
    expect(Math.abs(nodes2[0].vx!)).toBeCloseTo(Math.abs(nodes1[0].vx!) * 0.5, 5);
  });
});

// ── tick: cross-zone link rest length ────────────────────────────────────────

describe("tick with cross-zone links", () => {
  it("uses longer rest length for cross-zone links", () => {
    // Setup: Two nodes in different zones, connected by a cross-zone link
    // at a distance equal to the base linkRestLength.
    // The cross-zone link should want to push them further apart.
    const nodeA: PhysicsNode = { id: "a", zone: "A", x: 200, y: 300, vx: 0, vy: 0 };
    const nodeB: PhysicsNode = { id: "b", zone: "B", x: 260, y: 300, vx: 0, vy: 0 };
    const crossLink: PhysicsLink = { source: nodeA, target: nodeB, crossZone: true };

    const simCross: SimState = {
      nodes: [nodeA, nodeB],
      resolvedLinks: [crossLink],
      width: 800, height: 600,
      alpha: { value: 0.5 },
      frameCount: 0,
      hasFitted: false,
      scale: 1,
      nodeRadii: [5, 5],
    };

    // Also setup same scenario with intra-zone link
    const nodeC: PhysicsNode = { id: "c", zone: "A", x: 200, y: 300, vx: 0, vy: 0 };
    const nodeD: PhysicsNode = { id: "d", zone: "A", x: 260, y: 300, vx: 0, vy: 0 };
    const intraLink: PhysicsLink = { source: nodeC, target: nodeD, crossZone: false };

    const simIntra: SimState = {
      nodes: [nodeC, nodeD],
      resolvedLinks: [intraLink],
      width: 800, height: 600,
      alpha: { value: 0.5 },
      frameCount: 0,
      hasFitted: false,
      scale: 1,
      nodeRadii: [5, 5],
    };

    const noopCallbacks: TickCallbacks = {
      updateDOM: () => {},
      fitToContent: () => {},
      scheduleNextTick: () => {},
    };

    tick(simCross, noopCallbacks);
    tick(simIntra, noopCallbacks);

    // Cross-zone nodes should be pushed further apart than intra-zone nodes
    // (cross-zone rest length > base rest length, so at distance 60 the
    // cross-zone link tries to expand while intra-zone link may try to contract)
    const crossDist = Math.abs(simCross.nodes[1].x! - simCross.nodes[0].x!);
    const intraDist = Math.abs(simIntra.nodes[1].x! - simIntra.nodes[0].x!);
    expect(crossDist).toBeGreaterThan(intraDist);
  });
});

// ── hashPosition ─────────────────────────────────────────────────────────────

describe("hashPosition", () => {
  it("returns values between 0 and 1", () => {
    for (const id of ["foo.ts", "bar/baz.tsx", "a", ""]) {
      const v = hashPosition(id);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic", () => {
    expect(hashPosition("test.ts")).toBe(hashPosition("test.ts"));
  });

  it("produces different values for different inputs", () => {
    expect(hashPosition("a")).not.toBe(hashPosition("b"));
  });
});

// ── computeZoneCentroids ─────────────────────────────────────────────────────

describe("computeZoneCentroids", () => {
  it("computes average positions per zone", () => {
    const nodes: PhysicsNode[] = [
      { id: "a", zone: "Z", x: 100, y: 200, vx: 0, vy: 0 },
      { id: "b", zone: "Z", x: 200, y: 400, vx: 0, vy: 0 },
    ];
    const centroids = computeZoneCentroids(nodes);
    expect(centroids.get("Z")?.x).toBe(150);
    expect(centroids.get("Z")?.y).toBe(300);
    expect(centroids.get("Z")?.count).toBe(2);
  });

  it("ignores unzoned nodes", () => {
    const nodes: PhysicsNode[] = [
      { id: "a", zone: "Z", x: 100, y: 100, vx: 0, vy: 0 },
      { id: "b", x: 500, y: 500, vx: 0, vy: 0 },
    ];
    const centroids = computeZoneCentroids(nodes);
    expect(centroids.size).toBe(1);
    expect(centroids.get("Z")?.x).toBe(100);
  });
});
