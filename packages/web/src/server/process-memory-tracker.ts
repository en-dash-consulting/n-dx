/**
 * Per-process memory tracking with history and high-RSS warnings.
 *
 * Collects time-series RSS samples for individual hench task processes
 * and stores them in bounded ring buffers. Flags processes whose RSS
 * exceeds a configurable threshold.
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

/** Maximum number of completed process histories to retain. */
const DEFAULT_MAX_COMPLETED_HISTORIES = 20;

/** Default RSS warning threshold: 512 MB. */
const DEFAULT_RSS_WARNING_BYTES = 512 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ProcessMemoryTrackerConfig {
  maxSamples: number;
  maxCompletedHistories: number;
  rssWarningBytes: number;
}

export const DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG: ProcessMemoryTrackerConfig = {
  maxSamples: DEFAULT_MAX_SAMPLES,
  maxCompletedHistories: DEFAULT_MAX_COMPLETED_HISTORIES,
  rssWarningBytes: DEFAULT_RSS_WARNING_BYTES,
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
  timestamp: string;
}

export interface LeakDetectionSummary {
  activeProcesses: number;
  completedProcesses: number;
  leaks: LeakReport[];
  health: "healthy" | "warning";
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
// ProcessMemoryTracker
// ---------------------------------------------------------------------------

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

  reset(): void {
    this._active.clear();
    this._completed.length = 0;
  }

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
