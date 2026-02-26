/**
 * Concurrent execution metrics collection and resource utilization tracking.
 *
 * Collects time-series snapshots of concurrent process counts, total memory
 * utilization across all hench processes, and per-task resource metrics.
 * Snapshots are stored in bounded ring buffers and aggregated into patterns
 * (peak, average, percentiles) for dashboard consumption.
 *
 * Key differences from sibling modules:
 * - **ProcessMemoryTracker** — per-process memory history + leak detection
 * - **SystemMemoryMonitor** — system-wide memory gating for pre-spawn checks
 * - **ConcurrentExecutionMetrics** — cross-process aggregate metrics over time
 *
 * Integration points:
 * - Web server calls {@link ConcurrentExecutionMetrics.recordSnapshot} during
 *   periodic broadcasts to accumulate metrics history
 * - API endpoints expose metrics via {@link getSnapshot} and {@link getSummary}
 * - Per-task lifecycle hooks via {@link taskStarted} and {@link taskCompleted}
 *
 * @module hench/process/concurrent-execution-metrics
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

/**
 * Configuration for the concurrent execution metrics collector.
 */
export interface ConcurrentExecutionMetricsConfig {
  /** Maximum time-series snapshots in the ring buffer. */
  maxSnapshots: number;
  /** Maximum completed task metrics retained. */
  maxCompletedTasks: number;
}

