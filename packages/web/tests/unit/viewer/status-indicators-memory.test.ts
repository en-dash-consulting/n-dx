// @vitest-environment jsdom
/**
 * Integration tests for status indicators polling suspension during memory pressure.
 *
 * Verifies that the 10-second status indicators polling (registered via usePolling
 * with key "status-indicators") is paused when the graceful degradation system
 * disables the "autoRefresh" feature due to elevated memory usage.
 *
 * These tests exercise: memory-monitor → graceful-degradation → polling-manager,
 * using the same key and interval as the real status-indicators component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startPollingManager,
  registerPoller,
  unregisterPoller,
  isPollerActive,
  getRegisteredPollers,
  resetPollingManager,
} from "../../../src/viewer/polling/polling-manager.js";
import {
  startTabVisibilityMonitor,
  resetTabVisibility,
} from "../../../src/viewer/polling/tab-visibility.js";
import {
  startMemoryMonitor,
  resetMemoryMonitor,
} from "../../../src/viewer/performance/memory-monitor.js";
import {
  startDegradation,
  isFeatureDisabled,
  onDegradationChange,
  resetDegradation,
} from "../../../src/viewer/performance/graceful-degradation.js";

// ─── Constants (mirror status-indicators.ts) ─────────────────────────────────

const STATUS_INDICATORS_KEY = "status-indicators";
const STATUS_POLL_INTERVAL_MS = 10_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate memory at a given ratio by setting performance.memory. */
function setMemoryUsage(ratio: number): void {
  const limit = 2 * 1024 * 1024 * 1024; // 2 GB
  (performance as unknown as Record<string, unknown>).memory = {
    usedJSHeapSize: ratio * limit,
    totalJSHeapSize: (ratio + 0.05) * limit,
    jsHeapSizeLimit: limit,
  };
}

/** Remove mock performance.memory. */
function clearMemoryMock(original: unknown): void {
  if (original === undefined) {
    delete (performance as unknown as Record<string, unknown>).memory;
  } else {
    (performance as unknown as Record<string, unknown>).memory = original;
  }
}

/**
 * Simulate what the status-indicators component does: register a poller
 * with the enabled flag driven by isFeatureDisabled("autoRefresh").
 *
 * Returns a control object to re-evaluate the enabled state (mirroring
 * what would happen when the React component re-renders after a
 * degradation change).
 */
