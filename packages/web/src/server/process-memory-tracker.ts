/**
 * Per-process memory tracking with historical data and leak detection.
 *
 * Collects time-series RSS samples for individual hench task processes,
 * stores them in bounded ring buffers, and performs linear regression
 * to detect memory leaks in long-running tasks.
 *
 * This is the web-server counterpart to hench's own ProcessMemoryTracker.
 * Implemented separately to avoid adding a runtime dependency from
 * @n-dx/web to hench (web reads hench data from disk, never imports it).
 *
 * @module @n-dx/web/server/process-memory-tracker
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

export interface ProcessMemoryTrackerConfig {
  maxSamples: number;
  minSamplesForLeakDetection: number;
  leakSlopeThreshold: number;
  leakRSquaredThreshold: number;
  maxCompletedHistories: number;
}

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

export interface ProcessMemorySample {
  rssBytes: number;
  timestamp: string;
  epochMs: number;
}

export interface MemoryTrend {
  slopeBytesSec: number;
  rSquared: number;
  isLeaking: boolean;
  description: string;
}

export interface ProcessMemoryHistory {
  taskId: string;
  taskTitle: string;
  pid: number;
  samples: ProcessMemorySample[];
  startedAt: string;
  endedAt?: string;
  trend?: MemoryTrend;
  peakRssBytes: number;
  currentRssBytes: number;
}

export interface LeakReport {
  taskId: string;
  taskTitle: string;
  pid: number;
  trend: MemoryTrend;
  currentRssBytes: number;
  peakRssBytes: number;
  trackingDurationSec: number;
  projectedRss1hBytes: number;
  severity: "moderate" | "severe";
  timestamp: string;
}

export interface LeakDetectionSummary {
  activeProcesses: number;
  completedProcesses: number;
  leaks: LeakReport[];
  health: "healthy" | "warning" | "critical";
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Internal tracked process entry
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
// Linear regression: y = a + b*x (OLS)
// ---------------------------------------------------------------------------

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

  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, rSquared: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

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
  // Leak detection
  // -----------------------------------------------------------------------

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

      const projectedRss1h = currentRss + trend.slopeBytesSec * 3600;
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
    if (samples.length < this._config.minSamplesForLeakDetection) {
      return undefined;
    }

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
