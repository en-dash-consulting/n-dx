/**
 * The adaptive and workflow tuners must measure a run's cost in the same
 * token classes `checkTokenBudget` enforces, and must never propose a
 * `tokenBudget` below the cost a run pays on arrival.
 *
 * The fixture below is not synthetic: every `tokenUsage` is copied verbatim
 * from a completed prompt-cached run in this repository's `.hench/runs/`
 * (2026-09), identified by its run-id prefix. On those six runs input + output
 * sums to 268,169 while the budgeted classes sum to 2,730,151 — the ~10x gap
 * that made a tuner fitted to a 600K budget propose about 112K, under the
 * ~185K arrival cost, so every later run failed before doing any work.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { RunRecord, HenchConfig, TokenUsage } from "../../../src/schema/v1.js";
import { checkTokenBudget } from "../../../src/agent/lifecycle/token-budget.js";
import {
  countBudgetedTokens,
  contextWriteFloor,
  hasCacheWrites,
  runBudgetedTokens,
} from "../../../src/agent/token-cost.js";
import {
  analyzeAdaptive,
  collectMetrics,
  DEFAULT_ADAPTIVE_SETTINGS,
  _resetIdCounter as resetAdaptiveIds,
} from "../../../src/agent/analysis/adaptive.js";
import {
  analyzeWorkflow,
  computeStats,
  _resetIdCounter as resetWorkflowIds,
} from "../../../src/agent/analysis/workflow.js";

/** Recorded prompt-cached profiles, cheapest first. See the file header. */
const RECORDED: { run: string; turns: number; usage: TokenUsage }[] = [
  { run: "d092b81e", turns: 42, usage: { input: 218, output: 10620, cacheCreationInput: 174092, cacheReadInput: 10362651 } },
  { run: "9c7ca630", turns: 70, usage: { input: 336, output: 31587, cacheCreationInput: 245145, cacheReadInput: 22500721 } },
  { run: "5492d6b2", turns: 32, usage: { input: 336, output: 39000, cacheCreationInput: 293856, cacheReadInput: 23152035 } },
  { run: "6210cfa5", turns: 92, usage: { input: 524, output: 68100, cacheCreationInput: 444758, cacheReadInput: 35540137 } },
  { run: "0afbeb98", turns: 93, usage: { input: 486, output: 43768, cacheCreationInput: 511101, cacheReadInput: 36241811 } },
  { run: "36d51cb6", turns: 137, usage: { input: 716, output: 72478, cacheCreationInput: 793030, cacheReadInput: 66831188 } },
];

/** The cheapest recorded run — the measured arrival cost for this fixture. */
const RECORDED_FLOOR = 184_930;

function makeRun(
  taskId: string,
  status: RunRecord["status"],
  startedAt: string,
  usage: TokenUsage,
  turns = 10,
): RunRecord {
  return {
    id: `run-${taskId}`,
    taskId,
    taskTitle: `Task ${taskId}`,
    startedAt,
    finishedAt: status === "running" ? undefined : startedAt,
    status,
    turns,
    tokenUsage: usage,
    toolCalls: [],
    model: "sonnet",
  };
}

/** The six recorded runs, newest last. */
function recordedRuns(): RunRecord[] {
  return RECORDED.map((r, i) =>
    makeRun(r.run, "completed", `2026-09-0${i + 1}T00:00:00Z`, r.usage, r.turns),
  );
}

/** What the tuners counted before this fixture's units were corrected. */
function inputPlusOutput(runs: RunRecord[]): number {
  return runs.reduce((sum, r) => sum + (r.tokenUsage.input ?? 0) + (r.tokenUsage.output ?? 0), 0);
}

