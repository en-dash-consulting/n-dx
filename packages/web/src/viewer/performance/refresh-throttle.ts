/**
 * Memory-aware refresh throttling and queuing.
 *
 * Provides intelligent refresh scheduling that considers current memory usage
 * and queues or delays refresh operations when memory pressure is high.
 *
 * Behaviour by memory level:
 *
 *   normal   → Full-speed refresh, max concurrency (3 parallel fetches).
 *   elevated → 2× interval, reduced concurrency (2 parallel fetches).
 *   warning  → 4× interval, serial execution only (1 at a time).
 *   critical → All refreshes paused, queue frozen until memory subsides.
 *
 * Designed as a standalone module with zero framework dependencies —
 * the Preact hook (`useRefreshThrottle`) is provided separately.
 */

import type { MemoryLevel } from "./memory-monitor.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Priority levels for refresh operations — higher number = higher priority. */
export type RefreshPriority = "low" | "normal" | "high";

/** A single queued refresh operation. */
export interface QueuedRefresh {
  /** Unique key to deduplicate same-resource refreshes. */
  readonly key: string;
  /** The async work to perform. */
  readonly execute: () => Promise<void>;
  /** Priority determines dequeue order (high first). */
  readonly priority: RefreshPriority;
  /** ISO timestamp when the request entered the queue. */
  readonly enqueuedAt: string;
}

/** Read-only snapshot of the current queue state. */
export interface RefreshQueueState {
  /** Number of items waiting in the queue. */
  readonly queueLength: number;
  /** Number of refresh operations currently in flight. */
  readonly activeCount: number;
  /** Whether the queue is paused due to memory pressure. */
  readonly paused: boolean;
  /** Current memory level informing throttle decisions. */
  readonly memoryLevel: MemoryLevel;
  /** Recommended polling interval in milliseconds for the current level. */
  readonly recommendedIntervalMs: number;
  /** Maximum concurrent refresh operations allowed at the current level. */
  readonly maxConcurrency: number;
  /** Estimated milliseconds until the queue is fully drained (-1 if unknown). */
  readonly estimatedCompletionMs: number;
  /** Total refreshes completed since the throttle was started. */
  readonly completedCount: number;
}

/** Callback invoked when the queue state changes. */
export type QueueChangeHandler = (state: RefreshQueueState) => void;

/** Configuration for the refresh throttle. */
export interface RefreshThrottleConfig {
  /** Base polling interval in milliseconds (default: 5000). */
  baseIntervalMs: number;
  /** Average time a single refresh takes, for ETA estimation (default: 800ms). */
  avgRefreshMs: number;
  /** Called when the queue state changes. */
  onChange: QueueChangeHandler | null;
  /** Returns the current memory level when the throttle starts. */
  getInitialMemoryLevel: (() => MemoryLevel) | null;
  /** Subscribes to future memory level updates. */
  subscribeToMemoryLevel: ((listener: (level: MemoryLevel) => void) => () => void) | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_BASE_INTERVAL_MS = 5000;
const DEFAULT_AVG_REFRESH_MS = 800;

/** Interval multiplier per memory level. */
const INTERVAL_MULTIPLIERS: Record<MemoryLevel, number> = {
  normal: 1,
  elevated: 2,
  warning: 4,
  critical: Infinity, // effectively paused
};

/** Maximum concurrent refresh operations per memory level. */
const CONCURRENCY_LIMITS: Record<MemoryLevel, number> = {
  normal: 3,
  elevated: 2,
  warning: 1,
  critical: 0,
};

const PRIORITY_ORDER: Record<RefreshPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
};

// ─── Module state ────────────────────────────────────────────────────────────

let config: RefreshThrottleConfig = {
  baseIntervalMs: DEFAULT_BASE_INTERVAL_MS,
  avgRefreshMs: DEFAULT_AVG_REFRESH_MS,
  onChange: null,
  getInitialMemoryLevel: null,
  subscribeToMemoryLevel: null,
};

let queue: QueuedRefresh[] = [];
let activeCount = 0;
let completedCount = 0;
let currentMemoryLevel: MemoryLevel = "normal";
let unsubscribeMonitor: (() => void) | null = null;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let listeners: Array<(state: RefreshQueueState) => void> = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get the recommended interval for the current memory level. */
function computeRecommendedInterval(): number {
  const multiplier = INTERVAL_MULTIPLIERS[currentMemoryLevel];
  if (!isFinite(multiplier)) return Infinity;
  return config.baseIntervalMs * multiplier;
}

/** Get max concurrency for the current memory level. */
function computeMaxConcurrency(): number {
  return CONCURRENCY_LIMITS[currentMemoryLevel];
}

/** Estimate milliseconds until the queue is fully drained. */
function computeEstimatedCompletion(): number {
  const total = queue.length + activeCount;
  if (total === 0) return 0;
  if (currentMemoryLevel === "critical") return -1; // paused, unknown

  const maxConcurrency = computeMaxConcurrency();
  if (maxConcurrency === 0) return -1;

  const batches = Math.ceil(total / maxConcurrency);
  return batches * config.avgRefreshMs;
}

/** Build the queue state snapshot from current module state. */
function buildState(): RefreshQueueState {
  return {
    queueLength: queue.length,
    activeCount,
    paused: currentMemoryLevel === "critical",
    memoryLevel: currentMemoryLevel,
    recommendedIntervalMs: computeRecommendedInterval(),
    maxConcurrency: computeMaxConcurrency(),
    estimatedCompletionMs: computeEstimatedCompletion(),
    completedCount,
  };
}

function notifyListeners(): void {
  const state = buildState();
  if (config.onChange) config.onChange(state);
  for (const listener of listeners) {
    listener(state);
  }
}

