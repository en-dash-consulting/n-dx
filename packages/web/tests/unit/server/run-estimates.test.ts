import { describe, it, expect } from "vitest";
import { MIN_SAMPLE, median, summarizeEstimates, type EstimateRun } from "../../../src/server/run-estimates.js";

const NOW = new Date("2026-11-20T12:00:00.000Z");

function run(minutes: number, tokens: number, extra: Partial<EstimateRun> = {}): EstimateRun {
  const startedAt = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
  return {
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + minutes * 60_000).toISOString(),
    status: "completed",
    model: "m",
    tokenUsage: { input: tokens, output: 0 },
    ...extra,
  };
}

/** A dollar per thousand tokens, so a hand count is easy. */
const price = (r: EstimateRun) => r.tokenUsage.input / 1000;

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("summarizeEstimates", () => {
  it("reports the median duration, tokens and cost of finished runs, overall and per tier", () => {
    const runs = [
      run(10, 1000, { weight: "standard" }),
      run(20, 2000, { weight: "standard" }),
      run(30, 3000, { weight: "standard" }),
      // One runaway run does not drag the median.
      run(600, 900_000, { weight: "heavy" }),
    ];
    const e = summarizeEstimates(runs, price, NOW);
    expect(e.overall).toEqual({ runs: 4, durationMs: 25 * 60_000, tokens: 2500, costUsd: 2.5 });
    expect(e.byTier["standard"]).toEqual({ runs: 3, durationMs: 20 * 60_000, tokens: 2000, costUsd: 2 });
    // Below the minimum sample, a tier reports nothing rather than one run's numbers.
    expect(e.byTier["heavy"]).toBeUndefined();
    expect(e.windowDays).toBe(30);
  });

  it("leaves out running, unfinished, broken and out-of-window runs", () => {
    const old = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const runs = [
      run(10, 1000),
      run(10, 1000),
      run(10, 1000),
      run(10, 1000, { status: "running" }),
      run(10, 1000, { finishedAt: undefined }),
      run(10, 1000, { finishedAt: "2020-01-01T00:00:00.000Z" }),
      run(10, 1000, { startedAt: old, finishedAt: new Date(Date.parse(old) + 60_000).toISOString() }),
    ];
    expect(summarizeEstimates(runs, price, NOW).overall?.runs).toBe(3);
  });

  it("gives no estimate below the minimum sample, and no cost when nothing could be priced", () => {
    const few = Array.from({ length: MIN_SAMPLE - 1 }, () => run(5, 100));
    expect(summarizeEstimates(few, price, NOW).overall).toBeNull();
    const unpriced = Array.from({ length: MIN_SAMPLE }, () => run(5, 100));
    expect(summarizeEstimates(unpriced, () => Number.NaN, NOW).overall?.costUsd).toBeNull();
  });
});
