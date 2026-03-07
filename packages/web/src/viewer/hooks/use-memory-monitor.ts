/**
 * Preact hook for client-side memory monitoring.
 *
 * Provides real-time memory usage data and warning levels to components.
 * Starts the memory monitor on mount, cleans up on unmount, and triggers
 * re-renders only when the snapshot changes.
 */

import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import type {
  MemorySnapshot,
  MemoryLevel,
  MemoryThresholds,
} from "../performance/memory-monitor.js";
import {
  startMemoryMonitor,
  stopMemoryMonitor,
  onSnapshot,
  getLatestSnapshot,
  getSnapshotHistory,
  resetMemoryMonitor,
} from "../performance/memory-monitor.js";

export interface UseMemoryMonitorOptions {
  /** Polling interval in milliseconds (default: 5000). */
  intervalMs?: number;
  /** Custom warning thresholds. */
  thresholds?: Partial<MemoryThresholds>;
  /** Whether to start monitoring immediately (default: true). */
  enabled?: boolean;
}

export interface UseMemoryMonitorResult {
  /** Latest memory snapshot, or null if not yet available. */
  snapshot: MemorySnapshot | null;
  /** Current warning level. */
  level: MemoryLevel;
  /** Whether the warning banner should be shown (warning or critical). */
  showWarning: boolean;
  /** Whether the user has dismissed the current warning. */
  dismissed: boolean;
  /** Dismiss the current warning banner. Resets if level escalates. */
  dismiss: () => void;
  /** Snapshot history for debugging (readonly). */
  history: readonly MemorySnapshot[];
}

/**
 * Hook that provides real-time memory usage monitoring.
 *
 * Usage:
 * ```tsx
 * const { snapshot, level, showWarning, dismiss } = useMemoryMonitor();
 * ```
 */
export function useMemoryMonitor(
  options: UseMemoryMonitorOptions = {}
): UseMemoryMonitorResult {
  const { intervalMs = 5000, thresholds, enabled = true } = options;

  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(
    getLatestSnapshot
  );
  const [dismissed, setDismissed] = useState(false);
  const dismissedLevelRef = useRef<MemoryLevel | null>(null);

  useEffect(() => {
    if (!enabled) return;

    startMemoryMonitor({
      intervalMs,
      thresholds: thresholds as MemoryThresholds | undefined,
      onLevelChange: (snap, prevLevel) => {
        // If the level escalates beyond what was dismissed, re-show the warning.
        if (
          dismissedLevelRef.current &&
          isMoreSevere(snap.level, dismissedLevelRef.current)
        ) {
          setDismissed(false);
          dismissedLevelRef.current = null;
        }
      },
    });

    const unsubscribe = onSnapshot((snap) => {
      setSnapshot(snap);
    });

    return () => {
      unsubscribe();
      stopMemoryMonitor();
    };
  }, [enabled, intervalMs, thresholds]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    dismissedLevelRef.current = snapshot?.level ?? null;
  }, [snapshot]);

  const level = snapshot?.level ?? "normal";
  const shouldWarn = level === "warning" || level === "critical";
  const showWarning = shouldWarn && !dismissed;

  return {
    snapshot,
    level,
    showWarning,
    dismissed,
    dismiss,
    history: getSnapshotHistory(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<MemoryLevel, number> = {
  normal: 0,
  elevated: 1,
  warning: 2,
  critical: 3,
};

/** Returns true if `a` is strictly more severe than `b`. */
function isMoreSevere(a: MemoryLevel, b: MemoryLevel): boolean {
  return SEVERITY_ORDER[a] > SEVERITY_ORDER[b];
}
