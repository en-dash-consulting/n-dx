/**
 * Workflow analysis engine — analyzes historical run data to identify
 * bottlenecks, failure patterns, and optimization opportunities.
 *
 * Pure functions operating on RunRecord arrays. No I/O or side effects.
 */

import type { RunRecord, RunStatus, HenchConfig } from "../../schema/index.js";

// ── Types ────────────────────────────────────────────────────────────

export type SuggestionCategory =
  | "token-efficiency"
  | "failure-prevention"
  | "turn-optimization"
  | "config-tuning"
  | "task-health";

export type SuggestionPriority = "high" | "medium" | "low";

export interface WorkflowSuggestion {
  id: string;
  category: SuggestionCategory;
  priority: SuggestionPriority;
  title: string;
  description: string;
  rationale: string;
  impact: string;
  /** Config changes to apply if accepted. Dot-path keys to values. */
  configChanges?: Record<string, unknown>;
  /** Task IDs affected, if any. */
  affectedTaskIds?: string[];
  /** Whether this suggestion can be auto-applied via config change. */
  autoApplicable: boolean;
}

export interface WorkflowAnalysis {
  /** Total runs analyzed. */
  totalRuns: number;
  /** Time range covered. */
  timeRange: { earliest: string; latest: string } | null;
  /** Summary statistics. */
  stats: WorkflowStats;
  /** Optimization suggestions ordered by priority. */
  suggestions: WorkflowSuggestion[];
}

