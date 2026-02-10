import { describe, it, expect, beforeEach } from "vitest";
import type { RunRecord, HenchConfig } from "../../../src/schema/v1.js";
import {
  analyzeWorkflow,
  computeStats,
  _resetIdCounter,
  type WorkflowSuggestion,
} from "../../../src/agent/analysis/workflow.js";

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

beforeEach(() => {
  _resetIdCounter();
});

// ── computeStats ─────────────────────────────────────────────────────

describe("computeStats", () => {
  it("returns zero stats for empty runs", () => {
    const stats = computeStats([]);
    expect(stats.successRate).toBe(0);
    expect(stats.avgTurns).toBe(0);
    expect(stats.avgTokensPerRun).toBe(0);
    expect(stats.troubleTaskIds).toEqual([]);
  });

  it("computes success rate from finished runs only", () => {
    const runs = [
      makeRun("t1", "completed", "2024-01-01T01:00:00Z"),
      makeRun("t2", "completed", "2024-01-01T02:00:00Z"),
      makeRun("t3", "failed", "2024-01-01T03:00:00Z"),
      makeRun("t4", "running", "2024-01-01T04:00:00Z"),
    ];
    const stats = computeStats(runs);
    // 2 completed out of 3 finished (running excluded)
    expect(stats.successRate).toBeCloseTo(2 / 3, 3);
  });

  it("computes average turns", () => {
    const runs = [
      makeRun("t1", "completed", "2024-01-01T01:00:00Z", { turns: 10 }),
      makeRun("t2", "completed", "2024-01-01T02:00:00Z", { turns: 30 }),
    ];
    const stats = computeStats(runs);
    expect(stats.avgTurns).toBe(20);
  });

  it("computes average tokens per run", () => {
    const runs = [
      makeRun("t1", "completed", "2024-01-01T01:00:00Z", { tokenUsage: { input: 10000, output: 2000 } }),
      makeRun("t2", "completed", "2024-01-01T02:00:00Z", { tokenUsage: { input: 20000, output: 4000 } }),
    ];
    const stats = computeStats(runs);
    expect(stats.avgTokensPerRun).toBe(18000);
  });

  it("tracks failures by status", () => {
    const runs = [
      makeRun("t1", "failed", "2024-01-01T01:00:00Z"),
      makeRun("t2", "failed", "2024-01-01T02:00:00Z"),
      makeRun("t3", "timeout", "2024-01-01T03:00:00Z"),
      makeRun("t4", "completed", "2024-01-01T04:00:00Z"),
    ];
    const stats = computeStats(runs);
    expect(stats.failuresByStatus["failed"]).toBe(2);
    expect(stats.failuresByStatus["timeout"]).toBe(1);
    expect(stats.failuresByStatus["completed"]).toBeUndefined();
  });

  it("identifies trouble task IDs with 2+ failures", () => {
    const runs = [
      makeRun("t1", "failed", "2024-01-01T01:00:00Z"),
      makeRun("t1", "failed", "2024-01-01T02:00:00Z"),
      makeRun("t2", "failed", "2024-01-01T03:00:00Z"),
      makeRun("t3", "completed", "2024-01-01T04:00:00Z"),
    ];
    const stats = computeStats(runs);
    expect(stats.troubleTaskIds).toContain("t1");
    expect(stats.troubleTaskIds).not.toContain("t2");
  });

  it("counts turn limit hits", () => {
    const config = makeConfig({ maxTurns: 50 });
    const runs = [
      makeRun("t1", "completed", "2024-01-01T01:00:00Z", { turns: 50 }),
      makeRun("t2", "completed", "2024-01-01T02:00:00Z", { turns: 51 }),
      makeRun("t3", "completed", "2024-01-01T03:00:00Z", { turns: 20 }),
    ];
    const stats = computeStats(runs, config);
    expect(stats.turnLimitHits).toBe(2);
  });

  it("counts budget exceeded runs", () => {
    const runs = [
      makeRun("t1", "budget_exceeded", "2024-01-01T01:00:00Z"),
      makeRun("t2", "budget_exceeded", "2024-01-01T02:00:00Z"),
      makeRun("t3", "completed", "2024-01-01T03:00:00Z"),
    ];
    const stats = computeStats(runs);
    expect(stats.budgetExceededCount).toBe(2);
  });
});

// ── analyzeWorkflow ──────────────────────────────────────────────────

