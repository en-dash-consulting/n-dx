import { describe, it, expect } from "vitest";
import {
  computeRiskScore,
  classifyRiskLevel,
  assessZoneRisk,
  assessAllZoneRisks,
  computeZoneAggregates,
  RISK_THRESHOLDS,
} from "../../../src/analyzers/risk-scoring.js";
import type { Zone, Zones, Finding } from "../../../src/schema/v1.js";

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: "test-zone",
    name: "Test Zone",
    description: "A test zone",
    files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"],
    entryPoints: ["src/a.ts"],
    cohesion: 0.8,
    coupling: 0.2,
    ...overrides,
  };
}

function makeZones(zones: Zone[], findings: Finding[] = []): Zones {
  return {
    zones,
    crossings: [],
    unzoned: [],
    findings,
  };
}

describe("RISK_THRESHOLDS", () => {
  it("has documented default thresholds", () => {
    expect(RISK_THRESHOLDS.cohesionFloor).toBe(0.4);
    expect(RISK_THRESHOLDS.couplingCeiling).toBe(0.6);
  });
});

describe("computeRiskScore", () => {
  it("returns 0 for a perfectly healthy zone", () => {
    expect(computeRiskScore(1.0, 0.0)).toBe(0);
  });

  it("returns 1 for the worst possible zone", () => {
    expect(computeRiskScore(0.0, 1.0)).toBe(1);
  });

  it("returns 0.5 for a zone with average metrics", () => {
    expect(computeRiskScore(0.5, 0.5)).toBe(0.5);
  });

  it("weights low cohesion and high coupling equally", () => {
    // Only cohesion is bad
    const cohesionOnly = computeRiskScore(0.0, 0.0);
    // Only coupling is bad
    const couplingOnly = computeRiskScore(1.0, 1.0);
    expect(cohesionOnly).toBe(0.5);
    expect(couplingOnly).toBe(0.5);
  });

  it("clamps inputs to 0-1 range", () => {
    expect(computeRiskScore(-0.5, 1.5)).toBe(1);
    expect(computeRiskScore(1.5, -0.5)).toBe(0);
  });
});

describe("classifyRiskLevel", () => {
  it("classifies healthy zones", () => {
    expect(classifyRiskLevel(0.8, 0.2)).toBe("healthy");
    expect(classifyRiskLevel(0.9, 0.1)).toBe("healthy");
    expect(classifyRiskLevel(0.5, 0.5)).toBe("healthy");
  });

  it("classifies at-risk zones: low cohesion OR high coupling (but not both)", () => {
    // Low cohesion only
    expect(classifyRiskLevel(0.3, 0.4)).toBe("at-risk");
    // High coupling only
    expect(classifyRiskLevel(0.5, 0.7)).toBe("at-risk");
  });

  it("classifies critical zones: low cohesion AND high coupling", () => {
    expect(classifyRiskLevel(0.35, 0.65)).toBe("critical");
  });

  it("classifies catastrophic zones: very low cohesion AND very high coupling", () => {
    expect(classifyRiskLevel(0.2, 0.8)).toBe("catastrophic");
    expect(classifyRiskLevel(0.1, 0.9)).toBe("catastrophic");
  });

  it("treats threshold boundary values correctly", () => {
    // Exactly at thresholds: cohesion = 0.4, coupling = 0.6 → healthy
    expect(classifyRiskLevel(0.4, 0.6)).toBe("healthy");
    // Just below/above thresholds
    expect(classifyRiskLevel(0.39, 0.61)).toBe("critical");
  });
});

describe("assessZoneRisk", () => {
  it("computes full risk metrics for a zone", () => {
    const zone = makeZone({ cohesion: 0.2, coupling: 0.8 });
    const risk = assessZoneRisk(zone);

    expect(risk.cohesion).toBe(0.2);
    expect(risk.coupling).toBe(0.8);
    expect(risk.riskScore).toBe(0.8);
    expect(risk.riskLevel).toBe("catastrophic");
    expect(risk.failsThreshold).toBe(true);
  });

  it("marks zones passing thresholds", () => {
    const zone = makeZone({ cohesion: 0.8, coupling: 0.2 });
    const risk = assessZoneRisk(zone);

    expect(risk.riskScore).toBeCloseTo(0.2, 10);
    expect(risk.riskLevel).toBe("healthy");
    expect(risk.failsThreshold).toBe(false);
  });
});

