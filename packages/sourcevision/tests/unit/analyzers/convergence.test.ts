import { describe, it, expect } from "vitest";
import {
  createSnapshot,
  computeDeltas,
  type ZoneMetricSnapshot,
  type ConvergenceReport,
  type DeltaReport,
} from "../../../src/analyzers/convergence.js";
import { makeZone } from "./zones-helpers.js";

describe("createSnapshot", () => {
  it("creates a snapshot from zones with risk metrics", () => {
    const zones = [
      makeZone("zone-a", ["a.ts", "b.ts"], {
        cohesion: 0.8,
        coupling: 0.2,
        riskMetrics: {
          cohesion: 0.8,
          coupling: 0.2,
          riskScore: 0.2,
          riskLevel: "healthy",
          failsThreshold: false,
        },
      }),
      makeZone("zone-b", ["c.ts"], {
        cohesion: 0.3,
        coupling: 0.7,
        riskMetrics: {
          cohesion: 0.3,
          coupling: 0.7,
          riskScore: 0.7,
          riskLevel: "critical",
          failsThreshold: true,
        },
      }),
    ];

    const snapshots = createSnapshot(zones, "abc123");
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      zoneId: "zone-a",
      zoneName: "Zone-a",
      cohesion: 0.8,
      coupling: 0.2,
      riskScore: 0.2,
      fileCount: 2,
      gitSha: "abc123",
    });
    expect(snapshots[1]).toMatchObject({
      zoneId: "zone-b",
      riskScore: 0.7,
    });
  });

  it("computes risk score from cohesion/coupling when riskMetrics absent", () => {
    const zones = [
      makeZone("zone-a", ["a.ts"], { cohesion: 0.6, coupling: 0.4 }),
    ];

    const snapshots = createSnapshot(zones);
    expect(snapshots[0].riskScore).toBeCloseTo(0.4, 2);
  });

  it("includes timestamp", () => {
    const zones = [makeZone("zone-a", ["a.ts"])];
    const snapshots = createSnapshot(zones);
    expect(snapshots[0].timestamp).toBeDefined();
    expect(new Date(snapshots[0].timestamp).getTime()).not.toBeNaN();
  });
});

describe("computeDeltas", () => {
  const ts = new Date().toISOString();

  function snap(id: string, cohesion: number, coupling: number, riskScore: number): ZoneMetricSnapshot {
    return {
      zoneId: id,
      zoneName: id,
      cohesion,
      coupling,
      riskScore,
      fileCount: 5,
      timestamp: ts,
    };
  }

  it("detects improvement in cohesion and coupling", () => {
    const prev = [snap("zone-a", 0.5, 0.6, 0.55)];
    const curr = [snap("zone-a", 0.7, 0.4, 0.35)];

    const delta = computeDeltas(curr, prev);
    expect(delta.zoneDeltas).toHaveLength(1);
    expect(delta.zoneDeltas[0]).toMatchObject({
      zoneId: "zone-a",
      cohesionDelta: 0.2,
      couplingDelta: -0.2,
      riskDelta: -0.2,
      direction: "improved",
    });
  });

  it("detects regression", () => {
    const prev = [snap("zone-a", 0.7, 0.3, 0.3)];
    const curr = [snap("zone-a", 0.4, 0.6, 0.6)];

    const delta = computeDeltas(curr, prev);
    expect(delta.zoneDeltas[0].direction).toBe("regressed");
  });

  it("detects stable zones (no change)", () => {
    const prev = [snap("zone-a", 0.7, 0.3, 0.3)];
    const curr = [snap("zone-a", 0.7, 0.3, 0.3)];

    const delta = computeDeltas(curr, prev);
    expect(delta.zoneDeltas[0].direction).toBe("stable");
  });

  it("reports new zones that didn't exist in previous snapshot", () => {
    const prev = [snap("zone-a", 0.7, 0.3, 0.3)];
    const curr = [
      snap("zone-a", 0.7, 0.3, 0.3),
      snap("zone-b", 0.5, 0.5, 0.5),
    ];

    const delta = computeDeltas(curr, prev);
    expect(delta.newZones).toEqual(["zone-b"]);
  });

  it("reports removed zones", () => {
    const prev = [
      snap("zone-a", 0.7, 0.3, 0.3),
      snap("zone-b", 0.5, 0.5, 0.5),
    ];
    const curr = [snap("zone-a", 0.7, 0.3, 0.3)];

    const delta = computeDeltas(curr, prev);
    expect(delta.removedZones).toEqual(["zone-b"]);
  });

  it("computes overall summary", () => {
    const prev = [
      snap("zone-a", 0.5, 0.6, 0.55),
      snap("zone-b", 0.6, 0.4, 0.4),
    ];
    const curr = [
      snap("zone-a", 0.7, 0.4, 0.35),
      snap("zone-b", 0.6, 0.4, 0.4),
    ];

    const delta = computeDeltas(curr, prev);
    expect(delta.summary.improved).toBe(1);
    expect(delta.summary.regressed).toBe(0);
    expect(delta.summary.stable).toBe(1);
    expect(delta.summary.overallRiskDelta).toBeCloseTo(-0.1, 2);
  });

  it("handles empty previous (first run)", () => {
    const curr = [snap("zone-a", 0.7, 0.3, 0.3)];
    const delta = computeDeltas(curr, []);
    expect(delta.newZones).toEqual(["zone-a"]);
    expect(delta.zoneDeltas).toHaveLength(0);
  });

  it("uses riskDelta threshold of 0.02 for stability detection", () => {
    const prev = [snap("zone-a", 0.71, 0.3, 0.295)];
    const curr = [snap("zone-a", 0.7, 0.31, 0.305)];

    const delta = computeDeltas(curr, prev);
    expect(delta.zoneDeltas[0].direction).toBe("stable");
  });
});
