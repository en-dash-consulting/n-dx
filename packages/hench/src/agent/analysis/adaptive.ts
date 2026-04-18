/**
 * Adaptive workflow adjustment engine — monitors project evolution metrics
 * and automatically adjusts workflow parameters as conditions change.
 *
 * Pure functions operating on RunRecord arrays and project metrics.
 * No I/O or side effects.
 */

import type { RunRecord, HenchConfig } from "../../schema/index.js";

// ── Types ────────────────────────────────────────────────────────────

export type AdjustmentCategory =
  | "complexity-scaling"
  | "velocity-tracking"
  | "codebase-growth"
  | "efficiency-tuning"
  | "resource-scaling";

export type AdjustmentPriority = "high" | "medium" | "low";

/** A snapshot of project evolution metrics at a point in time. */
export interface ProjectMetrics {
  /** ISO timestamp of the snapshot. */
  timestamp: string;
  /** Total run count at this point. */
  totalRuns: number;
  /** Success rate over recent window (0-1). */
  recentSuccessRate: number;
  /** Average turns for recent completed runs. */
  recentAvgTurns: number;
  /** Average tokens per run over recent window. */
  recentAvgTokens: number;
  /** Average duration in ms over recent window. */
  recentAvgDurationMs: number;
  /** Number of distinct tasks attempted in recent window. */
  recentTaskCount: number;
  /** Runs per day in the recent window (velocity). */
  runsPerDay: number;
  /** Success rate trend: positive means improving, negative means declining. */
  successRateTrend: number;
  /** Token usage trend: positive means increasing consumption. */
  tokenUsageTrend: number;
}

/** A recommended adjustment to workflow parameters. */
export interface WorkflowAdjustment {
  id: string;
  category: AdjustmentCategory;
  priority: AdjustmentPriority;
  title: string;
  description: string;
  rationale: string;
  /** Config changes to apply. Dot-path keys to values. */
  configChanges: Record<string, unknown>;
  /** Whether this can be auto-applied without user confirmation. */
  autoApplicable: boolean;
  /** Current value before adjustment. */
  currentValue: unknown;
  /** Proposed new value. */
  proposedValue: unknown;
  /** The config key being adjusted. */
  configKey: string;
}

/** A notification about an automatic or recommended adjustment. */
export interface AdjustmentNotification {
  id: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Whether this was automatically applied or just recommended. */
  type: "auto-applied" | "recommended";
  adjustment: WorkflowAdjustment;
  /** Human-readable reason why this adjustment was triggered. */
  reason: string;
}

/** Settings controlling adaptive behavior. */
export interface AdaptiveSettings {
  /** Master toggle for automatic adjustments. */
  enabled: boolean;
  /** Number of recent runs to consider for trend analysis. */
  windowSize: number;
  /** Minimum runs required before making adjustments. */
  minRunsRequired: number;
  /** Config keys that are locked from automatic adjustment. */
  lockedKeys: string[];
}

/** Full adaptive analysis result. */
export interface AdaptiveAnalysis {
  metrics: ProjectMetrics;
  adjustments: WorkflowAdjustment[];
  notifications: AdjustmentNotification[];
}

