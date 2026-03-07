// @vitest-environment jsdom
/**
 * Integration tests for loader polling suspension during memory pressure.
 *
 * Verifies that the 5-second loader data-status polling (registered via
 * registerPoller with key "loader:data-status") is paused when the graceful
 * degradation system disables the "autoRefresh" feature due to elevated
 * memory usage (≥50% heap).
 *
 * These tests exercise: memory-monitor → graceful-degradation → polling-manager,
 * using the same key and interval as the real loader module.
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

// ─── Constants (mirror loader.ts) ────────────────────────────────────────────

const LOADER_KEY = "loader:data-status";
const LOADER_INTERVAL_MS = 5000;

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
 * Simulate what the useAppData hook does: register a poller with the enabled
 * flag driven by isFeatureDisabled("autoRefresh"), subscribing to degradation
 * changes reactively.
 *
 * Returns a control object to inspect enabled state and clean up.
 */
function registerLoaderPoller(pollForChanges: () => void) {
  let currentEnabled = !isFeatureDisabled("autoRefresh");

  function applyEnabled(enabled: boolean) {
    if (enabled) {
      registerPoller(LOADER_KEY, pollForChanges, LOADER_INTERVAL_MS);
    } else {
      unregisterPoller(LOADER_KEY);
    }
    currentEnabled = enabled;
  }

  // Initial registration
  applyEnabled(currentEnabled);

  // Subscribe to degradation changes (mirrors the useEffect + useState pattern
  // in useAppData that tracks autoRefreshDisabled reactively).
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
      unregisterPoller(LOADER_KEY);
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

describe("loader memory pressure suspension", () => {
  it("stops polling when isFeatureDisabled(autoRefresh) becomes true", () => {
    // Start with normal memory → polling active.
    setMemoryUsage(0.2); // 20% → normal
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const pollForChanges = vi.fn();
    const poller = registerLoaderPoller(pollForChanges);

    // Confirm polling fires normally at 5s interval.
    vi.advanceTimersByTime(5000);
    expect(pollForChanges).toHaveBeenCalledTimes(1);

    // Spike memory to elevated (55%) → autoRefresh disabled at 50% threshold.
    setMemoryUsage(0.55);
    vi.advanceTimersByTime(1000); // trigger memory monitor tick

    expect(isFeatureDisabled("autoRefresh")).toBe(true);
    expect(poller.isEnabled()).toBe(false);
    expect(isPollerActive(LOADER_KEY)).toBe(false);

    poller.dispose();
  });

  it("fires no loader requests during memory pressure", () => {
    // Start at normal, let some polls fire.
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const pollForChanges = vi.fn();
    const poller = registerLoaderPoller(pollForChanges);

    vi.advanceTimersByTime(15_000);
    expect(pollForChanges).toHaveBeenCalledTimes(3); // 15s / 5s = 3

    // Enter elevated memory pressure.
    setMemoryUsage(0.55);
    vi.advanceTimersByTime(1000);
    pollForChanges.mockClear();

    // Advance 2 minutes — zero calls should fire.
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(pollForChanges).not.toHaveBeenCalled();

    poller.dispose();
  });

  it("preserves last known state without updates during pressure", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const pollForChanges = vi.fn();
    const poller = registerLoaderPoller(pollForChanges);

    // Let polling establish some state.
    vi.advanceTimersByTime(10_000);
    const callsBeforePressure = pollForChanges.mock.calls.length;
    expect(callsBeforePressure).toBe(2); // 10s / 5s = 2

    // Enter memory pressure.
    setMemoryUsage(0.55);
    vi.advanceTimersByTime(1000);

    // The poller should no longer be active (unregistered), but the
    // component still holds the last known data in React state.
    expect(isPollerActive(LOADER_KEY)).toBe(false);

    // Advance time — no additional poll calls.
    pollForChanges.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(pollForChanges).not.toHaveBeenCalled();

    poller.dispose();
  });

  it("resumes polling when memory pressure subsides", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const pollForChanges = vi.fn();
    const poller = registerLoaderPoller(pollForChanges);

    // Enter memory pressure.
    setMemoryUsage(0.55);
    vi.advanceTimersByTime(1000);
    expect(poller.isEnabled()).toBe(false);
    pollForChanges.mockClear();

    // Memory drops back to normal.
    setMemoryUsage(0.2);
    vi.advanceTimersByTime(1000);

    expect(isFeatureDisabled("autoRefresh")).toBe(false);
    expect(poller.isEnabled()).toBe(true);
    expect(isPollerActive(LOADER_KEY)).toBe(true);

    // Verify polling resumes at the original 5s interval.
    pollForChanges.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(pollForChanges).toHaveBeenCalledTimes(3); // 15s / 5s = 3

    poller.dispose();
  });

  it("suspends at all memory tiers that disable autoRefresh", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const pollForChanges = vi.fn();
    const poller = registerLoaderPoller(pollForChanges);

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
    pollForChanges.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(pollForChanges).not.toHaveBeenCalled();

    poller.dispose();
  });

  it("handles rapid memory level transitions without timer leaks", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const pollForChanges = vi.fn();
    const poller = registerLoaderPoller(pollForChanges);

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
    expect(isPollerActive(LOADER_KEY)).toBe(true);

    pollForChanges.mockClear();
    vi.advanceTimersByTime(5000);
    expect(pollForChanges).toHaveBeenCalledTimes(1); // not 5

    poller.dispose();
  });
});