describe("analyzeWorkflow", () => {
  it("returns empty analysis for no runs", () => {
    const result = analyzeWorkflow([]);
    expect(result.totalRuns).toBe(0);
    expect(result.timeRange).toBeNull();
    expect(result.suggestions).toEqual([]);
  });

  it("includes time range from runs", () => {
    const runs = [
      makeRun("t1", "completed", "2024-01-03T00:00:00Z"),
      makeRun("t2", "completed", "2024-01-01T00:00:00Z"),
      makeRun("t3", "completed", "2024-01-02T00:00:00Z"),
    ];
    const result = analyzeWorkflow(runs);
    expect(result.timeRange).toEqual({
      earliest: "2024-01-01T00:00:00Z",
      latest: "2024-01-03T00:00:00Z",
    });
  });

  it("sorts suggestions by priority (high first)", () => {
    // Build a scenario with both high and low priority suggestions
    const runs = [
      // 3 timeouts → high priority failure prevention suggestion
      makeRun("t1", "timeout", "2024-01-01T01:00:00Z"),
      makeRun("t1", "timeout", "2024-01-01T02:00:00Z"),
      makeRun("t1", "timeout", "2024-01-01T03:00:00Z"),
      // Some completed runs → low priority token budget suggestion
      makeRun("t2", "completed", "2024-01-02T01:00:00Z"),
      makeRun("t3", "completed", "2024-01-02T02:00:00Z"),
      makeRun("t4", "completed", "2024-01-02T03:00:00Z"),
    ];
    const result = analyzeWorkflow(runs, makeConfig());
    expect(result.suggestions.length).toBeGreaterThan(0);

    const priorities = result.suggestions.map((s) => s.priority);
    // All high should come before medium, which come before low
    let lastPriority = 0;
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    for (const p of priorities) {
      expect(order[p]).toBeGreaterThanOrEqual(lastPriority);
      lastPriority = order[p];
    }
  });
});

// ── Token efficiency suggestions ─────────────────────────────────────

describe("token efficiency suggestions", () => {
  it("suggests token budget when high usage and low success rate", () => {
    const runs = [
      makeRun("t1", "failed", "2024-01-01T01:00:00Z", { tokenUsage: { input: 100000, output: 20000 } }),
      makeRun("t2", "failed", "2024-01-01T02:00:00Z", { tokenUsage: { input: 120000, output: 25000 } }),
      makeRun("t3", "completed", "2024-01-01T03:00:00Z", { tokenUsage: { input: 90000, output: 15000 } }),
    ];
    const config = makeConfig({ tokenBudget: 0 });
    const result = analyzeWorkflow(runs, config);
    const tokenSuggestion = result.suggestions.find((s) => s.category === "token-efficiency" && s.priority === "high");
    expect(tokenSuggestion).toBeDefined();
    expect(tokenSuggestion!.configChanges?.tokenBudget).toBeDefined();
  });

  it("suggests budget based on median usage for completed runs", () => {
    const runs = [
      makeRun("t1", "completed", "2024-01-01T01:00:00Z", { tokenUsage: { input: 4000, output: 1000 } }),
      makeRun("t2", "completed", "2024-01-01T02:00:00Z", { tokenUsage: { input: 5000, output: 1000 } }),
      makeRun("t3", "completed", "2024-01-01T03:00:00Z", { tokenUsage: { input: 6000, output: 1000 } }),
    ];
    const config = makeConfig({ tokenBudget: 0 });
    const result = analyzeWorkflow(runs, config);
    const budgetSuggestion = result.suggestions.find((s) =>
      s.category === "token-efficiency" && s.title.includes("token budget"),
    );
    expect(budgetSuggestion).toBeDefined();
    expect(budgetSuggestion!.autoApplicable).toBe(true);
  });
});

// ── Failure prevention suggestions ───────────────────────────────────

describe("failure prevention suggestions", () => {
  it("detects recurring timeout pattern", () => {
    const runs = [
      makeRun("t1", "timeout", "2024-01-01T01:00:00Z"),
      makeRun("t2", "timeout", "2024-01-01T02:00:00Z"),
      makeRun("t3", "completed", "2024-01-01T03:00:00Z"),
    ];
    const result = analyzeWorkflow(runs);
    const timeoutSuggestion = result.suggestions.find((s) =>
      s.category === "failure-prevention" && s.title.includes("timeout"),
    );
    expect(timeoutSuggestion).toBeDefined();
    expect(timeoutSuggestion!.priority).toBe("high");
  });

  it("detects frequent general failures", () => {
    const runs = [
      makeRun("t1", "failed", "2024-01-01T01:00:00Z"),
      makeRun("t2", "failed", "2024-01-01T02:00:00Z"),
      makeRun("t3", "failed", "2024-01-01T03:00:00Z"),
    ];
    const result = analyzeWorkflow(runs);
    const failureSuggestion = result.suggestions.find((s) =>
      s.category === "failure-prevention" && s.title.includes("Frequent"),
    );
    expect(failureSuggestion).toBeDefined();
  });

  it("identifies stuck tasks with concentrated failures", () => {
    const runs = [
      makeRun("stuck-task", "failed", "2024-01-01T01:00:00Z", { error: "Build failed" }),
      makeRun("stuck-task", "failed", "2024-01-01T02:00:00Z", { error: "Build failed" }),
      makeRun("stuck-task", "failed", "2024-01-01T03:00:00Z", { error: "Build failed" }),
    ];
    const result = analyzeWorkflow(runs);
    const stuckSuggestion = result.suggestions.find((s) =>
      s.category === "failure-prevention" && s.title.includes("stuck"),
    );
    expect(stuckSuggestion).toBeDefined();
    expect(stuckSuggestion!.affectedTaskIds).toContain("stuck-task");
  });
});