export function DEFAULT_ADAPTIVE_SETTINGS(): AdaptiveSettings {
  return {
    enabled: true,
    windowSize: 20,
    minRunsRequired: 5,
    lockedKeys: [],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(category: AdjustmentCategory): string {
  return `adj-${category}-${++idCounter}`;
}

/** Reset ID counter — only for testing. */
export function _resetIdCounter(): void {
  idCounter = 0;
}

function totalTokens(run: RunRecord): number {
  return (run.tokenUsage.input ?? 0) + (run.tokenUsage.output ?? 0);
}

function runDurationMs(run: RunRecord): number {
  if (!run.finishedAt) return 0;
  return new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
}

const FAILURE_STATUSES = new Set(["failed", "timeout", "budget_exceeded"]);

// ── Metrics computation ─────────────────────────────────────────────

/**
 * Collect project evolution metrics from run history.
 * Uses a sliding window of the most recent runs.
 */
export function collectMetrics(
  runs: RunRecord[],
  windowSize: number = 20,
): ProjectMetrics {
  const now = new Date().toISOString();

  if (runs.length === 0) {
    return {
      timestamp: now,
      totalRuns: 0,
      recentSuccessRate: 0,
      recentAvgTurns: 0,
      recentAvgTokens: 0,
      recentAvgDurationMs: 0,
      recentTaskCount: 0,
      runsPerDay: 0,
      successRateTrend: 0,
      tokenUsageTrend: 0,
    };
  }

  // Sort by startedAt descending (newest first)
  const sorted = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const recent = sorted.slice(0, windowSize);
  const finished = recent.filter((r) => r.status !== "running");
  const completed = finished.filter((r) => r.status === "completed");

  const recentSuccessRate = finished.length > 0
    ? completed.length / finished.length
    : 0;

  const recentAvgTurns = recent.length > 0
    ? recent.reduce((sum, r) => sum + r.turns, 0) / recent.length
    : 0;

  const recentAvgTokens = recent.length > 0
    ? recent.map(totalTokens).reduce((a, b) => a + b, 0) / recent.length
    : 0;

  const durations = recent.map(runDurationMs).filter((d) => d > 0);
  const recentAvgDurationMs = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  const recentTaskCount = new Set(recent.map((r) => r.taskId)).size;

  // Velocity: runs per day over the window
  let runsPerDay = 0;
  if (recent.length >= 2) {
    const oldest = new Date(recent[recent.length - 1].startedAt).getTime();
    const newest = new Date(recent[0].startedAt).getTime();
    const daySpan = (newest - oldest) / (1000 * 60 * 60 * 24);
    runsPerDay = daySpan > 0 ? recent.length / daySpan : 0;
  }

  // Trend analysis: compare first half vs second half of the window
  const halfSize = Math.floor(recent.length / 2);
  let successRateTrend = 0;
  let tokenUsageTrend = 0;

  if (halfSize >= 2) {
    const newerHalf = recent.slice(0, halfSize);
    const olderHalf = recent.slice(halfSize);

    const newerFinished = newerHalf.filter((r) => r.status !== "running");
    const olderFinished = olderHalf.filter((r) => r.status !== "running");

    const newerRate = newerFinished.length > 0
      ? newerFinished.filter((r) => r.status === "completed").length / newerFinished.length
      : 0;
    const olderRate = olderFinished.length > 0
      ? olderFinished.filter((r) => r.status === "completed").length / olderFinished.length
      : 0;
    successRateTrend = newerRate - olderRate;

    const newerTokens = newerHalf.length > 0
      ? newerHalf.map(totalTokens).reduce((a, b) => a + b, 0) / newerHalf.length
      : 0;
    const olderTokens = olderHalf.length > 0
      ? olderHalf.map(totalTokens).reduce((a, b) => a + b, 0) / olderHalf.length
      : 0;
    tokenUsageTrend = olderTokens > 0
      ? (newerTokens - olderTokens) / olderTokens
      : 0;
  }

  return {
    timestamp: now,
    totalRuns: runs.length,
    recentSuccessRate,
    recentAvgTurns,
    recentAvgTokens,
    recentAvgDurationMs,
    recentTaskCount,
    runsPerDay,
    successRateTrend,
    tokenUsageTrend,
  };
}

// ── Adjustment generators ───────────────────────────────────────────

function adjustComplexityScaling(
  metrics: ProjectMetrics,
  config: HenchConfig,
  settings: AdaptiveSettings,
): WorkflowAdjustment[] {
  const adjustments: WorkflowAdjustment[] = [];

  // As tasks get more complex (increasing avg turns), scale up maxTurns
  if (
    metrics.recentAvgTurns > config.maxTurns * 0.7 &&
    metrics.recentSuccessRate < 0.7 &&
    !settings.lockedKeys.includes("maxTurns")
  ) {
    const proposed = Math.min(Math.round(metrics.recentAvgTurns * 1.5), 100);
    if (proposed > config.maxTurns) {
      adjustments.push({
        id: nextId("complexity-scaling"),
        category: "complexity-scaling",
        priority: "high",
        title: "Scale up turn limit for increasing task complexity",
        description: `Recent tasks average ${Math.round(metrics.recentAvgTurns)} turns, which is ${Math.round((metrics.recentAvgTurns / config.maxTurns) * 100)}% of the current limit. Scaling up to accommodate growing complexity.`,
        rationale: `Average turn usage at ${Math.round((metrics.recentAvgTurns / config.maxTurns) * 100)}% of limit with ${Math.round(metrics.recentSuccessRate * 100)}% success rate suggests tasks need more room to complete.`,
        configChanges: { maxTurns: proposed },
        autoApplicable: true,
        currentValue: config.maxTurns,
        proposedValue: proposed,
        configKey: "maxTurns",
      });
    }
  }

  // Increasing token consumption with declining success → scale token budget
  if (
    metrics.tokenUsageTrend > 0.2 &&
    metrics.successRateTrend < -0.1 &&
    config.tokenBudget > 0 &&
    !settings.lockedKeys.includes("tokenBudget")
  ) {
    const proposed = Math.round(config.tokenBudget * 1.3);
    adjustments.push({
      id: nextId("complexity-scaling"),
      category: "complexity-scaling",
      priority: "medium",
      title: "Increase token budget for growing task complexity",
      description: `Token usage is trending up ${Math.round(metrics.tokenUsageTrend * 100)}% while success rate is declining. Increasing the budget may help tasks complete.`,
      rationale: `Token consumption increasing ${Math.round(metrics.tokenUsageTrend * 100)}% with success rate dropping ${Math.round(Math.abs(metrics.successRateTrend) * 100)} points.`,
      configChanges: { tokenBudget: proposed },
      autoApplicable: true,
      currentValue: config.tokenBudget,
      proposedValue: proposed,
      configKey: "tokenBudget",
    });
  }

  return adjustments;
}

function adjustVelocityTracking(
  metrics: ProjectMetrics,
  config: HenchConfig,
  settings: AdaptiveSettings,
): WorkflowAdjustment[] {
  const adjustments: WorkflowAdjustment[] = [];

  // High velocity with good success → tighten limits for cost savings
  if (
    metrics.runsPerDay > 5 &&
    metrics.recentSuccessRate > 0.85 &&
    metrics.recentAvgTurns < config.maxTurns * 0.4 &&
    config.maxTurns > 20 &&
    !settings.lockedKeys.includes("maxTurns")
  ) {
    const proposed = Math.max(Math.round(metrics.recentAvgTurns * 2), 20);
    if (proposed < config.maxTurns) {
      adjustments.push({
        id: nextId("velocity-tracking"),
        category: "velocity-tracking",
        priority: "low",
        title: "Optimize turn limit for high-velocity workflow",
        description: `Running ${metrics.runsPerDay.toFixed(1)} tasks/day with ${Math.round(metrics.recentSuccessRate * 100)}% success rate. Tasks typically complete in ${Math.round(metrics.recentAvgTurns)} turns — lowering the limit saves tokens on outliers.`,
        rationale: `High velocity (${metrics.runsPerDay.toFixed(1)}/day) with strong success (${Math.round(metrics.recentSuccessRate * 100)}%) allows tighter limits.`,
        configChanges: { maxTurns: proposed },
        autoApplicable: true,
        currentValue: config.maxTurns,
        proposedValue: proposed,
        configKey: "maxTurns",
      });
    }
  }

  // Low velocity with low success → increase maxFailedAttempts to avoid premature blocking
  if (
    metrics.runsPerDay < 1 &&
    metrics.recentSuccessRate < 0.5 &&
    metrics.totalRuns >= 5 &&
    config.maxFailedAttempts <= 3 &&
    !settings.lockedKeys.includes("maxFailedAttempts")
  ) {
    adjustments.push({
      id: nextId("velocity-tracking"),
      category: "velocity-tracking",
      priority: "medium",
      title: "Increase failure tolerance for low-velocity projects",
      description: `With only ${metrics.runsPerDay.toFixed(1)} runs/day, prematurely blocking tasks is costly. Increasing the failure threshold gives tasks more chances to succeed.`,
      rationale: `Low velocity means each run is valuable. Current ${config.maxFailedAttempts} attempt limit may be too aggressive.`,
      configChanges: { maxFailedAttempts: 5 },
      autoApplicable: true,
      currentValue: config.maxFailedAttempts,
      proposedValue: 5,
      configKey: "maxFailedAttempts",
    });
  }

  return adjustments;
}

function adjustEfficiency(
  metrics: ProjectMetrics,
  config: HenchConfig,
  settings: AdaptiveSettings,
): WorkflowAdjustment[] {
  const adjustments: WorkflowAdjustment[] = [];

  // Success rate declining → suggest reducing loop pause for faster iteration
  if (
    metrics.successRateTrend < -0.15 &&
    config.loopPauseMs > 1000 &&
    !settings.lockedKeys.includes("loopPauseMs")
  ) {
    const proposed = Math.max(Math.round(config.loopPauseMs * 0.5), 500);
    adjustments.push({
      id: nextId("efficiency-tuning"),
      category: "efficiency-tuning",
      priority: "low",
      title: "Reduce loop pause for faster iteration",
      description: `Success rate is declining (${Math.round(Math.abs(metrics.successRateTrend) * 100)} points). Faster iteration can help the agent recover more quickly from errors.`,
      rationale: `Declining success trend (${Math.round(metrics.successRateTrend * 100)}%) suggests the agent may benefit from faster feedback loops.`,
      configChanges: { loopPauseMs: proposed },
      autoApplicable: true,
      currentValue: config.loopPauseMs,
      proposedValue: proposed,
      configKey: "loopPauseMs",
    });
  }

  // Token budget set but runs consistently well under it → tighten for cost savings
  if (
    config.tokenBudget > 0 &&
    metrics.recentAvgTokens > 0 &&
    metrics.recentAvgTokens < config.tokenBudget * 0.3 &&
    metrics.recentSuccessRate > 0.7 &&
    !settings.lockedKeys.includes("tokenBudget")
  ) {
    const proposed = Math.round(metrics.recentAvgTokens * 2.5);
    if (proposed < config.tokenBudget) {
      adjustments.push({
        id: nextId("efficiency-tuning"),
        category: "efficiency-tuning",
        priority: "low",
        title: "Tighten token budget based on actual usage",
        description: `Runs average ${Math.round(metrics.recentAvgTokens).toLocaleString()} tokens, well below the ${config.tokenBudget.toLocaleString()} budget. Tightening saves cost while preserving headroom.`,
        rationale: `Average token usage is ${Math.round((metrics.recentAvgTokens / config.tokenBudget) * 100)}% of budget with ${Math.round(metrics.recentSuccessRate * 100)}% success rate.`,
        configChanges: { tokenBudget: proposed },
        autoApplicable: true,
        currentValue: config.tokenBudget,
        proposedValue: proposed,
        configKey: "tokenBudget",
      });
    }
  }

  return adjustments;
}

function adjustResourceScaling(
  metrics: ProjectMetrics,
  config: HenchConfig,
  settings: AdaptiveSettings,
): WorkflowAdjustment[] {
  const adjustments: WorkflowAdjustment[] = [];

  // High run volume → increase retry for resilience
  if (
    metrics.runsPerDay > 10 &&
    config.retry.maxRetries < 5 &&
    !settings.lockedKeys.includes("retry.maxRetries")
  ) {
    adjustments.push({
      id: nextId("resource-scaling"),
      category: "resource-scaling",
      priority: "medium",
      title: "Increase retries for high-volume workflow",
      description: `Running ${metrics.runsPerDay.toFixed(1)} tasks/day. Higher retry count improves resilience against transient API errors at scale.`,
      rationale: `High volume (${metrics.runsPerDay.toFixed(1)}/day) means transient errors are more likely to occur. More retries reduces manual intervention.`,
      configChanges: { "retry.maxRetries": 5 },
      autoApplicable: true,
      currentValue: config.retry.maxRetries,
      proposedValue: 5,
      configKey: "retry.maxRetries",
    });
  }

  // Long-running tasks → increase command timeout
  if (
    metrics.recentAvgDurationMs > 5 * 60 * 1000 &&
    config.guard.commandTimeout < 60000 &&
    !settings.lockedKeys.includes("guard.commandTimeout")
  ) {
    adjustments.push({
      id: nextId("resource-scaling"),
      category: "resource-scaling",
      priority: "medium",
      title: "Increase command timeout for long-running tasks",
      description: `Average task duration is ${Math.round(metrics.recentAvgDurationMs / 60000)} minutes. Commands may need more time to complete within longer-running tasks.`,
      rationale: `Tasks averaging ${Math.round(metrics.recentAvgDurationMs / 60000)}min may involve longer builds or test suites that exceed the ${config.guard.commandTimeout / 1000}s command timeout.`,
      configChanges: { "guard.commandTimeout": 60000 },
      autoApplicable: true,
      currentValue: config.guard.commandTimeout,
      proposedValue: 60000,
      configKey: "guard.commandTimeout",
    });
  }

  return adjustments;
}

// ── Main analysis function ───────────────────────────────────────────

/**
 * Analyze project evolution and produce adaptive workflow adjustments.
 *
 * @param runs  Run records (any order — will be sorted internally)
 * @param config  Current hench config
 * @param settings  Adaptive settings controlling behavior
 */
export function analyzeAdaptive(
  runs: RunRecord[],
  config: HenchConfig,
  settings: AdaptiveSettings = DEFAULT_ADAPTIVE_SETTINGS(),
): AdaptiveAnalysis {
  _resetIdCounter();

  const metrics = collectMetrics(runs, settings.windowSize);

  if (runs.length < settings.minRunsRequired) {
    return {
      metrics,
      adjustments: [],
      notifications: [],
    };
  }

  // Collect all adjustments
  const allAdjustments: WorkflowAdjustment[] = [
    ...adjustComplexityScaling(metrics, config, settings),
    ...adjustVelocityTracking(metrics, config, settings),
    ...adjustEfficiency(metrics, config, settings),
    ...adjustResourceScaling(metrics, config, settings),
  ];

  // Sort by priority: high → medium → low
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  allAdjustments.sort((a, b) =>
    (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2),
  );

  // Generate notifications
  const now = new Date().toISOString();
  const notifications: AdjustmentNotification[] = allAdjustments.map((adj) => ({
    id: `notif-${adj.id}`,
    timestamp: now,
    type: settings.enabled && adj.autoApplicable ? "auto-applied" : "recommended",
    adjustment: adj,
    reason: adj.rationale,
  }));

  return {
    metrics,
    adjustments: allAdjustments,
    notifications,
  };
}

/**
 * Filter adjustments to only those that should be auto-applied.
 * Respects the enabled flag and locked keys.
 */
export function getAutoApplicable(
  analysis: AdaptiveAnalysis,
  settings: AdaptiveSettings,
): WorkflowAdjustment[] {
  if (!settings.enabled) return [];
  return analysis.adjustments.filter(
    (adj) =>
      adj.autoApplicable &&
      !settings.lockedKeys.includes(adj.configKey),
  );
}