describe("assessAllZoneRisks", () => {
  it("returns empty results for empty zones", () => {
    const result = assessAllZoneRisks(makeZones([]));
    expect(result.metrics).toEqual({});
    expect(result.findings).toEqual([]);
  });

  it("computes risk metrics for all zones", () => {
    const zones = [
      makeZone({ id: "healthy", cohesion: 0.8, coupling: 0.2 }),
      makeZone({ id: "risky", cohesion: 0.2, coupling: 0.8 }),
    ];
    const result = assessAllZoneRisks(makeZones(zones));

    expect(result.metrics["healthy"]).toBeDefined();
    expect(result.metrics["risky"]).toBeDefined();
    expect(result.metrics["healthy"].riskLevel).toBe("healthy");
    expect(result.metrics["risky"].riskLevel).toBe("catastrophic");
  });

  it("emits critical finding for catastrophic zones", () => {
    const zones = [
      makeZone({ id: "web-16", name: "Web 16", cohesion: 0.2, coupling: 0.8 }),
    ];
    const result = assessAllZoneRisks(makeZones(zones));

    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const finding = result.findings.find((f) => f.scope === "web-16");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
    expect(finding!.type).toBe("suggestion");
    expect(finding!.pass).toBe(0);
    expect(finding!.text).toContain("catastrophic");
  });

  it("emits warning finding for critical zones", () => {
    const zones = [
      makeZone({ id: "web-8", name: "Web 8", cohesion: 0.35, coupling: 0.65 }),
    ];
    const result = assessAllZoneRisks(makeZones(zones));

    const finding = result.findings.find((f) => f.scope === "web-8");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("warning");
  });

  it("emits info finding for at-risk zones", () => {
    const zones = [
      makeZone({ id: "warn-zone", name: "Warning Zone", cohesion: 0.3, coupling: 0.5 }),
    ];
    const result = assessAllZoneRisks(makeZones(zones));

    const finding = result.findings.find((f) => f.scope === "warn-zone");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("info");
  });

  it("does not emit findings for healthy zones", () => {
    const zones = [
      makeZone({ id: "good", cohesion: 0.8, coupling: 0.2 }),
    ];
    const result = assessAllZoneRisks(makeZones(zones));
    expect(result.findings).toEqual([]);
  });

  it("emits global summary finding when multiple zones fail thresholds", () => {
    const zones = [
      makeZone({ id: "bad-1", name: "Bad 1", cohesion: 0.2, coupling: 0.8 }),
      makeZone({ id: "bad-2", name: "Bad 2", cohesion: 0.3, coupling: 0.7 }),
      makeZone({ id: "bad-3", name: "Bad 3", cohesion: 0.35, coupling: 0.65 }),
    ];
    const result = assessAllZoneRisks(makeZones(zones));

    const global = result.findings.find((f) => f.scope === "global");
    expect(global).toBeDefined();
    expect(global!.severity).toBe("warning");
    expect(global!.text).toContain("3");
    expect(global!.related).toEqual(["bad-1", "bad-2", "bad-3"]);
  });

  it("sorts findings by risk score (worst first)", () => {
    const zones = [
      makeZone({ id: "mild", name: "Mild", cohesion: 0.35, coupling: 0.65 }),
      makeZone({ id: "severe", name: "Severe", cohesion: 0.1, coupling: 0.9 }),
      makeZone({ id: "moderate", name: "Moderate", cohesion: 0.25, coupling: 0.75 }),
    ];
    const result = assessAllZoneRisks(makeZones(zones));

    // Per-zone findings should be ordered by risk score descending
    const perZone = result.findings.filter((f) => f.scope !== "global");
    expect(perZone[0].scope).toBe("severe");
    expect(perZone[1].scope).toBe("moderate");
    expect(perZone[2].scope).toBe("mild");
  });

  it("includes risk score in finding text", () => {
    const zones = [
      makeZone({ id: "risky", name: "Risky Zone", cohesion: 0.2, coupling: 0.8 }),
    ];
    const result = assessAllZoneRisks(makeZones(zones));

    const finding = result.findings.find((f) => f.scope === "risky");
    expect(finding!.text).toContain("0.80");
    expect(finding!.text).toContain("cohesion: 0.20");
    expect(finding!.text).toContain("coupling: 0.80");
  });

  // ── Small zone threshold ────────────────────────────────────────────

  it("downgrades findings for zones below minZoneSize to info", () => {
    const zones = [
      makeZone({
        id: "tiny-zone",
        name: "Tiny Zone",
        cohesion: 0.2,
        coupling: 0.8,
        files: ["src/a.ts", "src/b.ts"],  // 2 files < minZoneSize (5)
      }),
    ];
    const result = assessAllZoneRisks(makeZones(zones));

    const finding = result.findings.find((f) => f.scope === "tiny-zone");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("info");
    expect(finding!.text).toContain("unreliable");
    expect(finding!.text).toContain("2 files");
  });

  it("excludes small zones from global failing-zones summary", () => {
    const zones = [
      makeZone({ id: "big-bad", name: "Big Bad", cohesion: 0.2, coupling: 0.8 }),
      makeZone({
        id: "small-bad",
        name: "Small Bad",
        cohesion: 0.2,
        coupling: 0.8,
        files: ["src/x.ts"],  // 1 file < minZoneSize
      }),
    ];
    const result = assessAllZoneRisks(makeZones(zones));

    // Only 1 non-small failing zone, so no global summary (needs >= 2)
    const global = result.findings.find((f) => f.scope === "global");
    expect(global).toBeUndefined();
  });

  // ── Risk justifications ─────────────────────────────────────────────

  it("downgrades justified zone findings to info severity", () => {
    const zones = [
      makeZone({ id: "bad-zone", name: "Bad Zone", cohesion: 0.2, coupling: 0.8 }),
    ];
    const result = assessAllZoneRisks(makeZones(zones), {
      justifications: [
        { zone: "bad-zone", reason: "Test-heavy zone with inherent external coupling" },
      ],
    });

    const finding = result.findings.find((f) => f.scope === "bad-zone");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("info");
    expect(finding!.text).toContain("justified:");
    expect(finding!.text).toContain("Test-heavy zone");
  });

  it("attaches justification text to risk metrics", () => {
    const zones = [
      makeZone({ id: "justified", name: "Justified", cohesion: 0.2, coupling: 0.8 }),
    ];
    const result = assessAllZoneRisks(makeZones(zones), {
      justifications: [
        { zone: "justified", reason: "Accepted risk" },
      ],
    });

    expect(result.metrics["justified"].riskJustification).toBe("Accepted risk");
  });

  it("does not attach justification to unjustified zones", () => {
    const zones = [
      makeZone({ id: "no-justification", name: "No J", cohesion: 0.2, coupling: 0.8 }),
    ];
    const result = assessAllZoneRisks(makeZones(zones), {
      justifications: [
        { zone: "other-zone", reason: "Not this one" },
      ],
    });

    expect(result.metrics["no-justification"].riskJustification).toBeUndefined();
  });

  it("excludes justified zones from global failing-zones count", () => {
    const zones = [
      makeZone({ id: "bad-1", name: "Bad 1", cohesion: 0.2, coupling: 0.8 }),
      makeZone({ id: "bad-2", name: "Bad 2", cohesion: 0.25, coupling: 0.75 }),
      makeZone({ id: "bad-3", name: "Bad 3", cohesion: 0.3, coupling: 0.7 }),
    ];

    // Without justifications: global finding mentions 3 zones
    const noJustify = assessAllZoneRisks(makeZones(zones));
    const globalNoJ = noJustify.findings.find((f) => f.scope === "global");
    expect(globalNoJ).toBeDefined();
    expect(globalNoJ!.text).toContain("3");

    // With 2 justified: only 1 unjustified, so no global finding
    const withJustify = assessAllZoneRisks(makeZones(zones), {
      justifications: [
        { zone: "bad-1", reason: "Accepted" },
        { zone: "bad-2", reason: "Accepted" },
      ],
    });
    const globalWithJ = withJustify.findings.find((f) => f.scope === "global");
    expect(globalWithJ).toBeUndefined();
  });

  it("works with no justifications option", () => {
    const zones = [
      makeZone({ id: "risky", name: "Risky", cohesion: 0.2, coupling: 0.8 }),
    ];
    // No opts at all
    const result1 = assessAllZoneRisks(makeZones(zones));
    expect(result1.findings.length).toBeGreaterThan(0);
    expect(result1.findings[0].severity).toBe("critical");

    // Empty justifications array
    const result2 = assessAllZoneRisks(makeZones(zones), { justifications: [] });
    expect(result2.findings.length).toBeGreaterThan(0);
    expect(result2.findings[0].severity).toBe("critical");
  });
});