function makeConfig(overrides: Partial<HenchConfig> = {}): HenchConfig {
  return {
    schema: "hench/v1",
    provider: "cli",
    model: "sonnet",
    maxTurns: 50,
    maxTokens: 8192,
    tokenBudget: 0,
    rexDir: ".rex",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    guard: {
      blockedPaths: [],
      allowedCommands: ["npm", "git"],
      commandTimeout: 30000,
      maxFileSize: 1048576,
    },
    retry: { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000 },
    loopPauseMs: 2000,
    maxFailedAttempts: 3,
    ...overrides,
  };
}

/** Every `tokenBudget` an analysis proposes, from either tuner. */
function proposedBudgets(changes: (Record<string, unknown> | undefined)[]): number[] {
  return changes
    .map((c) => c?.["tokenBudget"])
    .filter((v): v is number => typeof v === "number");
}

beforeEach(() => {
  resetAdaptiveIds();
  resetWorkflowIds();
});

// ── One counter, shared with the budget check ────────────────────────

describe("countBudgetedTokens is the measure checkTokenBudget enforces", () => {
  it("agrees with checkTokenBudget on every recorded profile", () => {
    for (const { run, usage } of RECORDED) {
      expect(countBudgetedTokens(usage), run).toBe(checkTokenBudget(usage, 0).totalUsed);
    }
  });

  it("counts cache writes and excludes cache reads", () => {
    const usage: TokenUsage = {
      input: 500,
      output: 40_000,
      cacheCreationInput: 300_000,
      cacheReadInput: 25_000_000,
    };
    expect(countBudgetedTokens(usage)).toBe(340_500);
  });

  it("tolerates missing cache fields and undefined usage", () => {
    expect(countBudgetedTokens({ input: 100, output: 50 })).toBe(150);
    expect(countBudgetedTokens(undefined)).toBe(0);
  });
});

// ── Tuner measurements are in the budget's units ─────────────────────

describe("both tuners measure run cost in the budget's units", () => {
  it("averages the budgeted classes, not input + output", () => {
    const runs = recordedRuns();
    const budgeted = runs.reduce((sum, r) => sum + checkTokenBudget(r.tokenUsage, 0).totalUsed, 0);

    expect(budgeted).toBe(2_730_151);
    expect(inputPlusOutput(runs)).toBe(268_169);

    const expectedAvg = budgeted / runs.length;
    expect(collectMetrics(runs).recentAvgTokens).toBe(expectedAvg);
    expect(computeStats(runs).avgTokensPerRun).toBe(expectedAvg);

    // The gap the tuners used to fall through: ~10x on these profiles.
    expect(expectedAvg).toBeGreaterThan((inputPlusOutput(runs) / runs.length) * 10);
  });

  it("agrees run-for-run with the budget check", () => {
    for (const run of recordedRuns()) {
      expect(runBudgetedTokens(run), run.id).toBe(checkTokenBudget(run.tokenUsage, 0).totalUsed);
    }
  });
});

// ── The arrival-cost floor ───────────────────────────────────────────

