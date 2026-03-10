/**
 * Preact hook for tab visibility state management.
 *
 * Provides reactive tab visibility state to components. Starts the
 * tab visibility monitor on mount, cleans up on unmount, and triggers
 * re-renders only when the visibility state changes.
 */

import { useState, useEffect } from "preact/hooks";
import {
  startTabVisibilityMonitor,
  stopTabVisibilityMonitor,
  onVisibilityChange,
  getTabVisibilitySnapshot,
  getVisibilityCapabilities,
  type TabVisibilityState,
  type TabVisibilitySnapshot,
  type VisibilityAPICapabilities,
} from "../polling/index.js";

export interface UseTabVisibilityResult {
  /** Current tab visibility state ("visible" or "hidden"). */
  state: TabVisibilityState;
  /** Whether the tab is currently visible (convenience boolean). */
  isVisible: boolean;
  /** Full visibility snapshot with timing information. */
  snapshot: TabVisibilitySnapshot;
  /** Browser API capabilities for the Page Visibility API. */
  capabilities: VisibilityAPICapabilities;
}

/**
 * Hook that provides real-time tab visibility state.
 *
 * Usage:
 * ```tsx
 * const { isVisible, state, capabilities } = useTabVisibility();
 * if (!isVisible) return null; // skip rendering when hidden
 * if (capabilities.usingFallback) {
 *   console.warn("Using focus/blur fallback — precision is reduced");
 * }
 * ```
 */
export function useTabVisibility(): UseTabVisibilityResult {
  const [snapshot, setSnapshot] = useState<TabVisibilitySnapshot>(
    getTabVisibilitySnapshot
  );

  useEffect(() => {
    startTabVisibilityMonitor();

    const unsubscribe = onVisibilityChange((newSnapshot) => {
      setSnapshot(newSnapshot);
    });

    // Sync with current state in case it changed between render and effect.
    setSnapshot(getTabVisibilitySnapshot());

    return () => {
      unsubscribe();
      stopTabVisibilityMonitor();
    };
  }, []);

  return {
    state: snapshot.state,
    isVisible: snapshot.isVisible,
    snapshot,
    capabilities: getVisibilityCapabilities(),
  };
}
