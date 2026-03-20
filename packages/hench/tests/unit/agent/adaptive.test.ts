import { describe, it, expect, beforeEach } from "vitest";
import type { RunRecord, HenchConfig } from "../../../src/schema/v1.js";
import {
  analyzeAdaptive,
  collectMetrics,
  getAutoApplicable,
  _resetIdCounter,
  DEFAULT_ADAPTIVE_SETTINGS,
  type AdaptiveSettings,
} from "../../../src/agent/analysis/adaptive.js";

function makeRun(
  taskId: string,
  status: "completed" | "failed" | "timeout" | "budget_exceeded" | "error_transient" | "running",
  startedAt: string,
  overrides: Partial<RunRecord> = {},
): RunRecord {
  const finishedAt = status === "running" ? undefined : startedAt;
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    taskTitle: `Task ${taskId}`,
    startedAt,
    finishedAt,
    status,
    turns: overrides.turns ?? 10,
    tokenUsage: overrides.tokenUsage ?? { input: 5000, output: 1000 },
    toolCalls: [],
    model: "sonnet",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<HenchConfig> = {}): HenchConfig {
  return {
    schema: "hench/v1",
    provider: "cli",
    model: "sonnet",
    maxTurns: 50,
    maxTokens: 8192,
    tokenBudget: 0,
    rexDir: ".n-dx/rex",
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

function makeSettings(overrides: Partial<AdaptiveSettings> = {}): AdaptiveSettings {
  return { ...DEFAULT_ADAPTIVE_SETTINGS(), ...overrides };
}

beforeEach(() => {
  _resetIdCounter();
});

// ── collectMetrics ──────────────────────────────────────────────────

describe("collectMetrics", () => {
  it("returns zero metrics for empty runs", () => {
    const metrics = collectMetrics([]);
    expect(metrics.totalRuns).toBe(0);
    expect(metrics.recentSuccessRate).toBe(0);
    expect(metrics.recentAvgTurns).toBe(0);
    expect(metrics.runsPerDay).toBe(0);
  });

  it("computes recent success rate from finished runs only", () => {
    const runs = [
      makeRun("t1", "completed", "2024-01-01T01:00:00Z"),
      makeRun("t2", "completed", "2024-01-01T02:00:00Z"),
      makeRun("t3", "failed", "2024-01-01T03:00:00Z"),
      makeRun("t4", "running", "2024-01-01T04:00:00Z"),
    ];
    const metrics = collectMetrics(runs);
    // 2 completed out of 3 finished (running excluded)
    expect(metrics.recentSuccessRate).toBeCloseTo(2 / 3, 3);
  });

  it("computes average turns over recent window", () => {
    const runs = [
      makeRun("t1", "completed", "2024-01-01T01:00:00Z", { turns: 10 }),
      makeRun("t2", "completed", "2024-01-01T02:00:00Z", { turns: 30 }),
    ];
    const metrics = collectMetrics(runs);
    expect(metrics.recentAvgTurns).toBe(20);
  });

  it("computes average tokens per run", () => {
    const runs = [
      makeRun("t1", "completed", "2024-01-01T01:00:00Z", { tokenUsage: { input: 10000, output: 2000 } }),
      makeRun("t2", "completed", "2024-01-01T02:00:00Z", { tokenUsage: { input: 20000, output: 4000 } }),
    ];
    const metrics = collectMetrics(runs);
    expect(metrics.recentAvgTokens).toBe(18000);
  });

  it("counts distinct tasks in recent window", () => {
    const runs = [
      makeRun("t1", "completed", "2024-01-01T01:00:00Z"),
      makeRun("t1", "completed", "2024-01-01T02:00:00Z"),
      makeRun("t2", "completed", "2024-01-01T03:00:00Z"),
    ];
    const metrics = collectMetrics(runs);
    expect(metrics.recentTaskCount).toBe(2);
  });

  it("computes runs per day", () => {
    const runs = [
      makeRun("t1", "completed", "2024-01-01T00:00:00Z"),
      makeRun("t2", "completed", "2024-01-02T00:00:00Z"),
      makeRun("t3", "completed", "2024-01-03T00:00:00Z"),
    ];
    const metrics = collectMetrics(runs);
    // 3 runs over 2 days
    expect(metrics.runsPerDay).toBeCloseTo(1.5, 1);
  });

  it("respects window size", () => {
    // Create 10 runs, but only use window of 3
    const runs = Array.from({ length: 10 }, (_, i) =>
      makeRun(`t${i}`, "completed", `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, { turns: 10 }),
    );
    const metrics = collectMetrics(runs, 3);
    // Total should still reflect all runs
    expect(metrics.totalRuns).toBe(10);
    // But avg turns should be from the 3 most recent only
    expect(metrics.recentAvgTurns).toBe(10);
    // Task count should be 3 (3 unique tasks in the window)
    expect(metrics.recentTaskCount).toBe(3);
  });

  it("computes success rate trend (improving)", () => {
    // Older half: 2 failures, Newer half: 2 completions
    const runs = [
      makeRun("t1", "completed", "2024-01-04T00:00:00Z"),
      makeRun("t2", "completed", "2024-01-03T00:00:00Z"),
      makeRun("t3", "failed", "2024-01-02T00:00:00Z"),
      makeRun("t4", "failed", "2024-01-01T00:00:00Z"),
    ];
    const metrics = collectMetrics(runs, 4);
    // Newer half: 100% success, Older half: 0% success → positive trend
    expect(metrics.successRateTrend).toBeGreaterThan(0);
  });

  it("computes success rate trend (declining)", () => {
    // Older half: 2 completions, Newer half: 2 failures
    const runs = [
      makeRun("t1", "failed", "2024-01-04T00:00:00Z"),
      makeRun("t2", "failed", "2024-01-03T00:00:00Z"),
      makeRun("t3", "completed", "2024-01-02T00:00:00Z"),
      makeRun("t4", "completed", "2024-01-01T00:00:00Z"),
    ];
    const metrics = collectMetrics(runs, 4);
    // Newer half: 0% success, Older half: 100% success → negative trend
    expect(metrics.successRateTrend).toBeLessThan(0);
  });

  it("computes token usage trend", () => {
    // Newer runs use more tokens than older runs
    const runs = [
      makeRun("t1", "completed", "2024-01-04T00:00:00Z", { tokenUsage: { input: 20000, output: 5000 } }),
      makeRun("t2", "completed", "2024-01-03T00:00:00Z", { tokenUsage: { input: 18000, output: 5000 } }),
      makeRun("t3", "completed", "2024-01-02T00:00:00Z", { tokenUsage: { input: 5000, output: 1000 } }),
      makeRun("t4", "completed", "2024-01-01T00:00:00Z", { tokenUsage: { input: 4000, output: 1000 } }),
    ];
    const metrics = collectMetrics(runs, 4);
    // Newer half avg much higher → positive trend
    expect(metrics.tokenUsageTrend).toBeGreaterThan(0);
  });
});

// ── analyzeAdaptive ─────────────────────────────────────────────────

describe("analyzeAdaptive", () => {
  it("returns empty adjustments when below minimum runs", () => {
    const runs = [
      makeRun("t1", "completed", "2024-01-01T01:00:00Z"),
      makeRun("t2", "completed", "2024-01-01T02:00:00Z"),
    ];
    const result = analyzeAdaptive(runs, makeConfig(), makeSettings({ minRunsRequired: 5 }));
    expect(result.adjustments).toEqual([]);
    expect(result.notifications).toEqual([]);
    expect(result.metrics.totalRuns).toBe(2);
  });

  it("includes metrics even when no adjustments are generated", () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      makeRun(`t${i}`, "completed", `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, { turns: 10 }),
    );
    const result = analyzeAdaptive(runs, makeConfig(), makeSettings());
    expect(result.metrics.totalRuns).toBe(5);
    expect(result.metrics.recentSuccessRate).toBe(1);
  });

  it("sorts adjustments by priority (high first)", () => {
    // Create scenario with both high and low priority adjustments
    const runs = Array.from({ length: 10 }, (_, i) =>
      makeRun(`t${i}`, i < 6 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );
    const config = makeConfig({ maxTurns: 50 });
    const result = analyzeAdaptive(runs, config, makeSettings());

    if (result.adjustments.length > 1) {
      const priorities = result.adjustments.map((a) => a.priority);
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      let last = 0;
      for (const p of priorities) {
        expect(order[p]).toBeGreaterThanOrEqual(last);
        last = order[p];
      }
    }
  });
});

// ── Complexity scaling adjustments ──────────────────────────────────

describe("complexity scaling adjustments", () => {
  it("suggests scaling up turns when average usage is near the limit", () => {
    const config = makeConfig({ maxTurns: 50 });
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 3 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );
    const result = analyzeAdaptive(runs, config, makeSettings());
    const scaleSuggestion = result.adjustments.find(
      (a) => a.category === "complexity-scaling" && a.configKey === "maxTurns",
    );
    expect(scaleSuggestion).toBeDefined();
    expect(scaleSuggestion!.priority).toBe("high");
    expect((scaleSuggestion!.proposedValue as number)).toBeGreaterThan(50);
  });

  it("does not suggest scaling when turns are well under the limit", () => {
    const config = makeConfig({ maxTurns: 50 });
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 10 }),
    );
    const result = analyzeAdaptive(runs, config, makeSettings());
    const scaleSuggestion = result.adjustments.find(
      (a) => a.category === "complexity-scaling" && a.configKey === "maxTurns",
    );
    expect(scaleSuggestion).toBeUndefined();
  });

  it("suggests increasing token budget when tokens trend up and success declines", () => {
    const config = makeConfig({ tokenBudget: 100000 });
    // Newer runs use more tokens and fail; older runs use less and succeed
    const runs = [
      makeRun("t1", "failed", "2024-01-06T00:00:00Z", { tokenUsage: { input: 50000, output: 10000 } }),
      makeRun("t2", "failed", "2024-01-05T00:00:00Z", { tokenUsage: { input: 48000, output: 10000 } }),
      makeRun("t3", "failed", "2024-01-04T00:00:00Z", { tokenUsage: { input: 45000, output: 10000 } }),
      makeRun("t4", "completed", "2024-01-03T00:00:00Z", { tokenUsage: { input: 10000, output: 2000 } }),
      makeRun("t5", "completed", "2024-01-02T00:00:00Z", { tokenUsage: { input: 8000, output: 2000 } }),
      makeRun("t6", "completed", "2024-01-01T00:00:00Z", { tokenUsage: { input: 9000, output: 2000 } }),
    ];
    const result = analyzeAdaptive(runs, config, makeSettings());
    const tokenSuggestion = result.adjustments.find(
      (a) => a.category === "complexity-scaling" && a.configKey === "tokenBudget",
    );
    expect(tokenSuggestion).toBeDefined();
    expect((tokenSuggestion!.proposedValue as number)).toBeGreaterThan(100000);
  });
});

