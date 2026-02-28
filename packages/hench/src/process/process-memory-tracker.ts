/**
 * Per-process memory tracking with history and leak detection.
 *
 * Collects time-series RSS samples for individual hench task processes,
 * stores them in bounded ring buffers, and performs linear regression
 * to detect memory leaks in long-running tasks.
 *
 * Key differences from sibling modules:
 * - **SystemMemoryMonitor** — system-wide memory readings + pre-spawn gating
 * - **MemoryThrottle** — entry-gate decision engine (delay/reject)
 * - **ProcessMemoryTracker** — per-process historical tracking + leak detection
 *
 * Integration points:
 * - Web server calls {@link ProcessMemoryTracker.recordSample} during periodic
 *   memory broadcasts to accumulate per-process history
 * - API endpoints expose history and leak reports via {@link getHistory},
 *   {@link getAllHistories}, and {@link detectLeaks}
 * - WebSocket broadcasts can include leak alerts from {@link getLeakAlerts}
 *
 * @module hench/process/process-memory-tracker
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum samples retained per process (ring buffer size). */
const DEFAULT_MAX_SAMPLES = 360;

/** Minimum samples needed before leak detection is meaningful. */
const DEFAULT_MIN_SAMPLES_FOR_LEAK_DETECTION = 6;

/**
 * Minimum RSS growth rate (bytes/sec) to consider a potential leak.
 * 100 KB/s filters out noise from normal allocation patterns.
 */
const DEFAULT_LEAK_SLOPE_THRESHOLD = 100 * 1024;

/**
 * Minimum R² value for the linear regression to be considered reliable.
 * 0.7 means the linear trend explains at least 70% of variance.
 */
const DEFAULT_LEAK_R_SQUARED_THRESHOLD = 0.7;

/** Maximum number of completed process histories to retain. */
const DEFAULT_MAX_COMPLETED_HISTORIES = 20;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the process memory tracker.
 */
export interface ProcessMemoryTrackerConfig {
  /** Maximum samples per process ring buffer. */
  maxSamples: number;
  /** Minimum samples required before leak detection runs. */
  minSamplesForLeakDetection: number;
  /** Minimum RSS growth rate (bytes/sec) to flag as a leak. */
  leakSlopeThreshold: number;
  /** Minimum R² for the linear regression to be considered reliable. */
  leakRSquaredThreshold: number;
  /** Maximum completed histories retained after process ends. */
  maxCompletedHistories: number;
}

