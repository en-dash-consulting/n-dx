/**
 * Client-side memory usage monitoring and early warning system.
 *
 * Tracks browser memory consumption in real-time, detects approaching
 * memory limits, and triggers graceful degradation before OOM crashes.
 *
 * Uses `performance.memory` (Chrome/Edge) for precise readings and
 * falls back to heuristic-based estimation on other browsers.
 *
 * Designed as a standalone module with zero framework dependencies —
 * the Preact hook (`useMemoryMonitor`) is provided separately.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Memory usage snapshot at a point in time. */
export interface MemorySnapshot {
  /** JS heap currently used (bytes). -1 if unavailable. */
  usedJSHeapSize: number;
  /** Total JS heap allocated by the browser (bytes). -1 if unavailable. */
  totalJSHeapSize: number;
  /** JS heap size limit (bytes). -1 if unavailable. */
  jsHeapSizeLimit: number;
  /** Usage ratio: usedJSHeapSize / jsHeapSizeLimit (0–1). -1 if unavailable. */
  usageRatio: number;
  /** Current warning level based on threshold configuration. */
  level: MemoryLevel;
  /** ISO timestamp of when this snapshot was taken. */
  timestamp: string;
  /** Whether precise memory data is available (Chrome/Edge only). */
  precise: boolean;
}

/** Warning levels ordered by severity. */
export type MemoryLevel = "normal" | "elevated" | "warning" | "critical";

/** Threshold configuration for memory warning levels. */
export interface MemoryThresholds {
  /** Ratio above which level becomes "elevated" (default: 0.50). */
  elevated: number;
  /** Ratio above which level becomes "warning" (default: 0.70). */
  warning: number;
  /** Ratio above which level becomes "critical" (default: 0.85). */
  critical: number;
}

/** Callback invoked when memory level changes. */
export type MemoryLevelChangeHandler = (
  snapshot: MemorySnapshot,
  previousLevel: MemoryLevel
) => void;

/** Configuration for the memory monitor. */
export interface MemoryMonitorConfig {
  /** Polling interval in milliseconds (default: 5000). */
  intervalMs: number;
  /** Warning thresholds (ratios 0–1). */
  thresholds: MemoryThresholds;
  /** Called when the memory level changes (e.g. normal → warning). */
  onLevelChange: MemoryLevelChangeHandler | null;
}

import {
  registerPollingSource,
} from "../polling/index.js";

// ─── Chrome-specific type augmentation ───────────────────────────────────────

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: MemoryThresholds = {
  elevated: 0.50,
  warning: 0.70,
  critical: 0.85,
};

const DEFAULT_INTERVAL_MS = 5000;

/** Key used to register with the centralized polling state manager. */
const POLLING_STATE_KEY = "memory-monitor";

/** Heuristic heap limit for browsers without performance.memory (2 GB). */
const FALLBACK_HEAP_LIMIT = 2 * 1024 * 1024 * 1024;

/** Maximum number of snapshots kept in history for debugging. */
const MAX_HISTORY_LENGTH = 60;

// ─── Module state ────────────────────────────────────────────────────────────

