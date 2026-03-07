/**
 * Per-process memory tracking with history and high-RSS warnings.
 *
 * Collects time-series RSS samples for individual hench task processes
 * and stores them in bounded ring buffers. Flags processes whose RSS
 * exceeds a configurable threshold.
 *
 * Key differences from sibling modules:
 * - **SystemMemoryMonitor** — system-wide memory readings + pre-spawn gating
 * - **MemoryThrottle** — entry-gate decision engine (delay/reject)
 * - **ProcessMemoryTracker** — per-process historical tracking + RSS warnings
 *
 * @module hench/process/process-memory-tracker
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum samples retained per process (ring buffer size). */
const DEFAULT_MAX_SAMPLES = 360;

/** Maximum number of completed process histories to retain. */
const DEFAULT_MAX_COMPLETED_HISTORIES = 20;

/** Default RSS warning threshold: 512 MB. */
const DEFAULT_RSS_WARNING_BYTES = 512 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the process memory tracker.
 */
export interface ProcessMemoryTrackerConfig {
  /** Maximum samples per process ring buffer. */
  maxSamples: number;
  /** Maximum completed histories retained after process ends. */
  maxCompletedHistories: number;
  /** RSS threshold in bytes — processes exceeding this are flagged. */
  rssWarningBytes: number;
}