/** Default process memory tracker configuration. */
export const DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG: ProcessMemoryTrackerConfig = {
  maxSamples: DEFAULT_MAX_SAMPLES,
  minSamplesForLeakDetection: DEFAULT_MIN_SAMPLES_FOR_LEAK_DETECTION,
  leakSlopeThreshold: DEFAULT_LEAK_SLOPE_THRESHOLD,
  leakRSquaredThreshold: DEFAULT_LEAK_R_SQUARED_THRESHOLD,
  maxCompletedHistories: DEFAULT_MAX_COMPLETED_HISTORIES,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single memory sample for a tracked process.
 */
export interface ProcessMemorySample {
  /** Process RSS in bytes. */
  rssBytes: number;
  /** ISO timestamp of the sample. */
  timestamp: string;
  /** Epoch milliseconds (for efficient time-delta calculations). */
  epochMs: number;
}

/**
 * Result of linear regression on RSS samples over time.
 */
export interface MemoryTrend {
  /** RSS growth rate in bytes per second (positive = growing). */
  slopeBytesSec: number;
  /** Coefficient of determination — how well a line fits the data (0–1). */
  rSquared: number;
  /** Whether the trend qualifies as a memory leak. */
  isLeaking: boolean;
  /** Human-readable description of the trend. */
  description: string;
}

/**
 * Full memory history for a single tracked process.
 */
export interface ProcessMemoryHistory {
  /** Task ID this process is executing. */
  taskId: string;
  /** Human-readable task title. */
  taskTitle: string;
  /** Process ID. */
  pid: number;
  /** Ordered time-series samples (oldest first). */
  samples: ProcessMemorySample[];
  /** When tracking started for this process. */
  startedAt: string;
  /** When the process ended (undefined if still running). */
  endedAt?: string;
  /** Current memory trend analysis (undefined if insufficient samples). */
  trend?: MemoryTrend;
  /** Peak RSS observed across all samples (bytes). */
  peakRssBytes: number;
  /** Most recent RSS (bytes). */
  currentRssBytes: number;
}

/**
 * Leak detection report for a single process.
 */
export interface LeakReport {
  /** Task ID of the potentially leaking process. */
  taskId: string;
  /** Task title. */
  taskTitle: string;
  /** Process ID. */
  pid: number;
  /** The computed memory trend. */
  trend: MemoryTrend;
  /** Current RSS in bytes. */
  currentRssBytes: number;
  /** Peak RSS in bytes. */
  peakRssBytes: number;
  /** Duration the process has been tracked (seconds). */
  trackingDurationSec: number;
  /** Projected RSS at +1 hour if trend continues (bytes). */
  projectedRss1hBytes: number;
  /** Severity: moderate (growing) or severe (fast growth + high R²). */
  severity: "moderate" | "severe";
  /** ISO timestamp of this report. */
  timestamp: string;
}

/**
 * Summary of all tracked processes and any detected leaks.
 */
export interface LeakDetectionSummary {
  /** Total processes currently being tracked. */
  activeProcesses: number;
  /** Total completed histories retained. */
  completedProcesses: number;
  /** Processes flagged as potentially leaking. */
  leaks: LeakReport[];
  /** Overall health assessment. */
  health: "healthy" | "warning" | "critical";
  /** ISO timestamp. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Internal ring buffer entry
// ---------------------------------------------------------------------------

interface TrackedProcess {
  taskId: string;
  taskTitle: string;
  pid: number;
  samples: ProcessMemorySample[];
  startedAt: string;
  endedAt?: string;
  peakRssBytes: number;
  /** Whether this process is still actively being sampled. */
  active: boolean;
}

// ---------------------------------------------------------------------------
// Linear regression
// ---------------------------------------------------------------------------

/**
 * Simple linear regression: y = a + b*x
 *
 * Uses ordinary least squares to fit RSS (y) vs elapsed seconds (x).
 * Returns slope (bytes/sec), intercept, and R² for goodness of fit.
 */
function linearRegression(
  xs: number[],
  ys: number[],
): { slope: number; intercept: number; rSquared: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, rSquared: 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, rSquared: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² = 1 - SS_res / SS_tot
  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * xs[i]!;
    ssRes += (ys[i]! - predicted) ** 2;
    ssTot += (ys[i]! - meanY) ** 2;
  }

  const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return { slope, intercept, rSquared };
}

// ---------------------------------------------------------------------------
// ProcessMemoryTracker
// ---------------------------------------------------------------------------

/**
 * Tracks per-process memory usage over time for hench task processes.
 *
 * Each tracked process gets a bounded ring buffer of RSS samples.
 * When enough samples accumulate, linear regression detects whether
 * RSS is growing monotonically (potential memory leak).
 *
 * Completed processes are retained (up to `maxCompletedHistories`) so
 * post-mortem analysis is available for recently finished tasks.
 *
 * @example
 * ```ts
 * const tracker = new ProcessMemoryTracker();
 *
 * // Record samples during periodic monitoring
 * tracker.recordSample("task-123", "Fix bug", 45678, 52_428_800);
 *
 * // Later: check for leaks
 * const summary = tracker.detectLeaks();
 * if (summary.leaks.length > 0) {
 *   console.warn("Memory leaks detected:", summary.leaks);
 * }
 *
 * // Get full history for a task
 * const history = tracker.getHistory("task-123");
 * ```
 */
export class ProcessMemoryTracker {
  private readonly _config: ProcessMemoryTrackerConfig;
  /** Active processes keyed by taskId. */
  private readonly _active = new Map<string, TrackedProcess>();
  /** Completed process histories (FIFO, bounded). */
  private readonly _completed: TrackedProcess[] = [];
  /** Clock function, injectable for deterministic testing. */
  private readonly _now: () => number;

  constructor(
    config?: Partial<ProcessMemoryTrackerConfig>,
    overrides?: { now?: () => number },
  ) {
    this._config = { ...DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG, ...config };
    this._now = overrides?.now ?? Date.now;
  }

  /** Current configuration (read-only copy). */
  get config(): Readonly<ProcessMemoryTrackerConfig> {
    return { ...this._config };
  }