// ── Turn optimization suggestions ────────────────────────────────────

describe("turn optimization suggestions", () => {
  it("suggests increasing turns when many runs hit the limit", () => {
    const config = makeConfig({ maxTurns: 30 });
    const runs = [
      makeRun("t1", "timeout", "2024-01-01T01:00:00Z", { turns: 30 }),
      makeRun("t2", "failed", "2024-01-01T02:00:00Z", { turns: 30 }),
      makeRun("t3", "completed", "2024-01-01T03:00:00Z", { turns: 15 }),
    ];
    const result = analyzeWorkflow(runs, config);
    const turnSuggestion = result.suggestions.find((s) =>
      s.category === "turn-optimization" && s.title.includes("Turn limit"),
    );
    expect(turnSuggestion).toBeDefined();
    expect(turnSuggestion!.configChanges?.maxTurns).toBeDefined();
  });

  it("suggests lowering turns when runs complete well under limit", () => {
    const config = makeConfig({ maxTurns: 100 });
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, "completed", `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`, { turns: 10 + i }),
    );
    const result = analyzeWorkflow(runs, config);
    const lowerSuggestion = result.suggestions.find((s) =>
      s.category === "turn-optimization" && s.title.includes("higher than needed"),
    );
    expect(lowerSuggestion).toBeDefined();
    expect(lowerSuggestion!.autoApplicable).toBe(true);
  });
});

// ── Config tuning suggestions ────────────────────────────────────────

describe("config tuning suggestions", () => {
  it("suggests more retries when transient errors are frequent", () => {
    const config = makeConfig({ retry: { maxRetries: 2, baseDelayMs: 2000, maxDelayMs: 30000 } });
    const runs = [
      makeRun("t1", "error_transient", "2024-01-01T01:00:00Z"),
      makeRun("t2", "error_transient", "2024-01-01T02:00:00Z"),
      makeRun("t3", "error_transient", "2024-01-01T03:00:00Z"),
    ];
    const result = analyzeWorkflow(runs, config);
    const retrySuggestion = result.suggestions.find((s) =>
      s.category === "config-tuning" && s.title.includes("retry"),
    );
    expect(retrySuggestion).toBeDefined();
  });
});

// ── Task health suggestions ──────────────────────────────────────────

describe("task health suggestions", () => {
  it("flags tasks with excessive re-runs", () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      makeRun("repeat-task", "failed", `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`),
    );
    const result = analyzeWorkflow(runs);
    const healthSuggestion = result.suggestions.find((s) =>
      s.category === "task-health",
    );
    expect(healthSuggestion).toBeDefined();
    expect(healthSuggestion!.affectedTaskIds).toContain("repeat-task");
  });

  it("does not flag tasks under the threshold", () => {
    const runs = Array.from({ length: 4 }, (_, i) =>
      makeRun("few-task", "failed", `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`),
    );
    const result = analyzeWorkflow(runs);
    const healthSuggestion = result.suggestions.find((s) =>
      s.category === "task-health",
    );
    expect(healthSuggestion).toBeUndefined();
  });
});

// ── Suggestion structure ─────────────────────────────────────────────

describe("suggestion structure", () => {
  it("every suggestion has required fields", () => {
    const runs = [
      makeRun("t1", "timeout", "2024-01-01T01:00:00Z"),
      makeRun("t1", "timeout", "2024-01-01T02:00:00Z"),
      makeRun("t2", "failed", "2024-01-01T03:00:00Z"),
      makeRun("t2", "failed", "2024-01-01T04:00:00Z"),
      makeRun("t2", "failed", "2024-01-01T05:00:00Z"),
    ];
    const result = analyzeWorkflow(runs);

    for (const suggestion of result.suggestions) {
      expect(suggestion.id).toBeTruthy();
      expect(suggestion.category).toBeTruthy();
      expect(suggestion.priority).toMatch(/^(high|medium|low)$/);
      expect(suggestion.title).toBeTruthy();
      expect(suggestion.description).toBeTruthy();
      expect(suggestion.rationale).toBeTruthy();
      expect(suggestion.impact).toBeTruthy();
      expect(typeof suggestion.autoApplicable).toBe("boolean");
    }
  });

  it("auto-applicable suggestions have configChanges", () => {
    const runs = [
      makeRun("t1", "timeout", "2024-01-01T01:00:00Z"),
      makeRun("t2", "timeout", "2024-01-01T02:00:00Z"),
    ];
    const result = analyzeWorkflow(runs, makeConfig());
    const autoApplicable = result.suggestions.filter((s) => s.autoApplicable);

    for (const suggestion of autoApplicable) {
      expect(suggestion.configChanges).toBeDefined();
      expect(Object.keys(suggestion.configChanges!).length).toBeGreaterThan(0);
    }
  });
});
