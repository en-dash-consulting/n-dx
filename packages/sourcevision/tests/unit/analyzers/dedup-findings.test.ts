import { describe, it, expect } from "vitest";
import { deduplicateFindings } from "../../../src/analyzers/enrich-parsing.js";
import type { Finding } from "../../../src/schema/v1.js";

/**
 * Load tolerance for wall-clock budgets below.
 *
 * These assertions guard against algorithmic regressions (a quadratic
 * rewrite is orders of magnitude slower), not latency SLAs. Idle-machine
 * numbers flake when the rest of the monorepo suite saturates every core,
 * so the budget is scaled. See TESTING.md "Flake Resistance".
 */
const BUDGET_MULTIPLIER = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20);


function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    type: "observation",
    pass: 0,
    scope: "global",
    text: "Test finding",
    severity: "info",
    ...overrides,
  };
}

describe("deduplicateFindings", () => {
  it("returns empty array for empty input", () => {
    expect(deduplicateFindings([])).toEqual([]);
  });

  it("keeps distinct findings unchanged", () => {
    const findings = [
      makeFinding({ text: "Low cohesion in zone A", scope: "zone-a" }),
      makeFinding({ text: "High coupling in zone B", scope: "zone-b" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it("merges exact duplicate text within same scope", () => {
    const findings = [
      makeFinding({ text: "Low cohesion detected", scope: "zone-a", pass: 0, severity: "warning" }),
      makeFinding({ text: "Low cohesion detected", scope: "zone-a", pass: 1, severity: "info" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Low cohesion detected");
  });

  it("prefers pass 0 finding over higher-severity LLM duplicates", () => {
    const findings = [
      makeFinding({ text: "Circular dependency found", scope: "global", pass: 0, severity: "info" }),
      makeFinding({ text: "Circular dependency found", scope: "global", pass: 2, severity: "critical" }),
      makeFinding({ text: "Circular dependency found", scope: "global", pass: 1, severity: "warning" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    // Pass 0 findings are authoritative — their calibrated severity is preserved
    expect(result[0].severity).toBe("info");
    expect(result[0].pass).toBe(0);
  });

  it("keeps highest severity when merging non-pass-0 duplicates", () => {
    const findings = [
      makeFinding({ text: "Circular dependency found", scope: "global", pass: 1, severity: "info" }),
      makeFinding({ text: "Circular dependency found", scope: "global", pass: 2, severity: "critical" }),
      makeFinding({ text: "Circular dependency found", scope: "global", pass: 3, severity: "warning" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("critical");
  });

  it("merges near-duplicate text (case-insensitive)", () => {
    const findings = [
      makeFinding({ text: "Low cohesion in this zone", scope: "zone-a", severity: "warning" }),
      makeFinding({ text: "low cohesion in this zone", scope: "zone-a", severity: "info" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
  });

  it("merges findings with similar text across different passes", () => {
    const findings = [
      makeFinding({ text: "Zone has low cohesion score (0.3)", scope: "zone-a", pass: 0, severity: "warning" }),
      makeFinding({ text: "Zone has low cohesion score (0.35)", scope: "zone-a", pass: 1, severity: "warning" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
  });

  it("does not merge findings in different scopes", () => {
    const findings = [
      makeFinding({ text: "Low cohesion detected", scope: "zone-a", severity: "warning" }),
      makeFinding({ text: "Low cohesion detected", scope: "zone-b", severity: "warning" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it("preserves pass 0 finding even when LLM duplicate has related arrays", () => {
    const findings = [
      makeFinding({ text: "Coupling issue", scope: "zone-a", pass: 0, severity: "info" }),
      makeFinding({ text: "Coupling issue", scope: "zone-a", pass: 1, severity: "warning", related: ["zone-b", "zone-c"] }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    // Pass 0 is authoritative — its severity and data are preserved
    expect(result[0].pass).toBe(0);
    expect(result[0].severity).toBe("info");
  });

  it("prefers the finding with the most related items when severity is equal (non-pass-0)", () => {
    const findings = [
      makeFinding({ text: "Coupling issue", scope: "zone-a", pass: 1, severity: "warning", related: ["zone-b"] }),
      makeFinding({ text: "Coupling issue", scope: "zone-a", pass: 2, severity: "warning", related: ["zone-b", "zone-c", "zone-d"] }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].related).toEqual(["zone-b", "zone-c", "zone-d"]);
  });

  it("preserves pass 0 finding even when it lacks severity", () => {
    const findings = [
      makeFinding({ text: "Same finding", scope: "zone-a", pass: 0, severity: undefined }),
      makeFinding({ text: "Same finding", scope: "zone-a", pass: 1, severity: "warning" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    // Pass 0 is authoritative — preserved even without severity
    expect(result[0].pass).toBe(0);
  });

  it("handles findings without severity (non-pass-0)", () => {
    const findings = [
      makeFinding({ text: "Same finding", scope: "zone-a", pass: 1, severity: undefined }),
      makeFinding({ text: "Same finding", scope: "zone-a", pass: 2, severity: "warning" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
  });

  it("keeps lowest pass number when all else is equal", () => {
    const findings = [
      makeFinding({ text: "Observation about zone", scope: "zone-a", pass: 2, severity: "info" }),
      makeFinding({ text: "Observation about zone", scope: "zone-a", pass: 0, severity: "info" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].pass).toBe(0);
  });

  it("does not merge findings with different types", () => {
    const findings = [
      makeFinding({ text: "Issue found in zone", scope: "zone-a", type: "anti-pattern", severity: "warning" }),
      makeFinding({ text: "Issue found in zone", scope: "zone-a", type: "suggestion", severity: "warning" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it("handles large finding sets efficiently", () => {
    // Create 200 findings: 100 unique texts, each duplicated once in a different pass
    // Each finding uses a unique scope so there are no accidental merges between distinct texts
    const findings: Finding[] = [];
    for (let i = 0; i < 100; i++) {
      findings.push(makeFinding({
        text: `Unique finding text ${i}`,
        scope: `zone-${i}`,
        pass: 0,
        severity: "info",
      }));
      findings.push(makeFinding({
        text: `Unique finding text ${i}`,
        scope: `zone-${i}`,
        pass: 1,
        severity: "warning",
      }));
    }
    const start = Date.now();
    const result = deduplicateFindings(findings);
    const elapsed = Date.now() - start;
    // Each pair of duplicates merges into 1, so 100 results
    expect(result).toHaveLength(100);
    // Pass 0 findings are authoritative — their severity is preserved
    for (const f of result) {
      expect(f.severity).toBe("info");
      expect(f.pass).toBe(0);
    }
    expect(elapsed).toBeLessThan(1000 * BUDGET_MULTIPLIER);
  });

  it("merges findings with whitespace differences", () => {
    const findings = [
      makeFinding({ text: "High coupling   between modules", scope: "global", severity: "warning" }),
      makeFinding({ text: "High coupling between modules", scope: "global", severity: "info" }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
  });
});