  /** Number of actively tracked processes. */
  get activeCount(): number {
    return this._active.size;
  }

  /** Number of retained completed histories. */
  get completedCount(): number {
    return this._completed.length;
  }

  // -----------------------------------------------------------------------
  // Sample recording
  // -----------------------------------------------------------------------

  /**
   * Record a memory sample for a process.
   *
   * Creates a new tracking entry if this is the first sample for the
   * given taskId. Appends to the ring buffer, evicting the oldest
   * sample when full.
   *
   * @param taskId   Task identifier.
   * @param taskTitle Human-readable task title.
   * @param pid      OS process ID.
   * @param rssBytes Current RSS in bytes.
   */
  recordSample(
    taskId: string,
    taskTitle: string,
    pid: number,
    rssBytes: number,
  ): void {
    const now = this._now();
    const sample: ProcessMemorySample = {
      rssBytes,
      timestamp: new Date(now).toISOString(),
      epochMs: now,
    };

    let tracked = this._active.get(taskId);
    if (!tracked) {
      tracked = {
        taskId,
        taskTitle,
        pid,
        samples: [],
        startedAt: sample.timestamp,
        peakRssBytes: rssBytes,
        active: true,
      };
      this._active.set(taskId, tracked);
    }

    // Update PID if it changed (e.g., process restart)
    tracked.pid = pid;

    // Ring buffer: evict oldest when full
    if (tracked.samples.length >= this._config.maxSamples) {
      tracked.samples.shift();
    }
    tracked.samples.push(sample);

    // Track peak
    if (rssBytes > tracked.peakRssBytes) {
      tracked.peakRssBytes = rssBytes;
    }
  }

  // -----------------------------------------------------------------------
  // Process lifecycle
  // -----------------------------------------------------------------------

  /**
   * Mark a process as completed and move it to the completed history.
   *
   * The process's samples are retained for post-mortem analysis up to
   * the configured `maxCompletedHistories` limit.
   *
   * @param taskId Task identifier to mark as completed.
   */
  markCompleted(taskId: string): void {
    const tracked = this._active.get(taskId);
    if (!tracked) return;

    tracked.active = false;
    tracked.endedAt = new Date(this._now()).toISOString();
    this._active.delete(taskId);

    // Add to completed list, evict oldest if over limit
    this._completed.push(tracked);
    while (this._completed.length > this._config.maxCompletedHistories) {
      this._completed.shift();
    }
  }

  /**
   * Remove a process from tracking entirely (no history retention).
   *
   * Use this for processes that were never interesting (e.g., immediate
   * failures) or to free memory.
   *
   * @param taskId Task identifier to remove.
   */
  remove(taskId: string): void {
    this._active.delete(taskId);
  }

  // -----------------------------------------------------------------------
  // History queries
  // -----------------------------------------------------------------------

  /**
   * Get the full memory history for a specific task.
   *
   * Searches both active and completed processes. Returns undefined
   * if no history exists for the given taskId.
   */
  getHistory(taskId: string): ProcessMemoryHistory | undefined {
    const tracked = this._active.get(taskId) ??
      this._completed.find((p) => p.taskId === taskId);

    if (!tracked) return undefined;
    return this._buildHistory(tracked);
  }

  /**
   * Get memory histories for all tracked processes (active + completed).
   */
  getAllHistories(): ProcessMemoryHistory[] {
    const all: ProcessMemoryHistory[] = [];
    for (const tracked of this._active.values()) {
      all.push(this._buildHistory(tracked));
    }
    for (const tracked of this._completed) {
      all.push(this._buildHistory(tracked));
    }
    return all;
  }