describe("contextWriteFloor", () => {
  it("is the cheapest completed prompt-cached run", () => {
    expect(contextWriteFloor(recordedRuns())).toBe(RECORDED_FLOOR);
  });

  it("ignores runs that never paid a context write", () => {
    const runs = [
      ...recordedRuns(),
      // Pre-caching record: cheap, but it never wrote a context.
      makeRun("ac5c64af", "completed", "2026-09-07T00:00:00Z", { input: 14, output: 7545 }, 7),
    ];
    expect(contextWriteFloor(runs)).toBe(RECORDED_FLOOR);
  });

  it("ignores runs that did not complete", () => {
    const runs = [
      ...recordedRuns(),
      makeRun("e39dc368", "failed", "2026-09-08T00:00:00Z",
        { input: 10, output: 0, cacheCreationInput: 1_000, cacheReadInput: 0 }, 1),
    ];
    expect(contextWriteFloor(runs)).toBe(RECORDED_FLOOR);
  });

  it("is 0 only when no run wrote cache at all", () => {
    expect(contextWriteFloor([])).toBe(0);
    expect(contextWriteFloor([
      makeRun("t1", "completed", "2026-09-01T00:00:00Z", { input: 100, output: 50 }),
    ])).toBe(0);
  });

  it("falls back to the cheapest cache write when no cached run completed", () => {
    // The case the floor exists for and used to abandon: a project whose runs
    // keep failing has no completed run, so the floor was 0 and every clamp
    // built on it became Math.max(x, 0) — a no-op.
    const runs = [
      makeRun("f1", "failed", "2026-09-01T00:00:00Z",
        { input: 2_000, output: 80_000, cacheCreationInput: 600_000 }),
      makeRun("f2", "failed", "2026-09-02T00:00:00Z",
        { input: 1_500, output: 90_000, cacheCreationInput: 100_000 }),
      makeRun("f3", "budget_exceeded", "2026-09-03T00:00:00Z",
        { input: 1_000, output: 50_000, cacheCreationInput: 550_000 }),
    ];
    expect(contextWriteFloor(runs)).toBe(100_000);
  });

  it("prefers a completed run's counted total over any cache-write fallback", () => {
    // The completed run is the stronger evidence — a budget below it would
    // have killed a run that finished — so it wins even when a failed run
    // wrote less cache.
    const runs = [
      makeRun("f1", "failed", "2026-09-01T00:00:00Z",
        { input: 1_000, output: 10_000, cacheCreationInput: 20_000 }),
      makeRun("c1", "completed", "2026-09-02T00:00:00Z",
        { input: 1_000, output: 50_000, cacheCreationInput: 300_000 }),
    ];
    expect(contextWriteFloor(runs)).toBe(351_000);
  });

  it("ignores runs with no cache writes in the fallback", () => {
    // A run that never paid a context write says nothing about arrival cost.
    const runs = [
      makeRun("u1", "failed", "2026-09-01T00:00:00Z", { input: 100, output: 50 }),
      makeRun("f1", "failed", "2026-09-02T00:00:00Z",
        { input: 1_000, output: 10_000, cacheCreationInput: 250_000 }),
    ];
    expect(contextWriteFloor(runs)).toBe(250_000);
  });
});

describe("hasCacheWrites", () => {
  it("is true for a cache-writing run whatever its status", () => {
    for (const status of ["completed", "failed", "budget_exceeded"] as const) {
      expect(hasCacheWrites([
        makeRun("r", status, "2026-09-01T00:00:00Z",
          { input: 1_000, output: 10_000, cacheCreationInput: 100_000 }),
      ]), status).toBe(true);
    }
  });

  it("is false for an empty set and for runs that never wrote cache", () => {
    expect(hasCacheWrites([])).toBe(false);
    expect(hasCacheWrites([
      makeRun("u1", "completed", "2026-09-01T00:00:00Z", { input: 100, output: 50 }),
    ])).toBe(false);
  });
});

// ── No proposal below the arrival cost ───────────────────────────────