/** Default process memory tracker configuration. */
export const DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG: ProcessMemoryTrackerConfig = {
  maxSamples: DEFAULT_MAX_SAMPLES,
  maxCompletedHistories: DEFAULT_MAX_COMPLETED_HISTORIES,
  rssWarningBytes: DEFAULT_RSS_WARNING_BYTES,
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
 * Memory trend summary for a tracked process.
 */
export interface MemoryTrend {
  /** Whether RSS exceeds the warning threshold. */
  isLeaking: boolean;
  /** Human-readable description. */
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
  /** Memory trend (undefined if no samples yet). */
  trend?: MemoryTrend;
  /** Peak RSS observed across all samples (bytes). */
  peakRssBytes: number;
  /** Most recent RSS (bytes). */
  currentRssBytes: number;
}

/**
 * Warning report for a process exceeding the RSS threshold.
 */
export interface LeakReport {
  /** Task ID. */
  taskId: string;
  /** Task title. */
  taskTitle: string;
  /** Process ID. */
  pid: number;
  /** Memory trend. */
  trend: MemoryTrend;
  /** Current RSS in bytes. */
  currentRssBytes: number;
  /** Peak RSS in bytes. */
  peakRssBytes: number;
  /** Duration the process has been tracked (seconds). */
  trackingDurationSec: number;
  /** ISO timestamp of this report. */
  timestamp: string;
}

/**
 * Summary of all tracked processes and any warnings.
 */
export interface LeakDetectionSummary {
  /** Total processes currently being tracked. */
  activeProcesses: number;
  /** Total completed histories retained. */
  completedProcesses: number;
  /** Processes flagged for high RSS. */
  leaks: LeakReport[];
  /** Overall health assessment. */
  health: "healthy" | "warning";
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
  active: boolean;
}

// ---------------------------------------------------------------------------
// ProcessMemoryTracker
// ---------------------------------------------------------------------------

/**
 * Tracks per-process memory usage over time for hench task processes.
 *
 * Each tracked process gets a bounded ring buffer of RSS samples.
 * Processes whose RSS exceeds a configurable threshold are flagged.
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
 * // Check for high-RSS processes
 * const summary = tracker.detectLeaks();
 * if (summary.leaks.length > 0) {
 *   console.warn("High RSS detected:", summary.leaks);
 * }
 * ```
 */
export class ProcessMemoryTracker {
  private readonly _config: ProcessMemoryTrackerConfig;
  private readonly _active = new Map<string, TrackedProcess>();
  private readonly _completed: TrackedProcess[] = [];
  private readonly _now: () => number;

  constructor(
    config?: Partial<ProcessMemoryTrackerConfig>,
    overrides?: { now?: () => number },
  ) {
    this._config = { ...DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG, ...config };
    this._now = overrides?.now ?? Date.now;
  }

  get config(): Readonly<ProcessMemoryTrackerConfig> {
    return { ...this._config };
  }

  get activeCount(): number {
    return this._active.size;
  }

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

    tracked.pid = pid;

    if (tracked.samples.length >= this._config.maxSamples) {
      tracked.samples.shift();
    }
    tracked.samples.push(sample);

    if (rssBytes > tracked.peakRssBytes) {
      tracked.peakRssBytes = rssBytes;
    }
  }

  // -----------------------------------------------------------------------
  // Process lifecycle
  // -----------------------------------------------------------------------

  markCompleted(taskId: string): void {
    const tracked = this._active.get(taskId);
    if (!tracked) return;

    tracked.active = false;
    tracked.endedAt = new Date(this._now()).toISOString();
    this._active.delete(taskId);

    this._completed.push(tracked);
    while (this._completed.length > this._config.maxCompletedHistories) {
      this._completed.shift();
    }
  }

  remove(taskId: string): void {
    this._active.delete(taskId);
  }

  // -----------------------------------------------------------------------
  // History queries
  // -----------------------------------------------------------------------

  getHistory(taskId: string): ProcessMemoryHistory | undefined {
    const tracked = this._active.get(taskId) ??
      this._completed.find((p) => p.taskId === taskId);

    if (!tracked) return undefined;
    return this._buildHistory(tracked);
  }

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

  getActiveHistories(): ProcessMemoryHistory[] {
    const result: ProcessMemoryHistory[] = [];
    for (const tracked of this._active.values()) {
      result.push(this._buildHistory(tracked));
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Leak detection (simplified: RSS threshold check)
  // -----------------------------------------------------------------------

  /**
   * Check all active processes for high RSS.
   *
   * A process is flagged when its current RSS exceeds `rssWarningBytes`.
   */
  detectLeaks(): LeakDetectionSummary {
    const leaks: LeakReport[] = [];

    for (const tracked of this._active.values()) {
      const samples = tracked.samples;
      const currentRss = samples[samples.length - 1]?.rssBytes ?? 0;

      if (currentRss < this._config.rssWarningBytes) continue;

      const firstSample = samples[0];
      const lastSample = samples[samples.length - 1];
      const durationSec = firstSample && lastSample
        ? (lastSample.epochMs - firstSample.epochMs) / 1000
        : 0;

      const currentMB = Math.round(currentRss / 1024 / 1024);
      const thresholdMB = Math.round(this._config.rssWarningBytes / 1024 / 1024);

      leaks.push({
        taskId: tracked.taskId,
        taskTitle: tracked.taskTitle,
        pid: tracked.pid,
        trend: {
          isLeaking: true,
          description: `RSS ${currentMB}MB exceeds ${thresholdMB}MB threshold`,
        },
        currentRssBytes: currentRss,
        peakRssBytes: tracked.peakRssBytes,
        trackingDurationSec: Math.round(durationSec),
        timestamp: new Date().toISOString(),
      });
    }

    return {
      activeProcesses: this._active.size,
      completedProcesses: this._completed.length,
      leaks,
      health: leaks.length > 0 ? "warning" : "healthy",
      timestamp: new Date().toISOString(),
    };
  }

  getLeakAlerts(): LeakReport[] {
    return this.detectLeaks().leaks;
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  reset(): void {
    this._active.clear();
    this._completed.length = 0;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private _computeTrend(tracked: TrackedProcess): MemoryTrend | undefined {
    const samples = tracked.samples;
    if (samples.length === 0) return undefined;

    const currentRss = samples[samples.length - 1]!.rssBytes;
    const currentMB = Math.round(currentRss / 1024 / 1024);

    if (currentRss >= this._config.rssWarningBytes) {
      const thresholdMB = Math.round(this._config.rssWarningBytes / 1024 / 1024);
      return {
        isLeaking: true,
        description: `RSS ${currentMB}MB exceeds ${thresholdMB}MB threshold`,
      };
    }

    return {
      isLeaking: false,
      description: `RSS ${currentMB}MB — within normal range`,
    };
  }

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
