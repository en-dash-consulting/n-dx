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

  it("is 0 when there is nothing to measure", () => {
    expect(contextWriteFloor([])).toBe(0);
    expect(contextWriteFloor([
      makeRun("t1", "completed", "2026-09-01T00:00:00Z", { input: 100, output: 50 }),
    ])).toBe(0);
  });
});

// ── No proposal below the arrival cost ───────────────────────────────

describe("neither tuner proposes a budget below the arrival cost", () => {
  it("adaptive: no tokenBudget proposal under the floor against a template budget", () => {
    const runs = recordedRuns();
    const analysis = analyzeAdaptive(runs, makeConfig({ tokenBudget: 600_000 }));
    const budgets = proposedBudgets(analysis.adjustments.map((a) => a.configChanges));

    for (const b of budgets) expect(b).toBeGreaterThanOrEqual(RECORDED_FLOOR);

    // The regression this guards: measured as input + output, the efficiency
    // tuner fitted 2.5x an average of 44,695 and proposed ~112K — below the
    // 184,930 arrival cost, so every later run died on arrival.
    const oldAverage = inputPlusOutput(runs) / runs.length;
    expect(Math.round(oldAverage * 2.5)).toBeLessThan(RECORDED_FLOOR);
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
});