describe("neither tuner proposes a budget below the arrival cost", () => {
  it("adaptive: no tokenBudget proposal under the floor when 1.3x lands below it", () => {
    // The two newest runs regress to failure so successRateTrend < -0.1 and
    // tokenUsageTrend > 0.2 both hold (tokens rise with recency in this
    // fixture — see the file header), firing the complexity-scaling branch.
    // Without this, the six-run all-completed fixture trips neither
    // tokenBudget branch in adaptive.ts (successRateTrend stays 0, and
    // recentAvgTokens sits well above tokenBudget * 0.3), so the loop over
    // proposals ran zero times and the assertions below never executed.
    const runs = recordedRuns();
    runs[4].status = "failed";
    runs[5].status = "failed";

    const metrics = collectMetrics(runs);
    expect(metrics.successRateTrend).toBeLessThan(-0.1);
    expect(metrics.tokenUsageTrend).toBeGreaterThan(0.2);
    expect(metrics.contextWriteFloor).toBe(RECORDED_FLOOR);

    // A 100K template budget scaled by 1.3x lands under the arrival cost;
    // the clamp in adjustComplexityScaling must raise it back to the floor.
    const config = makeConfig({ tokenBudget: 100_000 });
    expect(Math.round(config.tokenBudget * 1.3)).toBeLessThan(RECORDED_FLOOR);

    const analysis = analyzeAdaptive(runs, config);
    const budgets = proposedBudgets(analysis.adjustments.map((a) => a.configChanges));

    expect(budgets.length).toBeGreaterThan(0);
    for (const b of budgets) expect(b).toBeGreaterThanOrEqual(RECORDED_FLOOR);
  });

  it("adaptive: clamps to the floor when abandoned runs drag the average down", () => {
    // A window padded with zero-cost abandoned runs is the shape that pulls
    // the average below the arrival cost even with the counting corrected.
    const abandoned = Array.from({ length: 40 }, (_, i) =>
      makeRun(`abandoned-${i}`, "running", `2026-09-10T00:${String(i).padStart(2, "0")}:00Z`,
        { input: 0, output: 0 }, 0),
    );
    const runs = [...recordedRuns(), ...abandoned];
    const settings = { ...DEFAULT_ADAPTIVE_SETTINGS(), windowSize: runs.length };

    const metrics = collectMetrics(runs, settings.windowSize);
    expect(Math.round(metrics.recentAvgTokens * 2.5)).toBeLessThan(RECORDED_FLOOR);
    expect(metrics.contextWriteFloor).toBe(RECORDED_FLOOR);

    const analysis = analyzeAdaptive(runs, makeConfig({ tokenBudget: 600_000 }), settings);
    const tighten = analysis.adjustments.find(
      (a) => a.category === "efficiency-tuning" && a.configKey === "tokenBudget",
    );
    expect(tighten).toBeDefined();
    expect(tighten!.proposedValue).toBe(RECORDED_FLOOR);
  });

  it("workflow: no tokenBudget suggestion under the floor", () => {
    const runs = recordedRuns();
    const stats = computeStats(runs);
    expect(stats.contextWriteFloor).toBe(RECORDED_FLOOR);

    const analysis = analyzeWorkflow(runs, makeConfig({ tokenBudget: 0 }));
    const budgets = proposedBudgets(analysis.suggestions.map((s) => s.configChanges));
    expect(budgets.length).toBeGreaterThan(0);
    for (const b of budgets) expect(b).toBeGreaterThanOrEqual(RECORDED_FLOOR);

    // And the suggestion is scaled from the budgeted median (423,287), not
    // the input + output median (39,420) the tuner used to read.
    expect(budgets).toContain(846_574);
  });

  it("workflow: clamps the high-consumption proposal up to the floor", () => {
    // Expensive runs, mostly failing: 0.7x the average falls under the
    // cheapest completed run, so the proposal is raised to it.
    const runs = [
      makeRun("t1", "failed", "2026-09-01T00:00:00Z",
        { input: 534, output: 60_000, cacheCreationInput: 1_400_000, cacheReadInput: 40_000_000 }, 60),
      makeRun("t2", "failed", "2026-09-02T00:00:00Z",
        { input: 900, output: 65_000, cacheCreationInput: 1_500_000, cacheReadInput: 44_000_000 }, 65),
      makeRun("t3", "completed", "2026-09-03T00:00:00Z",
        { input: 700, output: 50_000, cacheCreationInput: 1_250_000, cacheReadInput: 36_000_000 }, 55),
    ];
    const stats = computeStats(runs);
    const floor = stats.contextWriteFloor;
    expect(floor).toBe(1_300_700);
    expect(Math.round(stats.avgTokensPerRun * 0.7)).toBeLessThan(floor);

    const analysis = analyzeWorkflow(runs, makeConfig({ tokenBudget: 0 }));
    const highUsage = analysis.suggestions.find(
      (s) => s.category === "token-efficiency" && s.priority === "high",
    );
    expect(highUsage).toBeDefined();
    expect(highUsage!.configChanges?.["tokenBudget"]).toBe(floor);
  });

  it("does not raise the cap to the fallback floor when no run completed", () => {
    // Review finding on #677. With no completed run the floor is the cheapest
    // failed run's cache writes summed over every turn — an upper estimate of
    // arrival cost. Flooring the cap with it lifts the cap that exists to curb
    // waste up to the cheapest runaway's whole cache-write total.
    const runs = [
      makeRun("r1", "failed", "2026-09-01T00:00:00Z",
        { input: 900, output: 200_000, cacheCreationInput: 3_000_000, cacheReadInput: 40_000_000 }, 70),
      makeRun("r2", "failed", "2026-09-02T00:00:00Z",
        { input: 900, output: 210_000, cacheCreationInput: 3_400_000, cacheReadInput: 42_000_000 }, 72),
      makeRun("r3", "failed", "2026-09-03T00:00:00Z",
        { input: 900, output: 190_000, cacheCreationInput: 3_200_000, cacheReadInput: 41_000_000 }, 68),
    ];
    const stats = computeStats(runs);
    expect(stats.contextWriteFloorFromCompletedRun).toBe(false);
    expect(stats.contextWriteFloor).toBe(3_000_000);
    expect(stats.successRate).toBeLessThan(0.5);

    const analysis = analyzeWorkflow(runs, makeConfig({ tokenBudget: 0 }));
    const highUsage = analysis.suggestions.find(
      (s) => s.category === "token-efficiency" && s.priority === "high",
    );
    expect(highUsage).toBeDefined();
    const proposed = highUsage!.configChanges?.["tokenBudget"] as number;
    // The reduction the cap intends, not the floor.
    expect(proposed).toBe(Math.round(stats.avgTokensPerRun * 0.7));
    expect(proposed).toBeLessThan(stats.contextWriteFloor);
  });
});

