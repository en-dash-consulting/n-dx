import { describe, it, expect } from "vitest";
import { summarizeOutcomes, type OutcomeRun } from "../../../src/viewer/views/outcomes-by-tier.js";

const NOW = new Date("2026-11-05T12:00:00Z");

function run(daysAgo: number, over: Partial<OutcomeRun> = {}): OutcomeRun {
  return {
    startedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    status: "completed",
    vendor: "claude",
    weight: "standard",
    model: "claude-sonnet-5-5",
    gate: "passed",
    ...over,
  };
}

describe("summarizeOutcomes", () => {
  // Hand count — claude/standard: 3 passed + 1 failed of 4 gated, 1 ungated (5 runs, 75%).
  //              claude/heavy: 1 failed of 1 gated (0%).
  //              codex/light: 2 passed of 2 gated (100%).
  const fixture: OutcomeRun[] = [
    run(1), run(2), run(3),
    run(4, { gate: "failed" }),
    run(5, { gate: undefined }),
    run(2, { weight: "heavy", model: "claude-opus-5", gate: "failed" }),
    run(1, { vendor: "codex", weight: "light", model: "gpt-5.5-mini" }),
    run(6, { vendor: "codex", weight: "light", model: "gpt-5.5-mini-2" }),
  ];

  it("matches a hand count per vendor and tier", () => {
    const { rows } = summarizeOutcomes(fixture, NOW);
    const pick = (vendor: string, tier: string) => rows.find((r) => r.vendor === vendor && r.tier === tier);

    expect(pick("claude", "standard")).toMatchObject({ gated: 4, passed: 3, rate: 0.75, ungated: 1, runs: 5 });
    expect(pick("claude", "heavy")).toMatchObject({ gated: 1, passed: 0, rate: 0, ungated: 0, runs: 1 });
    expect(pick("codex", "light")).toMatchObject({ gated: 2, passed: 2, rate: 1, ungated: 0, runs: 2 });
    expect(rows).toHaveLength(3);
  });

  it("keeps the resolved models on the row, sorted and distinct", () => {
    const { rows } = summarizeOutcomes(fixture, NOW);
    expect(rows.find((r) => r.vendor === "codex")?.models).toEqual(["gpt-5.5-mini", "gpt-5.5-mini-2"]);
  });

  it("orders by vendor, then tier from light to heavy", () => {
    const { rows } = summarizeOutcomes(fixture, NOW);
    expect(rows.map((r) => `${r.vendor}/${r.tier}`)).toEqual(["claude/standard", "claude/heavy", "codex/light"]);
  });

  it("leaves records without a gate result out of the rate and counts them", () => {
    const summary = summarizeOutcomes([run(1), run(1, { gate: undefined }), run(1, { gate: undefined })], NOW);
    expect(summary.ungated).toBe(2);
    expect(summary.runs).toBe(3);
    expect(summary.rows[0]).toMatchObject({ gated: 1, passed: 1, rate: 1, ungated: 2 });
  });

  it("reports a null rate when no run in a group has a gate result", () => {
    const { rows } = summarizeOutcomes([run(1, { gate: undefined })], NOW);
    expect(rows[0]).toMatchObject({ gated: 0, rate: null, ungated: 1, runs: 1 });
  });

  it("covers the last 30 days only, and skips runs still in flight", () => {
    const summary = summarizeOutcomes([
      run(29), run(31), run(1, { status: "running", gate: undefined }),
    ], NOW);
    expect(summary.runs).toBe(1);
    expect(summary.windowDays).toBe(30);
    expect(summary.since.toISOString()).toBe("2026-10-06T12:00:00.000Z");
  });

  it("groups records without a vendor or tier under unknown", () => {
    const { rows } = summarizeOutcomes([run(1, { vendor: undefined, weight: undefined })], NOW);
    expect(rows[0]).toMatchObject({ vendor: "unknown", tier: "unknown" });
  });

  it("returns no rows for no runs", () => {
    expect(summarizeOutcomes([], NOW)).toMatchObject({ rows: [], runs: 0, ungated: 0 });
  });
});