/** Sort queue by priority (high first), then by enqueue time (FIFO within same priority). */
function sortQueue(): void {
  queue.sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return a.enqueuedAt.localeCompare(b.enqueuedAt);
  });
}

// ─── Queue drain ─────────────────────────────────────────────────────────────

/**
 * Attempt to drain the queue by starting as many operations as allowed
 * by the current concurrency limit.
 */
function drain(): void {
  const maxConcurrency = computeMaxConcurrency();

  while (queue.length > 0 && activeCount < maxConcurrency) {
    const item = queue.shift();
    if (!item) break;

    activeCount++;
    notifyListeners();

    item
      .execute()
      .catch(() => {
        // Swallow errors — individual refresh failures shouldn't break the queue.
      })
      .finally(() => {
        activeCount--;
        completedCount++;
        notifyListeners();
        // Continue draining after each completion.
        scheduleDrain();
      });
  }
}

/** Schedule a drain attempt — debounced to avoid tight loops. */
function scheduleDrain(): void {
  if (drainTimer !== null) return;
  drainTimer = setTimeout(() => {
    drainTimer = null;
    drain();
  }, 0);
}

// ─── Memory snapshot handler ─────────────────────────────────────────────────

function handleMemoryLevelChange(newLevel: MemoryLevel): void {
  if (newLevel === currentMemoryLevel) return;

  currentMemoryLevel = newLevel;

  notifyListeners();

  // If memory pressure eased, try to drain the queue.
  if (
    PRIORITY_ORDER[newLevel as unknown as RefreshPriority] === undefined &&
    computeMaxConcurrency() > 0
  ) {
    scheduleDrain();
  }

  // More reliably: if new concurrency > 0 and we have queued items, drain.
  if (computeMaxConcurrency() > 0 && queue.length > 0) {
    scheduleDrain();
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the refresh throttle. Subscribes to the memory monitor and
 * immediately evaluates the current memory level.
 *
 * Safe to call multiple times — restarts with new config.
 */
export function startRefreshThrottle(
  overrides: Partial<RefreshThrottleConfig> = {}
): void {
  stopRefreshThrottle();

  config = {
    baseIntervalMs: overrides.baseIntervalMs ?? DEFAULT_BASE_INTERVAL_MS,
    avgRefreshMs: overrides.avgRefreshMs ?? DEFAULT_AVG_REFRESH_MS,
    onChange: overrides.onChange ?? null,
    getInitialMemoryLevel: overrides.getInitialMemoryLevel ?? null,
    subscribeToMemoryLevel: overrides.subscribeToMemoryLevel ?? null,
  };

  currentMemoryLevel = config.getInitialMemoryLevel?.() ?? "normal";
  unsubscribeMonitor = config.subscribeToMemoryLevel?.(handleMemoryLevelChange) ?? null;

  notifyListeners();

  // Drain any items that may have been enqueued before start.
  if (queue.length > 0) {
    scheduleDrain();
  }
}

/** Stop the refresh throttle and clean up subscriptions. */
export function stopRefreshThrottle(): void {
  if (unsubscribeMonitor) {
    unsubscribeMonitor();
    unsubscribeMonitor = null;
  }
  if (drainTimer !== null) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
}

/**
 * Enqueue a refresh operation. If an entry with the same key already exists
 * in the queue, it is replaced (deduplication). The operation will be
 * executed when concurrency allows and memory pressure permits.
 *
 * Returns `true` if the item was queued, `false` if executed immediately.
 */
export function enqueueRefresh(
  key: string,
  execute: () => Promise<void>,
  priority: RefreshPriority = "normal"
): boolean {
  // Deduplicate: remove any existing entry with the same key.
  queue = queue.filter((item) => item.key !== key);

  const item: QueuedRefresh = {
    key,
    execute,
    priority,
    enqueuedAt: new Date().toISOString(),
  };

  queue.push(item);
  sortQueue();
  notifyListeners();
  scheduleDrain();

  // Return true if the item is still in the queue (queued, not immediately drained).
  // Since drain is async, the item is always initially queued.
  return true;
}

/**
 * Get the recommended polling interval for the current memory level.
 * Callers can use this to dynamically adjust their setInterval timing.
 */
export function getRecommendedInterval(
  baseIntervalMs: number = config.baseIntervalMs
): number {
  const multiplier = INTERVAL_MULTIPLIERS[currentMemoryLevel];
  if (!isFinite(multiplier)) return Infinity;
  return baseIntervalMs * multiplier;
}

/** Subscribe to queue state changes. Returns an unsubscribe function. */
export function onQueueChange(
  listener: (state: RefreshQueueState) => void
): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Get the current queue state. */
export function getQueueState(): RefreshQueueState {
  return buildState();
}

/** Get the current memory level being used for throttle decisions. */
export function getThrottleLevel(): MemoryLevel {
  return currentMemoryLevel;
}

/** Update the current memory level used for throttle decisions. */
export function setRefreshThrottleMemoryLevel(level: MemoryLevel): void {
  handleMemoryLevelChange(level);
}

/** Reset all module state (for testing). */
export function resetRefreshThrottle(): void {
  stopRefreshThrottle();
  queue = [];
  activeCount = 0;
  completedCount = 0;
  currentMemoryLevel = "normal";
  listeners = [];
  config = {
    baseIntervalMs: DEFAULT_BASE_INTERVAL_MS,
    avgRefreshMs: DEFAULT_AVG_REFRESH_MS,
    onChange: null,
    getInitialMemoryLevel: null,
    subscribeToMemoryLevel: null,
  };
}
