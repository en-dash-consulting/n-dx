/**
 * Concurrent execution metrics collection and resource utilization tracking.
 *
 * Collects time-series snapshots of concurrent process counts, total memory
 * utilization across all hench processes, and per-task resource metrics.
 * Snapshots are stored in bounded ring buffers and aggregated into patterns
 * (peak, average) for dashboard consumption.
 *
 * This is the web-server counterpart to hench's own ConcurrentExecutionMetrics.
 * Implemented separately to avoid adding a runtime dependency from
 * @n-dx/web to hench (web reads hench data from disk, never imports it).
 *
 * @module @n-dx/web/server/concurrent-execution-metrics
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time-series snapshots retained (ring buffer size). */
const DEFAULT_MAX_SNAPSHOTS = 360;

/** Maximum completed task metrics retained for post-mortem analysis. */
const DEFAULT_MAX_COMPLETED_TASKS = 50;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ConcurrentExecutionMetricsConfig {
  maxSnapshots: number;
  maxCompletedTasks: number;
}

export const DEFAULT_CONCURRENT_EXECUTION_METRICS_CONFIG: ConcurrentExecutionMetricsConfig = {
  maxSnapshots: DEFAULT_MAX_SNAPSHOTS,
  maxCompletedTasks: DEFAULT_MAX_COMPLETED_TASKS,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single point-in-time snapshot of concurrent execution state. */
export interface ExecutionMetricsSnapshot {
  concurrentCount: number;
  totalRssBytes: number;
  systemMemoryPercent: number;
  loadAvg1m: number;
  timestamp: string;
  epochMs: number;
}

/** Resource utilization metrics for a single task execution. */
export interface TaskResourceMetrics {
  taskId: string;
  taskTitle: string;
  pid: number;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  peakRssBytes: number;
  avgRssBytes: number;
  currentRssBytes: number;
  sampleCount: number;
  avgConcurrentDuringExecution: number;
}

/** Aggregated utilization patterns from time-series data. */
export interface UtilizationPatterns {
  peakConcurrent: number;
  avgConcurrent: number;
  peakTotalRssBytes: number;
  avgTotalRssBytes: number;
  avgSystemMemoryPercent: number;
  peakSystemMemoryPercent: number;
  avgLoadAvg1m: number;
  peakLoadAvg1m: number;
  windowDurationMs: number;
  snapshotCount: number;
}

/** Full metrics summary for API response. */
export interface ExecutionMetricsSummary {
  current: ExecutionMetricsSnapshot;
  patterns: UtilizationPatterns;
  activeTasks: TaskResourceMetrics[];
  completedTasks: TaskResourceMetrics[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Internal per-task tracking
// ---------------------------------------------------------------------------

interface TrackedTaskMetrics {
  taskId: string;
  taskTitle: string;
  pid: number;
  startedAt: string;
  startedEpochMs: number;
  completedAt?: string;
  completedEpochMs?: number;
  rssSumBytes: number;
  rssSampleCount: number;
  peakRssBytes: number;
  currentRssBytes: number;
  concurrentSum: number;
  concurrentSampleCount: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// ConcurrentExecutionMetrics
// ---------------------------------------------------------------------------

/**
 * Collects and aggregates concurrent execution metrics across hench processes.
 *
 * Records periodic snapshots of concurrent process counts and memory utilization,
 * tracks per-task resource usage, and computes utilization patterns.
 */
export class ConcurrentExecutionMetrics {
  private readonly _config: ConcurrentExecutionMetricsConfig;
  private readonly _snapshots: ExecutionMetricsSnapshot[] = [];
  private readonly _activeTasks = new Map<string, TrackedTaskMetrics>();
  private readonly _completedTasks: TrackedTaskMetrics[] = [];
  private readonly _now: () => number;

  constructor(
    config?: Partial<ConcurrentExecutionMetricsConfig>,
    overrides?: { now?: () => number },
  ) {
    this._config = { ...DEFAULT_CONCURRENT_EXECUTION_METRICS_CONFIG, ...config };
    this._now = overrides?.now ?? Date.now;
  }

  get config(): Readonly<ConcurrentExecutionMetricsConfig> {
    return { ...this._config };
  }

  get snapshotCount(): number {
    return this._snapshots.length;
  }

  get activeTaskCount(): number {
    return this._activeTasks.size;
  }

  get completedTaskCount(): number {
    return this._completedTasks.length;
  }

  // -----------------------------------------------------------------------
  // Task lifecycle
  // -----------------------------------------------------------------------

  taskStarted(taskId: string, taskTitle: string, pid: number): void {
    const now = this._now();
    this._activeTasks.set(taskId, {
      taskId,
      taskTitle,
      pid,
      startedAt: new Date(now).toISOString(),
      startedEpochMs: now,
      rssSumBytes: 0,
      rssSampleCount: 0,
      peakRssBytes: 0,
      currentRssBytes: 0,
      concurrentSum: 0,
      concurrentSampleCount: 0,
      active: true,
    });
  }

  taskCompleted(taskId: string): void {
    const tracked = this._activeTasks.get(taskId);
    if (!tracked) return;

    const now = this._now();
    tracked.active = false;
    tracked.completedAt = new Date(now).toISOString();
    tracked.completedEpochMs = now;
    this._activeTasks.delete(taskId);

    this._completedTasks.push(tracked);
    while (this._completedTasks.length > this._config.maxCompletedTasks) {
      this._completedTasks.shift();
    }
  }

  // -----------------------------------------------------------------------
  // Snapshot recording
  // -----------------------------------------------------------------------

  recordSnapshot(input: {
    concurrentCount: number;
    totalRssBytes: number;
    systemMemoryPercent: number;
    loadAvg1m: number;
    perTaskRss: Array<{ taskId: string; rssBytes: number }>;
  }): void {
    const now = this._now();
    const snapshot: ExecutionMetricsSnapshot = {
      concurrentCount: input.concurrentCount,
      totalRssBytes: input.totalRssBytes,
      systemMemoryPercent: input.systemMemoryPercent,
      loadAvg1m: input.loadAvg1m,
      timestamp: new Date(now).toISOString(),
      epochMs: now,
    };

    if (this._snapshots.length >= this._config.maxSnapshots) {
      this._snapshots.shift();
    }
    this._snapshots.push(snapshot);

    for (const { taskId, rssBytes } of input.perTaskRss) {
      const tracked = this._activeTasks.get(taskId);
      if (!tracked) continue;

      tracked.rssSumBytes += rssBytes;
      tracked.rssSampleCount += 1;
      tracked.currentRssBytes = rssBytes;
      if (rssBytes > tracked.peakRssBytes) {
        tracked.peakRssBytes = rssBytes;
      }

      tracked.concurrentSum += input.concurrentCount;
      tracked.concurrentSampleCount += 1;
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getLatestSnapshot(): ExecutionMetricsSnapshot {
    const last = this._snapshots[this._snapshots.length - 1];
    if (last) return { ...last };

    const now = this._now();
    return {
      concurrentCount: 0,
      totalRssBytes: 0,
      systemMemoryPercent: 0,
      loadAvg1m: 0,
      timestamp: new Date(now).toISOString(),
      epochMs: now,
    };
  }

  getSnapshots(): ExecutionMetricsSnapshot[] {
    return this._snapshots.map((s) => ({ ...s }));
  }

  computePatterns(): UtilizationPatterns {
    const n = this._snapshots.length;

    if (n === 0) {
      return {
        peakConcurrent: 0,
        avgConcurrent: 0,
        peakTotalRssBytes: 0,
        avgTotalRssBytes: 0,
        avgSystemMemoryPercent: 0,
        peakSystemMemoryPercent: 0,
        avgLoadAvg1m: 0,
        peakLoadAvg1m: 0,
        windowDurationMs: 0,
        snapshotCount: 0,
      };
    }

    let sumConcurrent = 0;
    let peakConcurrent = 0;
    let sumRss = 0;
    let peakRss = 0;
    let sumMemPercent = 0;
    let peakMemPercent = 0;
    let sumLoad = 0;
    let peakLoad = 0;

    for (const s of this._snapshots) {
      sumConcurrent += s.concurrentCount;
      if (s.concurrentCount > peakConcurrent) peakConcurrent = s.concurrentCount;

      sumRss += s.totalRssBytes;
      if (s.totalRssBytes > peakRss) peakRss = s.totalRssBytes;

      sumMemPercent += s.systemMemoryPercent;
      if (s.systemMemoryPercent > peakMemPercent) peakMemPercent = s.systemMemoryPercent;

      sumLoad += s.loadAvg1m;
      if (s.loadAvg1m > peakLoad) peakLoad = s.loadAvg1m;
    }

    const first = this._snapshots[0]!;
    const last = this._snapshots[n - 1]!;
    const windowDurationMs = last.epochMs - first.epochMs;

    return {
      peakConcurrent,
      avgConcurrent: Math.round((sumConcurrent / n) * 100) / 100,
      peakTotalRssBytes: peakRss,
      avgTotalRssBytes: Math.round(sumRss / n),
      avgSystemMemoryPercent: Math.round((sumMemPercent / n) * 100) / 100,
      peakSystemMemoryPercent: peakMemPercent,
      avgLoadAvg1m: Math.round((sumLoad / n) * 100) / 100,
      peakLoadAvg1m: Math.round(peakLoad * 100) / 100,
      windowDurationMs,
      snapshotCount: n,
    };
  }

  getActiveTaskMetrics(): TaskResourceMetrics[] {
    const now = this._now();
    const result: TaskResourceMetrics[] = [];
    for (const t of this._activeTasks.values()) {
      result.push(this._buildTaskMetrics(t, now));
    }
    return result;
  }

  getCompletedTaskMetrics(): TaskResourceMetrics[] {
    const now = this._now();
    return this._completedTasks.map((t) => this._buildTaskMetrics(t, now));
  }

  getSummary(): ExecutionMetricsSummary {
    const now = this._now();
    return {
      current: this.getLatestSnapshot(),
      patterns: this.computePatterns(),
      activeTasks: this.getActiveTaskMetrics(),
      completedTasks: this.getCompletedTaskMetrics(),
      timestamp: new Date(now).toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  reset(): void {
    this._snapshots.length = 0;
    this._activeTasks.clear();
    this._completedTasks.length = 0;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private _buildTaskMetrics(
    tracked: TrackedTaskMetrics,
    now: number,
  ): TaskResourceMetrics {
    const endTime = tracked.completedEpochMs ?? now;
    const durationMs = endTime - tracked.startedEpochMs;
    const avgRss = tracked.rssSampleCount > 0
      ? Math.round(tracked.rssSumBytes / tracked.rssSampleCount)
      : 0;
    const avgConcurrent = tracked.concurrentSampleCount > 0
      ? Math.round((tracked.concurrentSum / tracked.concurrentSampleCount) * 100) / 100
      : 0;

    return {
      taskId: tracked.taskId,
      taskTitle: tracked.taskTitle,
      pid: tracked.pid,
      startedAt: tracked.startedAt,
      completedAt: tracked.completedAt,
      durationMs,
      peakRssBytes: tracked.peakRssBytes,
      avgRssBytes: avgRss,
      currentRssBytes: tracked.currentRssBytes,
      sampleCount: tracked.rssSampleCount,
      avgConcurrentDuringExecution: avgConcurrent,
    };
  }
}