// ── High-usage threshold depends on whether cache writes were counted ──

describe("workflow high-usage threshold switches on whether the set wrote cache", () => {
  it("uncached runs above 100K at low success rate produce the high-usage suggestion", () => {
    const runs = [
      makeRun("u1", "failed", "2026-09-01T00:00:00Z", { input: 50_000, output: 100_000 }),
      makeRun("u2", "failed", "2026-09-02T00:00:00Z", { input: 60_000, output: 90_000 }),
      makeRun("u3", "completed", "2026-09-03T00:00:00Z", { input: 40_000, output: 110_000 }),
    ];
    const stats = computeStats(runs);
    expect(stats.contextWriteFloor).toBe(0);
    expect(stats.promptCached).toBe(false);
    // The suggestion needs both halves. Without this the fixture could drift
    // to a high success rate and the test would pass for the wrong reason.
    expect(stats.successRate).toBeLessThan(0.5);
    expect(stats.avgTokensPerRun).toBeGreaterThan(100_000);
    expect(stats.avgTokensPerRun).toBeLessThan(1_200_000);

    const analysis = analyzeWorkflow(runs, makeConfig({ tokenBudget: 0 }));
    const highUsage = analysis.suggestions.find(
      (s) => s.category === "token-efficiency" && s.priority === "high",
    );
    expect(highUsage).toBeDefined();
  });

  it("prompt-cached runs below 1.2M do not produce the high-usage suggestion", () => {
    const runs = [
      makeRun("c1", "completed", "2026-09-01T00:00:00Z",
        { input: 1_000, output: 50_000, cacheCreationInput: 100_000 }),
      makeRun("c2", "failed", "2026-09-02T00:00:00Z",
        { input: 2_000, output: 80_000, cacheCreationInput: 600_000 }),
      makeRun("c3", "failed", "2026-09-03T00:00:00Z",
        { input: 1_500, output: 90_000, cacheCreationInput: 550_000 }),
    ];
    const stats = computeStats(runs);
    expect(stats.contextWriteFloor).toBeGreaterThan(0);
    expect(stats.promptCached).toBe(true);
    // Pinned so the test cannot pass because the suggestion's *other* half
    // stopped holding.
    expect(stats.successRate).toBeLessThan(0.5);
    expect(stats.avgTokensPerRun).toBeGreaterThan(100_000);
    expect(stats.avgTokensPerRun).toBeLessThan(1_200_000);

    const analysis = analyzeWorkflow(runs, makeConfig({ tokenBudget: 0 }));
    const highUsage = analysis.suggestions.find(
      (s) => s.category === "token-efficiency" && s.priority === "high",
    );
    expect(highUsage).toBeUndefined();
  });
});

