import { describe, it, expect } from "vitest";
import { deriveNextSteps } from "../../../src/analyzers/next-steps.js";
import type { Zones, Finding } from "../../../src/schema/v1.js";

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

function makeZones(findings: Finding[], zones: Zones["zones"] = []): Zones {
  return {
    zones,
    crossings: [],
    unzoned: [],
    findings,
  };
}

describe("deriveNextSteps", () => {
  it("returns empty array when no findings", () => {
    const result = deriveNextSteps(makeZones([]));
    expect(result).toEqual([]);
  });

  it("returns empty array when findings is undefined", () => {
    const result = deriveNextSteps({
      zones: [],
      crossings: [],
      unzoned: [],
    });
    expect(result).toEqual([]);
  });

  it("assigns high priority to critical findings", () => {
    const findings = [
      makeFinding({ severity: "critical", type: "anti-pattern", text: "Critical issue" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("high");
    expect(result[0].category).toBe("fix");
  });

  it("assigns medium priority to anti-pattern warnings", () => {
    const findings = [
      makeFinding({ severity: "warning", type: "anti-pattern", text: "Bad pattern" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("medium");
    expect(result[0].category).toBe("refactor");
  });

  it("assigns medium priority to warning relationship findings", () => {
    const findings = [
      makeFinding({ severity: "warning", type: "relationship", text: "Coupling issue" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("medium");
    expect(result[0].category).toBe("extract");
  });

  it("assigns medium priority to warning suggestions", () => {
    const findings = [
      makeFinding({ severity: "warning", type: "suggestion", text: "Consider refactoring" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("medium");
    expect(result[0].category).toBe("refactor");
  });

  it("assigns low priority to info suggestions", () => {
    const findings = [
      makeFinding({ severity: "info", type: "suggestion", text: "Nice to have" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("low");
  });

  it("groups critical findings by scope", () => {
    const findings = [
      makeFinding({ severity: "critical", scope: "zone-a", text: "Issue 1" }),
      makeFinding({ severity: "critical", scope: "zone-a", text: "Issue 2" }),
      makeFinding({ severity: "critical", scope: "zone-b", text: "Issue 3" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    const highSteps = result.filter((s) => s.priority === "high");
    expect(highSteps).toHaveLength(2);
    expect(highSteps[0].relatedFindings).toHaveLength(2);
    expect(highSteps[1].relatedFindings).toHaveLength(1);
  });

  it("groups anti-pattern warnings by scope", () => {
    const findings = [
      makeFinding({ severity: "warning", type: "anti-pattern", scope: "zone-a", text: "AP 1" }),
      makeFinding({ severity: "warning", type: "anti-pattern", scope: "zone-a", text: "AP 2" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].relatedFindings).toHaveLength(2);
  });

  it("sorts high priority before medium before low", () => {
    const findings = [
      makeFinding({ severity: "info", type: "suggestion", text: "Low priority" }),
      makeFinding({ severity: "warning", type: "anti-pattern", text: "Medium priority" }),
      makeFinding({ severity: "critical", type: "anti-pattern", text: "High priority" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result[0].priority).toBe("high");
    expect(result[1].priority).toBe("medium");
    expect(result[2].priority).toBe("low");
  });

  it("sorts by related findings count within same priority", () => {
    const findings = [
      makeFinding({ severity: "warning", type: "anti-pattern", scope: "a", text: "Single" }),
      makeFinding({ severity: "warning", type: "anti-pattern", scope: "b", text: "Group 1" }),
      makeFinding({ severity: "warning", type: "anti-pattern", scope: "b", text: "Group 2" }),
      makeFinding({ severity: "warning", type: "anti-pattern", scope: "b", text: "Group 3" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result[0].relatedFindings.length).toBeGreaterThan(result[1].relatedFindings.length);
  });

  it("truncates long text in titles", () => {
    const longText = "A".repeat(100);
    const findings = [
      makeFinding({ severity: "warning", type: "suggestion", text: longText }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result[0].title.length).toBeLessThanOrEqual(80);
    expect(result[0].title.endsWith("\u2026")).toBe(true);
  });

  it("includes zone files in description when zone exists", () => {
    const findings = [
      makeFinding({ severity: "critical", scope: "test-zone", text: "Issue" }),
    ];
    const zones: Zones["zones"] = [{
      id: "test-zone",
      name: "Test Zone",
      description: "Test",
      files: ["src/a.ts", "src/b.ts"],
      entryPoints: [],
      cohesion: 0.8,
      coupling: 0.2,
    }];
    const result = deriveNextSteps(makeZones(findings, zones));
    expect(result[0].description).toContain("src/a.ts");
  });

  it("handles remaining warning findings not caught by earlier passes", () => {
    const findings = [
      makeFinding({ severity: "warning", type: "observation", text: "General warning" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("medium");
  });

  it("does not double-count findings across grouping passes", () => {
    const findings = [
      makeFinding({ severity: "critical", scope: "a", text: "Critical" }),
      makeFinding({ severity: "warning", type: "anti-pattern", scope: "a", text: "Anti-pattern" }),
      makeFinding({ severity: "warning", type: "suggestion", scope: "a", text: "Suggestion" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    const allRelated = result.flatMap((s) => s.relatedFindings);
    const unique = new Set(allRelated);
    expect(unique.size).toBe(allRelated.length);
  });

  it("does not group anti-patterns of different severities", () => {
    const findings = [
      makeFinding({ severity: "warning", type: "anti-pattern", scope: "a", text: "Warning AP" }),
      makeFinding({ severity: "info", type: "anti-pattern", scope: "a", text: "Info AP" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    // Warning anti-pattern should create medium priority step
    // Info anti-pattern should be skipped (not grouped with warning)
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("medium");
    expect(result[0].relatedFindings).toHaveLength(1);
    expect(result[0].relatedFindings[0]).toBe(0);
  });

  it("skips info-severity anti-patterns entirely", () => {
    const findings = [
      makeFinding({ severity: "info", type: "anti-pattern", text: "Info anti-pattern" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    // Info severity anti-patterns don't match any pass criteria
    expect(result).toHaveLength(0);
  });

  it("skips findings without severity (undefined)", () => {
    const findings = [
      makeFinding({ severity: undefined, type: "observation", text: "No severity" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    // Findings without severity don't match any pass criteria
    expect(result).toHaveLength(0);
  });

  it("groups warning relationship findings by scope", () => {
    const findings = [
      makeFinding({ severity: "warning", type: "relationship", scope: "zone-a", text: "Coupling 1" }),
      makeFinding({ severity: "warning", type: "relationship", scope: "zone-a", text: "Coupling 2" }),
      makeFinding({ severity: "warning", type: "pattern", scope: "zone-a", text: "Pattern 1" }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].relatedFindings).toHaveLength(3);
    expect(result[0].category).toBe("extract");
  });

  it("promotes warning anti-pattern to high priority when impact is broad (many related)", () => {
    const findings = [
      makeFinding({
        severity: "warning",
        type: "anti-pattern",
        text: "Cross-cutting concern spans many zones",
        related: ["zone-a", "zone-b", "zone-c", "zone-d", "zone-e"],
      }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("high");
    expect(result[0].category).toBe("refactor");
  });

  it("promotes warning relationship to high priority when impact is broad", () => {
    const findings = [
      makeFinding({
        severity: "warning",
        type: "relationship",
        text: "Heavy coupling across many zones",
        related: ["zone-a", "zone-b", "zone-c", "zone-d", "zone-e"],
      }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("high");
  });

  it("does not promote warning findings with few related items", () => {
    const findings = [
      makeFinding({
        severity: "warning",
        type: "anti-pattern",
        text: "Local anti-pattern",
        related: ["zone-a", "zone-b"],
      }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("medium");
  });

  it("does not promote info suggestions regardless of related count", () => {
    const findings = [
      makeFinding({
        severity: "info",
        type: "suggestion",
        text: "Many related but low severity",
        related: ["zone-a", "zone-b", "zone-c", "zone-d", "zone-e"],
      }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("low");
  });

  it("uses related count as tiebreaker within same priority", () => {
    const findings = [
      makeFinding({
        severity: "warning",
        type: "anti-pattern",
        scope: "zone-a",
        text: "No related",
      }),
      makeFinding({
        severity: "warning",
        type: "anti-pattern",
        scope: "zone-b",
        text: "Has related",
        related: ["zone-c", "zone-d"],
      }),
    ];
    const result = deriveNextSteps(makeZones(findings));
    expect(result).toHaveLength(2);
    // The one with related items should sort first within same priority
    expect(result[0].title).toContain("Has related");
    expect(result[1].title).toContain("No related");
  });

  it("handles complex multi-type scenario without double-counting", () => {
    const findings = [
      // Pass 1: critical (high priority)
      makeFinding({ severity: "critical", scope: "a", text: "Critical 1" }),
      makeFinding({ severity: "critical", scope: "a", text: "Critical 2" }),
      // Pass 2: warning anti-pattern (medium priority)
      makeFinding({ severity: "warning", type: "anti-pattern", scope: "a", text: "AP Warning" }),
      // Pass 3: warning relationship (medium priority, extract)
      makeFinding({ severity: "warning", type: "relationship", scope: "b", text: "Relationship" }),
      makeFinding({ severity: "warning", type: "pattern", scope: "b", text: "Pattern" }),
      // Pass 4: suggestion (any severity)
      makeFinding({ severity: "info", type: "suggestion", text: "Suggestion" }),
      // Pass 5: remaining warning (observation type)
      makeFinding({ severity: "warning", type: "observation", scope: "c", text: "Observation warning" }),
    ];
    const result = deriveNextSteps(makeZones(findings));

    // Should have 5 steps total
    expect(result).toHaveLength(5);

    // Verify no double-counting
    const allRelated = result.flatMap((s) => s.relatedFindings);
    const unique = new Set(allRelated);
    expect(unique.size).toBe(allRelated.length);

    // Verify each finding is used exactly once
    expect(unique.size).toBe(findings.length);

    // Verify priorities are correct
    expect(result[0].priority).toBe("high"); // critical
    expect(result[1].priority).toBe("medium"); // anti-pattern warning
    expect(result[2].priority).toBe("medium"); // relationship/pattern warning
    expect(result[3].priority).toBe("medium"); // observation warning
    expect(result[4].priority).toBe("low"); // info suggestion
  });

  it("includes zone files in description for relationship findings", () => {
    const findings = [
      makeFinding({ severity: "warning", type: "relationship", scope: "test-zone", text: "Coupling issue" }),
    ];
    const zones: Zones["zones"] = [{
      id: "test-zone",
      name: "Test Zone",
      description: "Test",
      files: ["src/a.ts", "src/b.ts"],
      entryPoints: [],
      cohesion: 0.8,
      coupling: 0.2,
    }];
    const result = deriveNextSteps(makeZones(findings, zones));
    expect(result[0].description).toContain("src/a.ts");
  });

  it("includes zone files in description for remaining warning findings", () => {
    const findings = [
      makeFinding({ severity: "warning", type: "observation", scope: "test-zone", text: "General warning" }),
    ];
    const zones: Zones["zones"] = [{
      id: "test-zone",
      name: "Test Zone",
      description: "Test",
      files: ["src/a.ts", "src/b.ts"],
      entryPoints: [],
      cohesion: 0.8,
      coupling: 0.2,
    }];
    const result = deriveNextSteps(makeZones(findings, zones));
    expect(result[0].description).toContain("src/a.ts");
  });
});