let config: MemoryMonitorConfig = {
  intervalMs: DEFAULT_INTERVAL_MS,
  thresholds: { ...DEFAULT_THRESHOLDS },
  onLevelChange: null,
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let stateUnsub: (() => void) | null = null;
let currentLevel: MemoryLevel = "normal";
let latestSnapshot: MemorySnapshot | null = null;
let snapshotHistory: MemorySnapshot[] = [];
let changeListeners: Array<(snapshot: MemorySnapshot) => void> = [];

// ─── Detection ───────────────────────────────────────────────────────────────

/** Check if the browser exposes precise memory metrics. */
export function hasPerformanceMemory(): boolean {
  const perf = performance as PerformanceWithMemory;
  return (
    typeof perf.memory !== "undefined" &&
    typeof perf.memory.usedJSHeapSize === "number"
  );
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

/** Determine the memory level for a given usage ratio. */
export function classifyLevel(
  ratio: number,
  thresholds: MemoryThresholds
): MemoryLevel {
  if (ratio < 0) return "normal"; // no data
  if (ratio >= thresholds.critical) return "critical";
  if (ratio >= thresholds.warning) return "warning";
  if (ratio >= thresholds.elevated) return "elevated";
  return "normal";
}

/** Take a memory snapshot using the best available API. */
export function takeSnapshot(
  thresholds: MemoryThresholds = config.thresholds
): MemorySnapshot {
  const perf = performance as PerformanceWithMemory;

  if (perf.memory) {
    const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = perf.memory;
    const usageRatio =
      jsHeapSizeLimit > 0 ? usedJSHeapSize / jsHeapSizeLimit : -1;

    return {
      usedJSHeapSize,
      totalJSHeapSize,
      jsHeapSizeLimit,
      usageRatio,
      level: classifyLevel(usageRatio, thresholds),
      timestamp: new Date().toISOString(),
      precise: true,
    };
  }

  // Fallback: no precise data available. Return unknowns.
  return {
    usedJSHeapSize: -1,
    totalJSHeapSize: -1,
    jsHeapSizeLimit: FALLBACK_HEAP_LIMIT,
    usageRatio: -1,
    level: "normal",
    timestamp: new Date().toISOString(),
    precise: false,
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Format bytes as a human-readable string (e.g. "142.5 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format a usage ratio as a percentage string (e.g. "72.3%"). */
export function formatRatio(ratio: number): string {
  if (ratio < 0) return "N/A";
  return `${(ratio * 100).toFixed(1)}%`;
}

// ─── Monitor lifecycle ───────────────────────────────────────────────────────

/** Subscribe to every new snapshot. Returns an unsubscribe function. */
export function onSnapshot(
  listener: (snapshot: MemorySnapshot) => void
): () => void {
  changeListeners.push(listener);
  return () => {
    changeListeners = changeListeners.filter((l) => l !== listener);
  };
}

function notifyListeners(snapshot: MemorySnapshot): void {
  for (const listener of changeListeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error("[memory-monitor] listener error:", err);
    }
  }
}

function poll(): void {
  const snapshot = takeSnapshot(config.thresholds);
  latestSnapshot = snapshot;

  // Keep a bounded history ring for debugging.
  snapshotHistory.push(snapshot);
  if (snapshotHistory.length > MAX_HISTORY_LENGTH) {
    snapshotHistory = snapshotHistory.slice(-MAX_HISTORY_LENGTH);
  }

  // Detect level transitions.
  const previousLevel = currentLevel;
  if (snapshot.level !== currentLevel) {
    currentLevel = snapshot.level;
    if (config.onLevelChange) {
      config.onLevelChange(snapshot, previousLevel);
    }
  }

  notifyListeners(snapshot);
}

/**
 * Start the memory monitor with the given configuration overrides.
 * Safe to call multiple times — restarts with new config if already running.
 */
export function startMemoryMonitor(
  overrides: Partial<MemoryMonitorConfig> = {}
): void {
  // Stop any existing monitor before applying new config.
  stopMemoryMonitor();

  config = {
    intervalMs: overrides.intervalMs ?? DEFAULT_INTERVAL_MS,
    thresholds: overrides.thresholds
      ? { ...DEFAULT_THRESHOLDS, ...overrides.thresholds }
      : { ...DEFAULT_THRESHOLDS },
    onLevelChange: overrides.onLevelChange ?? null,
  };

  // Take an immediate snapshot on start.
  poll();

  pollTimer = setInterval(poll, config.intervalMs);

  // Register with centralized polling state as ESSENTIAL — the memory
  // monitor must keep running during memory pressure to detect recovery.
  stateUnsub = registerPollingSource(
    POLLING_STATE_KEY,
    {
      suspend: () => stopPollTimer(),
      resume: () => {
        if (pollTimer === null) {
          pollTimer = setInterval(poll, config.intervalMs);
        }
      },
      dispose: () => {
        stopPollTimer();
        stateUnsub = null;
      },
      getStatus: () => (pollTimer !== null ? "active" : "idle"),
    },
    { essential: true },
  );
}

/** Stop the poll interval timer without touching polling-state registration. */
function stopPollTimer(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Stop the memory monitor and clean up. */
export function stopMemoryMonitor(): void {
  stopPollTimer();

  // Deregister from centralized polling state. Nullify first to
  // prevent re-entrant dispose.
  if (stateUnsub) {
    const unsub = stateUnsub;
    stateUnsub = null;
    unsub();
  }
}

/** Get the most recent memory snapshot, or null if the monitor has not run. */
export function getLatestSnapshot(): MemorySnapshot | null {
  return latestSnapshot;
}

/** Get the snapshot history (up to MAX_HISTORY_LENGTH entries). */
export function getSnapshotHistory(): readonly MemorySnapshot[] {
  return snapshotHistory;
}

/** Get the current memory warning level. */
export function getCurrentLevel(): MemoryLevel {
  return currentLevel;
}

/** Reset all module state (for testing). */
export function resetMemoryMonitor(): void {
  stopMemoryMonitor();
  currentLevel = "normal";
  latestSnapshot = null;
  snapshotHistory = [];
  changeListeners = [];
  stateUnsub = null;
  config = {
    intervalMs: DEFAULT_INTERVAL_MS,
    thresholds: { ...DEFAULT_THRESHOLDS },
    onLevelChange: null,
  };
}