function registerStatusPoller(refresh: () => void) {
  let currentEnabled = !isFeatureDisabled("autoRefresh");

  function applyEnabled(enabled: boolean) {
    if (enabled) {
      registerPoller(STATUS_INDICATORS_KEY, refresh, STATUS_POLL_INTERVAL_MS);
    } else {
      unregisterPoller(STATUS_INDICATORS_KEY);
    }
    currentEnabled = enabled;
  }

  // Initial registration
  applyEnabled(currentEnabled);

  // Subscribe to degradation changes (mirrors the useEffect + useState pattern)
  const unsub = onDegradationChange((state) => {
    const enabled = !state.disabledFeatures.has("autoRefresh");
    if (enabled !== currentEnabled) {
      applyEnabled(enabled);
    }
  });

  return {
    isEnabled: () => currentEnabled,
    dispose: () => {
      unsub();
      unregisterPoller(STATUS_INDICATORS_KEY);
    },
  };
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

let originalMemory: unknown;

beforeEach(() => {
  originalMemory = (performance as unknown as { memory?: unknown }).memory;
  vi.useFakeTimers();
  resetTabVisibility();
  resetPollingManager();
  resetMemoryMonitor();
  resetDegradation();
  startTabVisibilityMonitor();
  startPollingManager();
});

afterEach(() => {
  resetDegradation();
  resetMemoryMonitor();
  resetPollingManager();
  resetTabVisibility();
  vi.useRealTimers();
  clearMemoryMock(originalMemory);
});

// ─── Acceptance criteria ──────────────────────────────────────────────────────

describe("status indicators memory pressure suspension", () => {
  it("stops polling when isFeatureDisabled(autoRefresh) becomes true", () => {
    // Start with normal memory → polling active.
    setMemoryUsage(0.2); // 20% → normal
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const refresh = vi.fn();
    const poller = registerStatusPoller(refresh);

    // Confirm polling fires normally.
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Spike memory to elevated (55%) → autoRefresh disabled.
    setMemoryUsage(0.55);
    vi.advanceTimersByTime(1000); // trigger memory monitor tick

    expect(isFeatureDisabled("autoRefresh")).toBe(true);
    expect(poller.isEnabled()).toBe(false);
    expect(isPollerActive(STATUS_INDICATORS_KEY)).toBe(false);

    poller.dispose();
  });

  it("fires no status update requests during memory pressure", () => {
    // Start at normal, let some polls fire.
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const refresh = vi.fn();
    const poller = registerStatusPoller(refresh);

    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(3); // 30s / 10s = 3

    // Enter elevated memory pressure.
    setMemoryUsage(0.55);
    vi.advanceTimersByTime(1000);
    refresh.mockClear();

    // Advance 2 minutes — zero calls should fire.
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(refresh).not.toHaveBeenCalled();

    poller.dispose();
  });

  it("preserves last known state without updates during pressure", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const refresh = vi.fn();
    const poller = registerStatusPoller(refresh);

    // Let polling establish some state.
    vi.advanceTimersByTime(20_000);
    const callsBeforePressure = refresh.mock.calls.length;
    expect(callsBeforePressure).toBe(2);

    // Enter memory pressure.
    setMemoryUsage(0.55);
    vi.advanceTimersByTime(1000);

    // The poller should no longer be active (unregistered), but the
    // component still holds the last known status in React state.
    expect(isPollerActive(STATUS_INDICATORS_KEY)).toBe(false);

    // Advance time — no additional refresh calls.
    refresh.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();

    poller.dispose();
  });

  it("resumes polling when memory pressure subsides", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const refresh = vi.fn();
    const poller = registerStatusPoller(refresh);

    // Enter memory pressure.
    setMemoryUsage(0.55);
    vi.advanceTimersByTime(1000);
    expect(poller.isEnabled()).toBe(false);
    refresh.mockClear();

    // Memory drops back to normal.
    setMemoryUsage(0.2);
    vi.advanceTimersByTime(1000);

    expect(isFeatureDisabled("autoRefresh")).toBe(false);
    expect(poller.isEnabled()).toBe(true);
    expect(isPollerActive(STATUS_INDICATORS_KEY)).toBe(true);

    // Verify polling resumes at the original 10s interval.
    refresh.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(3); // 30s / 10s = 3

    poller.dispose();
  });

  it("suspends at all memory tiers that disable autoRefresh", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const refresh = vi.fn();
    const poller = registerStatusPoller(refresh);

    // Elevated (50-70%)
    setMemoryUsage(0.55);
    vi.advanceTimersByTime(1000);
    expect(poller.isEnabled()).toBe(false);

    // Warning (70-85%)
    setMemoryUsage(0.75);
    vi.advanceTimersByTime(1000);
    expect(poller.isEnabled()).toBe(false);
    expect(isFeatureDisabled("autoRefresh")).toBe(true);

    // Critical (85%+)
    setMemoryUsage(0.90);
    vi.advanceTimersByTime(1000);
    expect(poller.isEnabled()).toBe(false);
    expect(isFeatureDisabled("autoRefresh")).toBe(true);

    // No polls fired during the entire pressure period.
    refresh.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();

    poller.dispose();
  });

  it("handles rapid memory level transitions without timer leaks", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const refresh = vi.fn();
    const poller = registerStatusPoller(refresh);

    // Cycle through pressure levels rapidly.
    for (let i = 0; i < 5; i++) {
      // Enter pressure
      setMemoryUsage(0.55);
      vi.advanceTimersByTime(1000);
      // Return to normal
      setMemoryUsage(0.2);
      vi.advanceTimersByTime(1000);
    }

    // After all cycles, exactly one poller should be active.
    expect(isPollerActive(STATUS_INDICATORS_KEY)).toBe(true);

    refresh.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1); // not 5

    poller.dispose();
  });
});