  /**
   * Get memory histories for currently active processes only.
   */
  getActiveHistories(): ProcessMemoryHistory[] {
    const result: ProcessMemoryHistory[] = [];
    for (const tracked of this._active.values()) {
      result.push(this._buildHistory(tracked));
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Leak detection
  // -----------------------------------------------------------------------

  /**
   * Analyze all active processes for memory leaks.
   *
   * Performs linear regression on each process's RSS samples over time.
   * A process is flagged as leaking when:
   * 1. It has enough samples (≥ minSamplesForLeakDetection)
   * 2. The RSS growth rate exceeds leakSlopeThreshold (bytes/sec)
   * 3. The R² of the linear fit exceeds leakRSquaredThreshold
   *
   * @returns Summary with all detected leaks and overall health.
   */
  detectLeaks(): LeakDetectionSummary {
    const leaks: LeakReport[] = [];

    for (const tracked of this._active.values()) {
      const trend = this._computeTrend(tracked);
      if (!trend || !trend.isLeaking) continue;

      const samples = tracked.samples;
      const currentRss = samples[samples.length - 1]?.rssBytes ?? 0;
      const firstSample = samples[0];
      const lastSample = samples[samples.length - 1];
      const durationSec = firstSample && lastSample
        ? (lastSample.epochMs - firstSample.epochMs) / 1000
        : 0;

      // Project RSS at +1 hour
      const projectedRss1h = currentRss + trend.slopeBytesSec * 3600;

      // Severity: severe if growth > 1MB/s or R² > 0.9
      const severe = trend.slopeBytesSec > 1024 * 1024 || trend.rSquared > 0.9;

      leaks.push({
        taskId: tracked.taskId,
        taskTitle: tracked.taskTitle,
        pid: tracked.pid,
        trend,
        currentRssBytes: currentRss,
        peakRssBytes: tracked.peakRssBytes,
        trackingDurationSec: Math.round(durationSec),
        projectedRss1hBytes: Math.round(projectedRss1h),
        severity: severe ? "severe" : "moderate",
        timestamp: new Date().toISOString(),
      });
    }

    // Overall health
    let health: LeakDetectionSummary["health"] = "healthy";
    if (leaks.some((l) => l.severity === "severe")) {
      health = "critical";
    } else if (leaks.length > 0) {
      health = "warning";
    }

    return {
      activeProcesses: this._active.size,
      completedProcesses: this._completed.length,
      leaks,
      health,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get leak alerts suitable for WebSocket broadcast.
   *
   * Returns only processes with active leak warnings, formatted
   * for the frontend memory panel.
   */
  getLeakAlerts(): LeakReport[] {
    return this.detectLeaks().leaks;
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  /**
   * Clear all tracking data (active + completed).
   */
  reset(): void {
    this._active.clear();
    this._completed.length = 0;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Compute the memory trend for a tracked process.
   *
   * Returns undefined if there aren't enough samples for meaningful analysis.
   */
  private _computeTrend(tracked: TrackedProcess): MemoryTrend | undefined {
    const samples = tracked.samples;
    if (samples.length < this._config.minSamplesForLeakDetection) {
      return undefined;
    }

    // Use elapsed seconds from first sample as x-axis
    const firstEpoch = samples[0]!.epochMs;
    const xs = samples.map((s) => (s.epochMs - firstEpoch) / 1000);
    const ys = samples.map((s) => s.rssBytes);

    const { slope, rSquared } = linearRegression(xs, ys);

    const isLeaking =
      slope > this._config.leakSlopeThreshold &&
      rSquared >= this._config.leakRSquaredThreshold;

    const slopeMBMin = (slope * 60) / (1024 * 1024);
    let description: string;
    if (isLeaking) {
      description = `Memory growing at ${slopeMBMin.toFixed(2)} MB/min ` +
        `(R²=${rSquared.toFixed(3)}) — potential leak`;
    } else if (slope > 0) {
      description = `Slight growth at ${slopeMBMin.toFixed(2)} MB/min ` +
        `(R²=${rSquared.toFixed(3)}) — within normal range`;
    } else {
      description = `Stable or decreasing (${slopeMBMin.toFixed(2)} MB/min)`;
    }

    return {
      slopeBytesSec: slope,
      rSquared,
      isLeaking,
      description,
    };
  }

  /**
   * Build a ProcessMemoryHistory from a TrackedProcess.
   */
  private _buildHistory(tracked: TrackedProcess): ProcessMemoryHistory {
    const samples = tracked.samples;
    const lastSample = samples[samples.length - 1];

    return {
      taskId: tracked.taskId,
      taskTitle: tracked.taskTitle,
      pid: tracked.pid,
      samples: [...samples],
      startedAt: tracked.startedAt,
      endedAt: tracked.endedAt,
      trend: this._computeTrend(tracked),
      peakRssBytes: tracked.peakRssBytes,
      currentRssBytes: lastSample?.rssBytes ?? 0,
    };
  }
}