export interface WorkflowStats {
  successRate: number;
  avgTurns: number;
  avgTokensPerRun: number;
  avgDurationMs: number;
  failuresByStatus: Record<string, number>;
  /** Tasks with the most failures. */
  troubleTaskIds: string[];
  /** Runs that hit the max turn limit. */
  turnLimitHits: number;
  /** Runs that hit the token budget. */
  budgetExceededCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

const FAILURE_STATUSES: Set<RunStatus> = new Set(["failed", "timeout", "budget_exceeded"]);

function runDurationMs(run: RunRecord): number {
  if (!run.finishedAt) return 0;
  return new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
}

function totalTokens(run: RunRecord): number {
  return (run.tokenUsage.input ?? 0) + (run.tokenUsage.output ?? 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

let idCounter = 0;
function nextId(category: SuggestionCategory): string {
  return `${category}-${++idCounter}`;
}

/** Reset ID counter — only for testing. */
export function _resetIdCounter(): void {
  idCounter = 0;
}

// ── Stats computation ────────────────────────────────────────────────

export function computeStats(runs: RunRecord[], config?: HenchConfig): WorkflowStats {
  if (runs.length === 0) {
    return {
      successRate: 0,
      avgTurns: 0,
      avgTokensPerRun: 0,
      avgDurationMs: 0,
      failuresByStatus: {},
      troubleTaskIds: [],
      turnLimitHits: 0,
      budgetExceededCount: 0,
    };
  }

  const completedCount = runs.filter((r) => r.status === "completed").length;
  const finishedRuns = runs.filter((r) => r.status !== "running");
  const successRate = finishedRuns.length > 0 ? completedCount / finishedRuns.length : 0;

  const totalTurns = runs.reduce((sum, r) => sum + r.turns, 0);
  const avgTurns = totalTurns / runs.length;

  const tokenSums = runs.map(totalTokens);
  const avgTokensPerRun = tokenSums.reduce((a, b) => a + b, 0) / runs.length;

  const durations = runs.map(runDurationMs).filter((d) => d > 0);
  const avgDurationMs = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  // Failures by status
  const failuresByStatus: Record<string, number> = {};
  for (const run of runs) {
    if (FAILURE_STATUSES.has(run.status)) {
      failuresByStatus[run.status] = (failuresByStatus[run.status] ?? 0) + 1;
    }
  }

  // Tasks with the most failures
  const taskFailures = new Map<string, number>();
  for (const run of runs) {
    if (FAILURE_STATUSES.has(run.status)) {
      taskFailures.set(run.taskId, (taskFailures.get(run.taskId) ?? 0) + 1);
    }
  }
  const troubleTaskIds = [...taskFailures.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  // Detect runs that hit limits
  const maxTurns = config?.maxTurns ?? 50;
  const turnLimitHits = runs.filter((r) => r.turns >= maxTurns).length;
  const budgetExceededCount = runs.filter((r) => r.status === "budget_exceeded").length;

  return {
    successRate,
    avgTurns,
    avgTokensPerRun,
    avgDurationMs,
    failuresByStatus,
    troubleTaskIds,
    turnLimitHits,
    budgetExceededCount,
  };
}

// ── Suggestion generators ────────────────────────────────────────────

function suggestTokenEfficiency(
  runs: RunRecord[],
  stats: WorkflowStats,
  config?: HenchConfig,
): WorkflowSuggestion[] {
  const suggestions: WorkflowSuggestion[] = [];

  // High token usage with low success rate
  if (stats.avgTokensPerRun > 100000 && stats.successRate < 0.5) {
    suggestions.push({
      id: nextId("token-efficiency"),
      category: "token-efficiency",
      priority: "high",
      title: "High token consumption with low success rate",
      description: "Runs are consuming significant tokens but failing frequently. Consider reducing token budget to fail faster on hard tasks.",
      rationale: `Average ${Math.round(stats.avgTokensPerRun).toLocaleString()} tokens/run with only ${Math.round(stats.successRate * 100)}% success rate.`,
      impact: "Reduces wasted tokens on tasks that are unlikely to succeed.",
      configChanges: config?.tokenBudget === 0
        ? { tokenBudget: Math.round(stats.avgTokensPerRun * 0.7) }
        : undefined,
      autoApplicable: config?.tokenBudget === 0 || false,
    });
  }

  // Runs that complete quickly could use a lower budget
  const completedRuns = runs.filter((r) => r.status === "completed");
  if (completedRuns.length >= 3) {
    const completedTokens = completedRuns.map(totalTokens);
    const medianTokens = median(completedTokens);
    const currentBudget = config?.tokenBudget ?? 0;

    if (currentBudget === 0 && medianTokens > 0) {
      // No budget set — suggest one based on median usage with headroom
      const suggestedBudget = Math.round(medianTokens * 2);
      suggestions.push({
        id: nextId("token-efficiency"),
        category: "token-efficiency",
        priority: "low",
        title: "Set a token budget based on historical usage",
        description: `Successful runs use a median of ${medianTokens.toLocaleString()} tokens. A budget would cap runaway costs.`,
        rationale: `${completedRuns.length} completed runs analyzed. Median: ${medianTokens.toLocaleString()} tokens.`,
        impact: `Budget of ${suggestedBudget.toLocaleString()} (2x median) protects against unbounded runs.`,
        configChanges: { tokenBudget: suggestedBudget },
        autoApplicable: true,
      });
    }
  }

  return suggestions;
}

function suggestFailurePrevention(
  runs: RunRecord[],
  stats: WorkflowStats,
): WorkflowSuggestion[] {
  const suggestions: WorkflowSuggestion[] = [];

  // Recurring timeout pattern
  if ((stats.failuresByStatus["timeout"] ?? 0) >= 2) {
    const timeoutCount = stats.failuresByStatus["timeout"];
    suggestions.push({
      id: nextId("failure-prevention"),
      category: "failure-prevention",
      priority: "high",
      title: "Recurring timeout failures",
      description: `${timeoutCount} runs have timed out. Tasks may be too large or the turn limit too low for the work required.`,
      rationale: `${timeoutCount} timeout failures out of ${runs.length} total runs.`,
      impact: "Increasing max turns or splitting tasks may improve completion rate.",
      configChanges: { maxTurns: 80 },
      autoApplicable: true,
    });
  }

  // Recurring general failures
  if ((stats.failuresByStatus["failed"] ?? 0) >= 3) {
    const failedCount = stats.failuresByStatus["failed"];
    suggestions.push({
      id: nextId("failure-prevention"),
      category: "failure-prevention",
      priority: "medium",
      title: "Frequent task failures",
      description: `${failedCount} runs have failed. Reviewing error patterns may reveal systemic issues.`,
      rationale: `${failedCount} failures across ${runs.length} runs (${Math.round((failedCount / runs.length) * 100)}% failure rate).`,
      impact: "Identifying root causes can prevent repeated failed attempts.",
      affectedTaskIds: stats.troubleTaskIds.slice(0, 5),
      autoApplicable: false,
    });
  }

  // Tasks with concentrated failures
  for (const taskId of stats.troubleTaskIds.slice(0, 3)) {
    const taskRuns = runs.filter((r) => r.taskId === taskId);
    const taskFailures = taskRuns.filter((r) => FAILURE_STATUSES.has(r.status));
    const taskErrors = taskRuns
      .filter((r) => r.error)
      .map((r) => r.error!)
      .slice(0, 3);

    if (taskFailures.length >= 3) {
      suggestions.push({
        id: nextId("failure-prevention"),
        category: "failure-prevention",
        priority: "high",
        title: `Task "${taskRuns[0]?.taskTitle ?? taskId}" is stuck`,
        description: `This task has failed ${taskFailures.length} times out of ${taskRuns.length} attempts.${taskErrors.length > 0 ? ` Recent errors: ${taskErrors[0]?.slice(0, 100)}` : ""}`,
        rationale: `${taskFailures.length} failures suggest the task may need manual review, splitting, or scope reduction.`,
        impact: "Prevents further wasted runs on a blocked task.",
        affectedTaskIds: [taskId],
        autoApplicable: false,
      });
    }
  }

  return suggestions;
}

function suggestTurnOptimization(
  runs: RunRecord[],
  stats: WorkflowStats,
  config?: HenchConfig,
): WorkflowSuggestion[] {
  const suggestions: WorkflowSuggestion[] = [];
  const maxTurns = config?.maxTurns ?? 50;

  // Many runs hitting the turn limit
  if (stats.turnLimitHits >= 2 && runs.length >= 3) {
    const hitRate = stats.turnLimitHits / runs.length;
    if (hitRate > 0.3) {
      suggestions.push({
        id: nextId("turn-optimization"),
        category: "turn-optimization",
        priority: "high",
        title: "Turn limit reached frequently",
        description: `${stats.turnLimitHits} of ${runs.length} runs (${Math.round(hitRate * 100)}%) hit the ${maxTurns}-turn limit. Tasks may need more room to complete.`,
        rationale: `Turn limit hit rate is ${Math.round(hitRate * 100)}%. Runs that hit the limit are often incomplete.`,
        impact: `Increasing maxTurns to ${Math.min(maxTurns * 2, 100)} gives tasks more room to finish.`,
        configChanges: { maxTurns: Math.min(maxTurns * 2, 100) },
        autoApplicable: true,
      });
    }
  }

  // Runs completing well under the turn limit — suggest lowering for cost savings
  const completedRuns = runs.filter((r) => r.status === "completed");
  if (completedRuns.length >= 5) {
    const turnUsages = completedRuns.map((r) => r.turns);
    const medianTurns = median(turnUsages);
    const p90Turns = turnUsages.sort((a, b) => a - b)[Math.floor(turnUsages.length * 0.9)];

    if (p90Turns !== undefined && p90Turns < maxTurns * 0.5 && maxTurns > 20) {
      suggestions.push({
        id: nextId("turn-optimization"),
        category: "turn-optimization",
        priority: "low",
        title: "Turn limit is much higher than needed",
        description: `Successful runs use a median of ${medianTurns} turns, but the limit is ${maxTurns}. Lowering the limit saves tokens on runaway runs.`,
        rationale: `P90 turn usage is ${p90Turns}, well below the ${maxTurns} limit.`,
        impact: `Setting maxTurns to ${Math.max(Math.round(p90Turns * 1.5), 20)} covers 90% of successful runs with headroom.`,
        configChanges: { maxTurns: Math.max(Math.round(p90Turns * 1.5), 20) },
        autoApplicable: true,
      });
    }
  }

  return suggestions;
}

function suggestConfigTuning(
  runs: RunRecord[],
  _stats: WorkflowStats,
  config?: HenchConfig,
): WorkflowSuggestion[] {
  const suggestions: WorkflowSuggestion[] = [];

  // Check retry config against transient error frequency
  const transientErrors = runs.filter((r) => r.status === "error_transient");
  const retriedRuns = runs.filter((r) => (r.retryAttempts ?? 0) > 0);
  const maxRetries = config?.retry?.maxRetries ?? 3;

  if (transientErrors.length >= 3 && maxRetries < 5) {
    suggestions.push({
      id: nextId("config-tuning"),
      category: "config-tuning",
      priority: "medium",
      title: "Increase retry count for transient errors",
      description: `${transientErrors.length} runs ended with transient errors. Higher retry count may recover more.`,
      rationale: `Current max retries: ${maxRetries}. ${transientErrors.length} transient errors suggest API instability.`,
      impact: "More retries can recover from temporary API issues without manual intervention.",
      configChanges: { "retry.maxRetries": 5 },
      autoApplicable: true,
    });
  }

  // Check stuck threshold
  const stuckThreshold = config?.maxFailedAttempts ?? 3;
  if (stuckThreshold > 3) {
    // Count tasks that exhausted all attempts without recovering
    const taskRuns = new Map<string, RunRecord[]>();
    for (const run of runs) {
      const existing = taskRuns.get(run.taskId) ?? [];
      existing.push(run);
      taskRuns.set(run.taskId, existing);
    }

    const neverRecovered = [...taskRuns.values()].filter((taskRunList) => {
      const sorted = [...taskRunList].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      let failures = 0;
      for (const r of sorted) {
        if (FAILURE_STATUSES.has(r.status)) failures++;
        else break;
      }
      return failures >= stuckThreshold;
    });

    if (neverRecovered.length >= 2) {
      suggestions.push({
        id: nextId("config-tuning"),
        category: "config-tuning",
        priority: "medium",
        title: "Lower stuck threshold to skip failing tasks sooner",
        description: `${neverRecovered.length} tasks exhausted all ${stuckThreshold} attempts without recovery. A lower threshold saves resources.`,
        rationale: `Stuck threshold is ${stuckThreshold}, but tasks that fail 3 times rarely recover.`,
        impact: `Setting maxFailedAttempts to 3 stops wasting runs on deeply stuck tasks.`,
        configChanges: { maxFailedAttempts: 3 },
        autoApplicable: true,
      });
    }
  }

  return suggestions;
}

function suggestTaskHealth(
  runs: RunRecord[],
  _stats: WorkflowStats,
): WorkflowSuggestion[] {
  const suggestions: WorkflowSuggestion[] = [];

  // Find tasks that are being re-run excessively
  const taskRunCounts = new Map<string, { count: number; title: string }>();
  for (const run of runs) {
    const entry = taskRunCounts.get(run.taskId) ?? { count: 0, title: run.taskTitle };
    entry.count++;
    taskRunCounts.set(run.taskId, entry);
  }

  const excessiveRuns = [...taskRunCounts.entries()]
    .filter(([, info]) => info.count >= 5)
    .sort((a, b) => b[1].count - a[1].count);

  for (const [taskId, info] of excessiveRuns.slice(0, 3)) {
    suggestions.push({
      id: nextId("task-health"),
      category: "task-health",
      priority: "medium",
      title: `Task "${info.title}" has been run ${info.count} times`,
      description: `This task has been attempted ${info.count} times. It may need to be broken into smaller subtasks or have its requirements clarified.`,
      rationale: `${info.count} runs for a single task indicates scope or complexity issues.`,
      impact: "Splitting or clarifying the task will improve success rate.",
      affectedTaskIds: [taskId],
      autoApplicable: false,
    });
  }

  return suggestions;
}

// ── Main analysis function ───────────────────────────────────────────

/**
 * Analyze workflow run history and produce optimization suggestions.
 *
 * @param runs  Run records sorted by startedAt descending (newest first)
 * @param config  Optional current hench config for context-aware suggestions
 */
export function analyzeWorkflow(
  runs: RunRecord[],
  config?: HenchConfig,
): WorkflowAnalysis {
  // Reset ID counter for deterministic IDs per analysis call
  _resetIdCounter();

  if (runs.length === 0) {
    return {
      totalRuns: 0,
      timeRange: null,
      stats: computeStats([]),
      suggestions: [],
    };
  }

  const stats = computeStats(runs, config);

  // Compute time range
  const sorted = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const timeRange = {
    earliest: sorted[0].startedAt,
    latest: sorted[sorted.length - 1].startedAt,
  };

  // Collect all suggestions
  const allSuggestions: WorkflowSuggestion[] = [
    ...suggestTokenEfficiency(runs, stats, config),
    ...suggestFailurePrevention(runs, stats),
    ...suggestTurnOptimization(runs, stats, config),
    ...suggestConfigTuning(runs, stats, config),
    ...suggestTaskHealth(runs, stats),
  ];

  // Sort by priority: high → medium → low
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  allSuggestions.sort((a, b) =>
    (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)
  );

  return {
    totalRuns: runs.length,
    timeRange,
    stats,
    suggestions: allSuggestions,
  };
}