// ── Velocity tracking adjustments ───────────────────────────────────

describe("velocity tracking adjustments", () => {
  it("suggests tightening turns for high-velocity projects with good success", () => {
    const config = makeConfig({ maxTurns: 50 });
    // Many runs per day, all succeeding with low turn usage
    const baseTime = Date.now();
    const runs = Array.from({ length: 10 }, (_, i) =>
      makeRun(`t${i}`, "completed",
        new Date(baseTime - i * 3600000).toISOString(), // 1 run per hour = 24/day
        { turns: 10 }),
    );
    const result = analyzeAdaptive(runs, config, makeSettings());
    const velocitySuggestion = result.adjustments.find(
      (a) => a.category === "velocity-tracking" && a.configKey === "maxTurns",
    );
    expect(velocitySuggestion).toBeDefined();
    expect((velocitySuggestion!.proposedValue as number)).toBeLessThan(50);
  });

  it("suggests increasing failure tolerance for low-velocity projects", () => {
    const config = makeConfig({ maxFailedAttempts: 3 });
    // Spread over many days, mostly failing
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 4 ? "failed" : "completed",
        `2024-01-${String(i * 5 + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const result = analyzeAdaptive(runs, config, makeSettings());
    const failureSuggestion = result.adjustments.find(
      (a) => a.category === "velocity-tracking" && a.configKey === "maxFailedAttempts",
    );
    expect(failureSuggestion).toBeDefined();
    expect(failureSuggestion!.proposedValue).toBe(5);
  });
});

// ── Efficiency tuning adjustments ───────────────────────────────────

describe("efficiency tuning adjustments", () => {
  it("suggests reducing loop pause when success rate is declining", () => {
    const config = makeConfig({ loopPauseMs: 2000 });
    // Newer runs fail, older runs succeed → declining success rate
    const runs = [
      makeRun("t1", "failed", "2024-01-06T00:00:00Z"),
      makeRun("t2", "failed", "2024-01-05T00:00:00Z"),
      makeRun("t3", "failed", "2024-01-04T00:00:00Z"),
      makeRun("t4", "completed", "2024-01-03T00:00:00Z"),
      makeRun("t5", "completed", "2024-01-02T00:00:00Z"),
      makeRun("t6", "completed", "2024-01-01T00:00:00Z"),
    ];
    const result = analyzeAdaptive(runs, config, makeSettings());
    const pauseSuggestion = result.adjustments.find(
      (a) => a.category === "efficiency-tuning" && a.configKey === "loopPauseMs",
    );
    expect(pauseSuggestion).toBeDefined();
    expect((pauseSuggestion!.proposedValue as number)).toBeLessThan(2000);
  });

  it("suggests tightening token budget when actual usage is far below budget", () => {
    const config = makeConfig({ tokenBudget: 200000 });
    // All runs using very little tokens
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { tokenUsage: { input: 10000, output: 2000 } }),
    );
    const result = analyzeAdaptive(runs, config, makeSettings());
    const budgetSuggestion = result.adjustments.find(
      (a) => a.category === "efficiency-tuning" && a.configKey === "tokenBudget",
    );
    expect(budgetSuggestion).toBeDefined();
    expect((budgetSuggestion!.proposedValue as number)).toBeLessThan(200000);
    expect((budgetSuggestion!.proposedValue as number)).toBeGreaterThan(0);
  });
});

// ── Resource scaling adjustments ────────────────────────────────────

describe("resource scaling adjustments", () => {
  it("suggests increasing retries for high-volume workflows", () => {
    const config = makeConfig({ retry: { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000 } });
    // Many runs per day
    const baseTime = Date.now();
    const runs = Array.from({ length: 15 }, (_, i) =>
      makeRun(`t${i}`, "completed",
        new Date(baseTime - i * 3600000).toISOString(), // 1 per hour
        { turns: 10 }),
    );
    const result = analyzeAdaptive(runs, config, makeSettings());
    const retrySuggestion = result.adjustments.find(
      (a) => a.category === "resource-scaling" && a.configKey === "retry.maxRetries",
    );
    expect(retrySuggestion).toBeDefined();
    expect(retrySuggestion!.proposedValue).toBe(5);
  });

  it("suggests increasing command timeout for long-running tasks", () => {
    const config = makeConfig({
      guard: {
        blockedPaths: [],
        allowedCommands: ["npm"],
        commandTimeout: 30000,
        maxFileSize: 1048576,
      },
    });
    // Tasks taking > 5 minutes
    const runs = Array.from({ length: 6 }, (_, i) => {
      const startTime = new Date(`2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`).getTime();
      const finishTime = startTime + 10 * 60 * 1000; // 10 minute runs
      return makeRun(`t${i}`, "completed",
        new Date(startTime).toISOString(),
        {
          finishedAt: new Date(finishTime).toISOString(),
          turns: 10,
        });
    });
    const result = analyzeAdaptive(runs, config, makeSettings());
    const timeoutSuggestion = result.adjustments.find(
      (a) => a.category === "resource-scaling" && a.configKey === "guard.commandTimeout",
    );
    expect(timeoutSuggestion).toBeDefined();
    expect(timeoutSuggestion!.proposedValue).toBe(60000);
  });
});

// ── Locked keys ─────────────────────────────────────────────────────

describe("locked keys", () => {
  it("does not suggest adjustments for locked config keys", () => {
    const config = makeConfig({ maxTurns: 50 });
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 3 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );
    const settings = makeSettings({ lockedKeys: ["maxTurns"] });
    const result = analyzeAdaptive(runs, config, settings);
    const turnAdjustment = result.adjustments.find((a) => a.configKey === "maxTurns");
    expect(turnAdjustment).toBeUndefined();
  });
});

// ── Notifications ───────────────────────────────────────────────────

describe("notifications", () => {
  it("generates notifications for each adjustment", () => {
    const config = makeConfig({ maxTurns: 50 });
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 3 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );
    const result = analyzeAdaptive(runs, config, makeSettings());
    expect(result.notifications.length).toBe(result.adjustments.length);
  });

  it("marks auto-applicable notifications as auto-applied when enabled", () => {
    const config = makeConfig({ maxTurns: 50 });
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 3 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );
    const settings = makeSettings({ enabled: true });
    const result = analyzeAdaptive(runs, config, settings);
    const autoNotifs = result.notifications.filter((n) => n.type === "auto-applied");
    expect(autoNotifs.length).toBeGreaterThan(0);
  });

  it("marks all notifications as recommended when disabled", () => {
    const config = makeConfig({ maxTurns: 50 });
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 3 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );
    const settings = makeSettings({ enabled: false });
    const result = analyzeAdaptive(runs, config, settings);
    const autoNotifs = result.notifications.filter((n) => n.type === "auto-applied");
    expect(autoNotifs.length).toBe(0);
  });
});

// ── getAutoApplicable ───────────────────────────────────────────────

describe("getAutoApplicable", () => {
  it("returns only auto-applicable adjustments when enabled", () => {
    const config = makeConfig({ maxTurns: 50 });
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 3 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );
    const settings = makeSettings({ enabled: true });
    const result = analyzeAdaptive(runs, config, settings);
    const auto = getAutoApplicable(result, settings);
    expect(auto.every((a) => a.autoApplicable)).toBe(true);
  });

  it("returns empty array when disabled", () => {
    const config = makeConfig({ maxTurns: 50 });
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 3 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );
    const settings = makeSettings({ enabled: false });
    const result = analyzeAdaptive(runs, config, settings);
    const auto = getAutoApplicable(result, settings);
    expect(auto).toEqual([]);
  });

  it("filters out adjustments for locked keys", () => {
    const config = makeConfig({ maxTurns: 50 });
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 3 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );
    const settings = makeSettings({ enabled: true, lockedKeys: ["maxTurns"] });
    const result = analyzeAdaptive(runs, config, settings);
    const auto = getAutoApplicable(result, settings);
    expect(auto.every((a) => a.configKey !== "maxTurns")).toBe(true);
  });
});

// ── Adjustment structure ────────────────────────────────────────────

describe("adjustment structure", () => {
  it("every adjustment has required fields", () => {
    const config = makeConfig({ maxTurns: 50 });
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 3 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );
    const result = analyzeAdaptive(runs, config, makeSettings());

    for (const adj of result.adjustments) {
      expect(adj.id).toBeTruthy();
      expect(adj.category).toBeTruthy();
      expect(adj.priority).toMatch(/^(high|medium|low)$/);
      expect(adj.title).toBeTruthy();
      expect(adj.description).toBeTruthy();
      expect(adj.rationale).toBeTruthy();
      expect(adj.configChanges).toBeDefined();
      expect(typeof adj.autoApplicable).toBe("boolean");
      expect(adj.configKey).toBeTruthy();
      expect(adj.currentValue).toBeDefined();
      expect(adj.proposedValue).toBeDefined();
    }
  });
});