// ── The floor still protects a project whose runs all fail ───────────

/**
 * A run set that writes cache on every run and completes none. This is the
 * state the floor was built for, and the one it used to abandon: with no
 * completed run the floor read 0, so every clamp degenerated to
 * `Math.max(x, 0)` and the tuners were free to propose a budget below the
 * arrival cost — on a project already failing every run.
 */
function allFailedCachedRuns(): RunRecord[] {
  return [
    makeRun("af1", "failed", "2026-09-01T00:00:00Z",
      { input: 2_000, output: 80_000, cacheCreationInput: 600_000 }),
    makeRun("af2", "failed", "2026-09-02T00:00:00Z",
      { input: 1_500, output: 90_000, cacheCreationInput: 550_000 }),
    makeRun("af3", "budget_exceeded", "2026-09-03T00:00:00Z",
      { input: 1_000, output: 50_000, cacheCreationInput: 500_000 }),
  ];
}

/** The cheapest cache write in {@link allFailedCachedRuns}. */
const ALL_FAILED_FLOOR = 500_000;

describe("tuners on a prompt-cached project with no completed run", () => {
  it("measures a non-zero floor", () => {
    expect(contextWriteFloor(allFailedCachedRuns())).toBe(ALL_FAILED_FLOOR);
    expect(collectMetrics(allFailedCachedRuns()).contextWriteFloor).toBe(ALL_FAILED_FLOOR);
    expect(computeStats(allFailedCachedRuns()).contextWriteFloor).toBe(ALL_FAILED_FLOOR);
  });

  it("workflow: proposes nothing at all, now that the cached threshold applies", () => {
    // The high-usage suggestion was the only one carrying a tokenBudget for
    // this set, and suppressing it is the point of the threshold fix. Stated
    // as an empty list rather than left to a loop that would assert nothing.
    const analysis = analyzeWorkflow(allFailedCachedRuns(), makeConfig({ tokenBudget: 0 }));
    expect(proposedBudgets(analysis.suggestions.map((s) => s.configChanges))).toEqual([]);
  });

  it("adaptive: fires no tokenBudget branch at all for this run set", () => {
    // Stated rather than looped over. Neither adaptive branch can fire when
    // every run failed — complexity-scaling needs successRateTrend < -0.1,
    // which a uniformly failing set does not produce, and efficiency-tuning
    // needs successRate > 0.7. A `for (const b of budgets)` here would assert
    // nothing while looking like it did.
    const analysis = analyzeAdaptive(allFailedCachedRuns(), makeConfig({ tokenBudget: 100_000 }));
    expect(proposedBudgets(analysis.adjustments.map((a) => a.configChanges))).toEqual([]);
  });

  it("workflow: picks the cached threshold, so no high-usage suggestion below 1.2M", () => {
    // The gate used to read floor 0 as "uncached" and compare this set's
    // 12x-inflated average against 100K, firing the suggestion the 1.2M
    // rescale exists to silence — on a set where every run failed.
    const runs = allFailedCachedRuns();
    const stats = computeStats(runs);
    expect(stats.promptCached).toBe(true);
    expect(stats.successRate).toBeLessThan(0.5);
    expect(stats.avgTokensPerRun).toBeGreaterThan(100_000);
    expect(stats.avgTokensPerRun).toBeLessThan(1_200_000);

    const analysis = analyzeWorkflow(runs, makeConfig({ tokenBudget: 0 }));
    expect(
      analysis.suggestions.find(
        (s) => s.category === "token-efficiency" && s.priority === "high",
      ),
    ).toBeUndefined();
  });
});

