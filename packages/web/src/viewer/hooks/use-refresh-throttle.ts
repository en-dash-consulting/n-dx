/**
 * Preact hook for memory-aware refresh throttling.
 *
 * Provides reactive queue state to components so they can display
 * queue progress, memory-adjusted intervals, and estimated completion
 * times. Starts the refresh throttle on mount and cleans up on unmount.
 */

import { useState, useEffect, useCallback } from "preact/hooks";
import {
  getInitialRefreshThrottleMemoryLevel,
  subscribeToRefreshThrottleMemoryLevel,
  type MemoryLevel,
} from "../performance/refresh-throttle-memory.js";
import {
  startRefreshThrottle,
  stopRefreshThrottle,
  onQueueChange,
  getQueueState,
  enqueueRefresh,
  getRecommendedInterval,
  resetRefreshThrottle,
  type RefreshQueueState,
  type RefreshPriority,
} from "../performance/refresh-throttle.js";

export interface UseRefreshThrottleOptions {
  /** Base polling interval in milliseconds (default: 5000). */
  baseIntervalMs?: number;
  /** Average time a single refresh takes, for ETA estimation (default: 800ms). */
  avgRefreshMs?: number;
  /** Whether to start the throttle immediately (default: true). */
  enabled?: boolean;
}

export interface UseRefreshThrottleResult {
  /** Current queue state snapshot. */
  state: RefreshQueueState;
  /** Number of items waiting in the queue. */
  queueLength: number;
  /** Whether any refresh operations are active. */
  isProcessing: boolean;
  /** Whether the queue is paused due to memory pressure. */
  paused: boolean;
  /** Current memory level informing throttle decisions. */
  memoryLevel: MemoryLevel;
  /** Recommended polling interval for the current memory level. */
  recommendedIntervalMs: number;
  /** Estimated milliseconds until the queue is fully drained (-1 if unknown). */
  estimatedCompletionMs: number;
  /** Enqueue a refresh operation. Returns true if queued. */
  enqueue: (key: string, execute: () => Promise<void>, priority?: RefreshPriority) => boolean;
  /** Get the recommended interval for a given base interval. */
  getInterval: (baseMs?: number) => number;
}

/**
 * Hook that provides memory-aware refresh throttling state.
 *
 * Usage:
 * ```tsx
 * const { queueLength, paused, estimatedCompletionMs, enqueue } = useRefreshThrottle();
 * ```
 */
export function useRefreshThrottle(
  options: UseRefreshThrottleOptions = {}
): UseRefreshThrottleResult {
  const { baseIntervalMs = 5000, avgRefreshMs = 800, enabled = true } = options;

  const [queueState, setQueueState] = useState<RefreshQueueState>(getQueueState);

  useEffect(() => {
    if (!enabled) return;

    startRefreshThrottle({
      baseIntervalMs,
      avgRefreshMs,
      getInitialMemoryLevel: getInitialRefreshThrottleMemoryLevel,
      subscribeToMemoryLevel: subscribeToRefreshThrottleMemoryLevel,
    });

    const unsubscribe = onQueueChange((newState) => {
      setQueueState(newState);
    });

    // Sync in case state changed between render and effect.
    setQueueState(getQueueState());

    return () => {
      unsubscribe();
      stopRefreshThrottle();
    };
  }, [enabled, baseIntervalMs, avgRefreshMs]);

  const enqueue = useCallback(
    (key: string, execute: () => Promise<void>, priority?: RefreshPriority) =>
      enqueueRefresh(key, execute, priority),
    []
  );

  const getInterval = useCallback(
    (baseMs?: number) => getRecommendedInterval(baseMs),
    // Re-create when state changes so the closure captures fresh module state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queueState]
  );

  return {
    state: queueState,
    queueLength: queueState.queueLength,
    isProcessing: queueState.activeCount > 0,
    paused: queueState.paused,
    memoryLevel: queueState.memoryLevel,
    recommendedIntervalMs: queueState.recommendedIntervalMs,
    estimatedCompletionMs: queueState.estimatedCompletionMs,
    enqueue,
    getInterval,
  };
}