describe("computeZoneAggregates", () => {
  it("computes weighted averages excluding small zones", () => {
    const zones = [
      { files: Array(10).fill("f"), cohesion: 0.9, coupling: 0.1 },
      { files: Array(20).fill("f"), cohesion: 0.6, coupling: 0.4 },
      { files: Array(3).fill("f"), cohesion: 0.0, coupling: 1.0 }, // small zone — excluded
    ];

    const result = computeZoneAggregates(zones);
    expect(result.includedZoneCount).toBe(2);
    expect(result.excludedZoneCount).toBe(1);
    // Weighted: (0.9*10 + 0.6*20) / 30 = (9 + 12) / 30 = 0.7
    expect(result.weightedCohesion).toBe(0.7);
    // Weighted: (0.1*10 + 0.4*20) / 30 = (1 + 8) / 30 = 0.3
    expect(result.weightedCoupling).toBe(0.3);
    // Unweighted: (0.9 + 0.6) / 2 = 0.75
    expect(result.unweightedCohesion).toBe(0.75);
    // Unweighted: (0.1 + 0.4) / 2 = 0.25
    expect(result.unweightedCoupling).toBe(0.25);
  });

  it("returns zeros when all zones are below threshold", () => {
    const zones = [
      { files: Array(2).fill("f"), cohesion: 0.5, coupling: 0.5 },
      { files: Array(3).fill("f"), cohesion: 0.8, coupling: 0.2 },
    ];

    const result = computeZoneAggregates(zones);
    expect(result.includedZoneCount).toBe(0);
    expect(result.excludedZoneCount).toBe(2);
    expect(result.weightedCohesion).toBe(0);
    expect(result.weightedCoupling).toBe(0);
  });

  it("handles empty zones array", () => {
    const result = computeZoneAggregates([]);
    expect(result.includedZoneCount).toBe(0);
    expect(result.excludedZoneCount).toBe(0);
    expect(result.weightedCohesion).toBe(0);
  });

  it("respects custom minZoneSize threshold", () => {
    const zones = [
      { files: Array(3).fill("f"), cohesion: 0.9, coupling: 0.1 },
      { files: Array(8).fill("f"), cohesion: 0.5, coupling: 0.5 },
    ];

    // Default threshold (5) excludes the 3-file zone
    const defaultResult = computeZoneAggregates(zones);
    expect(defaultResult.includedZoneCount).toBe(1);
    expect(defaultResult.weightedCohesion).toBe(0.5);

    // Custom threshold (2) includes both
    const customResult = computeZoneAggregates(zones, 2);
    expect(customResult.includedZoneCount).toBe(2);
    // Weighted: (0.9*3 + 0.5*8) / 11 = (2.7 + 4) / 11 ≈ 0.61
    expect(customResult.weightedCohesion).toBeCloseTo(0.61, 1);
  });
});