/**
 * A project that turned prompt caching on and started failing: three earlier
 * runs completed before caching, every cached run since has failed.
 *
 * This is where the fallback floor earns its keep. There is no completed
 * *cached* run, so the old floor was 0 — yet the set plainly pays a context
 * write, and the median of those early uncached runs is an order of magnitude
 * below it. Unclamped, the tuner proposes a budget from the cheap pre-caching
 * history and every run since would fail on arrival.
 */
function cachingTurnedOnThenFailingRuns(): RunRecord[] {
  return [
    makeRun("pre1", "completed", "2026-09-01T00:00:00Z", { input: 8_000, output: 12_000 }),
    makeRun("pre2", "completed", "2026-09-02T00:00:00Z", { input: 9_000, output: 11_000 }),
    makeRun("pre3", "completed", "2026-09-03T00:00:00Z", { input: 7_000, output: 13_000 }),
    makeRun("post1", "failed", "2026-09-04T00:00:00Z",
      { input: 2_000, output: 40_000, cacheCreationInput: 420_000 }),
    makeRun("post2", "failed", "2026-09-05T00:00:00Z",
      { input: 1_800, output: 38_000, cacheCreationInput: 380_000 }),
  ];
}

/** The cheapest cache write in {@link cachingTurnedOnThenFailingRuns}. */
const MIGRATION_FLOOR = 380_000;

describe("tuners after prompt caching was turned on and runs began failing", () => {
  it("measures the floor from the cache writes, not from the pre-caching history", () => {
    const stats = computeStats(cachingTurnedOnThenFailingRuns());
    expect(stats.contextWriteFloor).toBe(MIGRATION_FLOOR);
    expect(stats.promptCached).toBe(true);
  });

  it("workflow: clamps the median-based budget up to the floor", () => {
    const runs = cachingTurnedOnThenFailingRuns();
    // The median of the three completed runs is 20,000, so the unclamped
    // proposal is 40,000 — a nineteenth of what the project now pays to
    // start. This is the number the old floor of 0 let through.
    const analysis = analyzeWorkflow(runs, makeConfig({ tokenBudget: 0 }));
    const budgets = proposedBudgets(analysis.suggestions.map((s) => s.configChanges));

    expect(budgets).toEqual([MIGRATION_FLOOR]);
  });
});

describe("adaptive at the shipped 600,000 template budget", () => {
  it("either clamps its proposal to the floor or fires no tokenBudget branch", () => {
    // The shipped templates use 600,000 (schema/templates.ts). At that budget
    // 1.3x is well clear of the recorded floor, so the point of the case is
    // to state which of the two outcomes holds rather than to assume one —
    // an assertion loop over an empty list proves nothing on its own.
    const runs = recordedRuns();
    runs[4].status = "failed";
    runs[5].status = "failed";

    const config = makeConfig({ tokenBudget: 600_000 });
    const analysis = analyzeAdaptive(runs, config);
    const budgets = proposedBudgets(analysis.adjustments.map((a) => a.configChanges));

    for (const b of budgets) expect(b).toBeGreaterThanOrEqual(RECORDED_FLOOR);
    // Says out loud which branch this budget takes, so a change that silences
    // the proposal shows up here instead of passing vacuously.
    expect(budgets).toEqual([Math.round(600_000 * 1.3)]);
  });
});