/** Default concurrent execution metrics configuration. */
export const DEFAULT_CONCURRENT_EXECUTION_METRICS_CONFIG: ConcurrentExecutionMetricsConfig = {
  maxSnapshots: DEFAULT_MAX_SNAPSHOTS,
  maxCompletedTasks: DEFAULT_MAX_COMPLETED_TASKS,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single point-in-time snapshot of concurrent execution state.
 */
export interface ExecutionMetricsSnapshot {
  /** Number of concurrently running hench processes. */
  concurrentCount: number;
  /** Total RSS across all tracked hench processes (bytes). */
  totalRssBytes: number;
  /** System memory usage percentage at snapshot time (0–100). */
  systemMemoryPercent: number;
  /** System load average (1-minute). */
  loadAvg1m: number;
  /** ISO timestamp of the snapshot. */
  timestamp: string;
  /** Epoch milliseconds (for efficient calculations). */
  epochMs: number;
}

/**
 * Resource utilization metrics for a single task execution.
 */
export interface TaskResourceMetrics {
  /** Task identifier. */
  taskId: string;
  /** Human-readable task title. */
  taskTitle: string;
  /** Process ID (last known). */
  pid: number;
  /** When the task started. */
  startedAt: string;
  /** When the task completed (undefined if still running). */
  completedAt?: string;
  /** Duration in milliseconds (computed from start to now or completion). */
  durationMs: number;
  /** Peak RSS observed during execution (bytes). */
  peakRssBytes: number;
  /** Average RSS across all samples (bytes). */
  avgRssBytes: number;
  /** Most recent RSS (bytes). */
  currentRssBytes: number;
  /** Number of RSS samples collected. */
  sampleCount: number;
  /** Average concurrent task count while this task was running. */
  avgConcurrentDuringExecution: number;
}

/**
 * Aggregated utilization patterns derived from time-series data.
 */
export interface UtilizationPatterns {
  /** Peak concurrent process count observed. */
  peakConcurrent: number;
  /** Average concurrent process count. */
  avgConcurrent: number;
  /** Peak total RSS across all processes (bytes). */
  peakTotalRssBytes: number;
  /** Average total RSS across all processes (bytes). */
  avgTotalRssBytes: number;
  /** Average system memory usage percentage. */
  avgSystemMemoryPercent: number;
  /** Peak system memory usage percentage. */
  peakSystemMemoryPercent: number;
  /** Average system load (1-minute). */
  avgLoadAvg1m: number;
  /** Peak system load (1-minute). */
  peakLoadAvg1m: number;
  /** Duration of the observation window (milliseconds). */
  windowDurationMs: number;
  /** Number of snapshots in the window. */
  snapshotCount: number;
}

/**
 * Full metrics summary for API response.
 */
export interface ExecutionMetricsSummary {
  /** Current real-time snapshot. */
  current: ExecutionMetricsSnapshot;
  /** Aggregated utilization patterns over the observation window. */
  patterns: UtilizationPatterns;
  /** Resource metrics for actively running tasks. */
  activeTasks: TaskResourceMetrics[];
  /** Resource metrics for recently completed tasks. */
  completedTasks: TaskResourceMetrics[];
  /** ISO timestamp of this summary. */
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
  /** Running sum of RSS samples for average calculation. */
  rssSumBytes: number;
  /** Number of RSS samples taken. */
  rssSampleCount: number;
  /** Peak RSS observed. */
  peakRssBytes: number;
  /** Most recent RSS. */
  currentRssBytes: number;
  /** Running sum of concurrent counts observed during this task's lifetime. */
  concurrentSum: number;
  /** Number of concurrent-count samples taken during this task's lifetime. */
  concurrentSampleCount: number;
  /** Whether this task is still running. */
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
 *
 * @example
 * ```ts
 * const metrics = new ConcurrentExecutionMetrics();
 *
 * // When a task starts
 * metrics.taskStarted("task-1", "Fix bug", 12345);
 *
 * // During periodic monitoring (e.g. every 10s)
 * metrics.recordSnapshot({
 *   concurrentCount: 2,
 *   totalRssBytes: 200_000_000,
 *   systemMemoryPercent: 45,
 *   loadAvg1m: 1.5,
 *   perTaskRss: [
 *     { taskId: "task-1", rssBytes: 100_000_000 },
 *     { taskId: "task-2", rssBytes: 100_000_000 },
 *   ],
 * });
 *
 * // When a task completes
 * metrics.taskCompleted("task-1");
 *
 * // Get full summary for API
 * const summary = metrics.getSummary();
 * ```
 */
export class ConcurrentExecutionMetrics {
  private readonly _config: ConcurrentExecutionMetricsConfig;
  /** Time-series ring buffer of execution snapshots. */
  private readonly _snapshots: ExecutionMetricsSnapshot[] = [];
  /** Active task metrics keyed by taskId. */
  private readonly _activeTasks = new Map<string, TrackedTaskMetrics>();
  /** Completed task metrics (FIFO, bounded). */
  private readonly _completedTasks: TrackedTaskMetrics[] = [];
  /** Clock function, injectable for deterministic testing. */
  private readonly _now: () => number;

  constructor(
    config?: Partial<ConcurrentExecutionMetricsConfig>,
    overrides?: { now?: () => number },
  ) {
    this._config = { ...DEFAULT_CONCURRENT_EXECUTION_METRICS_CONFIG, ...config };
    this._now = overrides?.now ?? Date.now;
  }

  /** Current configuration (read-only copy). */
  get config(): Readonly<ConcurrentExecutionMetricsConfig> {
    return { ...this._config };
  }

  /** Number of time-series snapshots recorded. */
  get snapshotCount(): number {
    return this._snapshots.length;
  }

  /** Number of actively tracked tasks. */
  get activeTaskCount(): number {
    return this._activeTasks.size;
  }

  /** Number of completed task metrics retained. */
  get completedTaskCount(): number {
    return this._completedTasks.length;
  }

  // -----------------------------------------------------------------------
  // Task lifecycle
  // -----------------------------------------------------------------------

  /**
   * Register a new task execution.
   *
   * Call when a hench process starts executing a task.
   *
   * @param taskId   Task identifier from the PRD.
   * @param taskTitle Human-readable task title.
   * @param pid      OS process ID.
   */
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

  /**
   * Mark a task as completed and move to completed metrics.
   *
   * @param taskId Task identifier to mark as completed.
   */
  taskCompleted(taskId: string): void {
    const tracked = this._activeTasks.get(taskId);
    if (!tracked) return;

    const now = this._now();
    tracked.active = false;
    tracked.completedAt = new Date(now).toISOString();
    tracked.completedEpochMs = now;
    this._activeTasks.delete(taskId);

    // Add to completed list, evict oldest if over limit
    this._completedTasks.push(tracked);
    while (this._completedTasks.length > this._config.maxCompletedTasks) {
      this._completedTasks.shift();
    }
  }

  // -----------------------------------------------------------------------
  // Snapshot recording
  // -----------------------------------------------------------------------

  /**
   * Record a point-in-time snapshot of concurrent execution state.
   *
   * Call this during each periodic monitoring cycle (e.g. every 10 seconds).
   * Updates both the time-series ring buffer and per-task resource metrics.
   *
   * @param input Snapshot data from the current monitoring cycle.
   */
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

    // Ring buffer: evict oldest when full
    if (this._snapshots.length >= this._config.maxSnapshots) {
      this._snapshots.shift();
    }
    this._snapshots.push(snapshot);

    // Update per-task metrics with this cycle's data
    for (const { taskId, rssBytes } of input.perTaskRss) {
      const tracked = this._activeTasks.get(taskId);
      if (!tracked) continue;

      tracked.rssSumBytes += rssBytes;
      tracked.rssSampleCount += 1;
      tracked.currentRssBytes = rssBytes;
      if (rssBytes > tracked.peakRssBytes) {
        tracked.peakRssBytes = rssBytes;
      }

      // Track concurrent count during this task's execution
      tracked.concurrentSum += input.concurrentCount;
      tracked.concurrentSampleCount += 1;
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Get the most recent snapshot, or a synthetic zero-state if no
   * snapshots have been recorded.
   */
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

  /**
   * Get all recorded snapshots (copy of the ring buffer).
   */
  getSnapshots(): ExecutionMetricsSnapshot[] {
    return this._snapshots.map((s) => ({ ...s }));
  }

  /**
   * Compute utilization patterns from the recorded time-series.
   *
   * Aggregates across all snapshots in the ring buffer to produce
   * peak, average, and other summary statistics.
   */
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

  /**
   * Get resource metrics for all active tasks.
   */
  getActiveTaskMetrics(): TaskResourceMetrics[] {
    const now = this._now();
    const result: TaskResourceMetrics[] = [];

    for (const t of this._activeTasks.values()) {
      result.push(this._buildTaskMetrics(t, now));
    }
    return result;
  }

  /**
   * Get resource metrics for completed tasks.
   */
  getCompletedTaskMetrics(): TaskResourceMetrics[] {
    const now = this._now();
    return this._completedTasks.map((t) => this._buildTaskMetrics(t, now));
  }

  /**
   * Get the full metrics summary for API responses.
   *
   * Combines the latest snapshot, utilization patterns, and per-task
   * metrics into a single response object.
   */
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

  /**
   * Clear all metrics data (snapshots + task metrics).
   */
  reset(): void {
    this._snapshots.length = 0;
    this._activeTasks.clear();
    this._completedTasks.length = 0;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build a TaskResourceMetrics from internal tracked state.
   */
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
