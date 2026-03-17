import { describe, it, expect } from "vitest";
import {
  classifyRiskLevel,
  assessZoneRisk,
  assessAllZoneRisks,
  ZONE_TYPE_THRESHOLDS,
} from "../../../src/analyzers/risk-scoring.js";
import { makeZone } from "./zones-helpers.js";

describe("ZONE_TYPE_THRESHOLDS", () => {
  it("has thresholds for all zone types", () => {
    expect(ZONE_TYPE_THRESHOLDS).toHaveProperty("domain");
    expect(ZONE_TYPE_THRESHOLDS).toHaveProperty("integration");
    expect(ZONE_TYPE_THRESHOLDS).toHaveProperty("test");
    expect(ZONE_TYPE_THRESHOLDS).toHaveProperty("infrastructure");
    expect(ZONE_TYPE_THRESHOLDS).toHaveProperty("gateway");
    expect(ZONE_TYPE_THRESHOLDS).toHaveProperty("orchestration");
  });

  it("domain type has strict thresholds", () => {
    const t = ZONE_TYPE_THRESHOLDS.domain;
    expect(t.cohesionFloor).toBe(0.4);
    expect(t.couplingCeiling).toBe(0.6);
  });

  it("test type has relaxed thresholds", () => {
    const t = ZONE_TYPE_THRESHOLDS.test;
    expect(t.cohesionFloor).toBeLessThan(0.2);
    expect(t.couplingCeiling).toBeGreaterThan(0.8);
  });

  it("infrastructure type tolerates any metrics", () => {
    const t = ZONE_TYPE_THRESHOLDS.infrastructure;
    expect(t.cohesionFloor).toBe(0);
    expect(t.couplingCeiling).toBe(1.0);
  });
});

describe("assessZoneRisk with zone type", () => {
  it("test zone with high coupling is healthy (relaxed thresholds)", () => {
    const zone = makeZone("test-zone", ["a.test.ts", "b.test.ts"], {
      cohesion: 0.1,
      coupling: 0.85,
    });

    const risk = assessZoneRisk(zone, undefined, "test");
    expect(risk.riskLevel).toBe("healthy");
    expect(risk.failsThreshold).toBe(false);
  });

  it("same metrics without zone type would be catastrophic", () => {
    const zone = makeZone("test-zone", ["a.test.ts", "b.test.ts"], {
      cohesion: 0.1,
      coupling: 0.85,
    });

    const risk = assessZoneRisk(zone);
    expect(risk.riskLevel).toBe("catastrophic");
    expect(risk.failsThreshold).toBe(true);
  });

  it("integration zone tolerates moderate coupling", () => {
    const zone = makeZone("cli-zone", ["cli.ts", "run.ts"], {
      cohesion: 0.3,
      coupling: 0.7,
    });

    const risk = assessZoneRisk(zone, undefined, "integration");
    expect(risk.riskLevel).toBe("healthy");
  });

  it("domain zone with same metrics would be critical", () => {
    const zone = makeZone("core-zone", ["core.ts"], {
      cohesion: 0.3,
      coupling: 0.7,
    });

    // cohesion 0.3 and coupling 0.7 are on the boundary — critical, not catastrophic
    // (catastrophic requires cohesion < 0.3 AND coupling > 0.7)
    const risk = assessZoneRisk(zone, undefined, "domain");
    expect(risk.riskLevel).toBe("critical");
  });

  it("infrastructure zone is always healthy", () => {
    const zone = makeZone("build-zone", ["build.js"], {
      cohesion: 0,
      coupling: 1.0,
    });

    const risk = assessZoneRisk(zone, undefined, "infrastructure");
    expect(risk.riskLevel).toBe("healthy");
  });
});

describe("assessAllZoneRisks with zone types", () => {
  it("uses zone types from options to set per-zone thresholds", () => {
    const zones = {
      zones: [
        makeZone("test-zone", ["a.test.ts"], { cohesion: 0.1, coupling: 0.9 }),
        makeZone("core-zone", ["core.ts"], { cohesion: 0.1, coupling: 0.9 }),
      ],
      crossings: [],
      unzoned: [],
    };

    const result = assessAllZoneRisks(zones, {
      zoneTypes: { "test-zone": "test" },
    });

    // test-zone should be healthy with its type
    expect(result.metrics["test-zone"].riskLevel).toBe("healthy");
    // core-zone has no type, uses default thresholds → catastrophic
    expect(result.metrics["core-zone"].riskLevel).toBe("catastrophic");
  });

  it("zone type takes precedence over risk justification", () => {
    const zones = {
      zones: [
        makeZone("test-zone", ["a.test.ts"], { cohesion: 0.1, coupling: 0.9 }),
      ],
      crossings: [],
      unzoned: [],
    };

    const result = assessAllZoneRisks(zones, {
      justifications: [{ zone: "test-zone", reason: "It's a test zone" }],
      zoneTypes: { "test-zone": "test" },
    });

    // Should be healthy due to zone type, not just info-downgraded
    expect(result.metrics["test-zone"].riskLevel).toBe("healthy");
  });

  it("does not emit findings for zones healthy under their type thresholds", () => {
    const zones = {
      zones: [
        makeZone("test-zone", ["a.test.ts"], { cohesion: 0.1, coupling: 0.9 }),
      ],
      crossings: [],
      unzoned: [],
    };

    const result = assessAllZoneRisks(zones, {
      zoneTypes: { "test-zone": "test" },
    });

    // Healthy zone should not generate any findings
    expect(result.findings).toHaveLength(0);
  });
});
