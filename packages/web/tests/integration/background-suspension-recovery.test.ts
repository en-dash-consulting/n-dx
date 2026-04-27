// @vitest-environment jsdom
/**
 * Integration tests for background tab suspension and recovery.
 *
 * Exercises the complete end-to-end workflow:
 *
 *   tab-visibility → polling-manager → suspend/resume
 *   memory-monitor → graceful-degradation → autoRefresh flag
 *
 * Validates all three acceptance criteria:
 *   1. Polling suspension when tab becomes inactive
 *   2. Polling resumption when tab becomes active
 *   3. Memory optimization during background state
 *
 * Unlike the unit-level tests that verify individual module pairs, these tests
 * wire up the full subsystem (tab visibility + polling manager + memory monitor +
 * graceful degradation) and verify they cooperate correctly through realistic
 * multi-step scenarios.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startPollingManager,
  registerPoller,
  unregisterPoller,
  isSuspended,
  isPollerActive,
  getRegisteredPollers,
  getPollerCount,
  resetPollingManager,
} from "../../src/viewer/polling/polling-manager.js";
import {
  startTabVisibilityMonitor,
  getTabVisibility,
  isTabVisible,
  onVisibilityChange,
  getTransitionHistory,
  resetTabVisibility,
} from "../../src/viewer/polling/tab-visibility.js";
import {
  startMemoryMonitor,
  resetMemoryMonitor,
} from "../../src/viewer/performance/memory-monitor.js";
import {
  startDegradation,
  isFeatureDisabled,
  onDegradationChange,
  getDegradationState,
  getCurrentTier,
  resetDegradation,
} from "../../src/viewer/performance/graceful-degradation.js";

// ─── Constants (mirror real component keys & intervals) ────────────────────

const POLLER_KEYS = {
  STATUS: "status-indicators",
  LOADER: "loader:data-status",
  EXECUTION: "execution-panel",
} as const;

const POLLER_INTERVALS = {
  STATUS: 10_000,
  LOADER: 5_000,
  EXECUTION: 3_000,
} as const;

/** Debounce delay used by the polling manager when the tab becomes visible. */
const RESUME_DEBOUNCE_MS = 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate a visibility state change via the Page Visibility API. */
function simulateVisibilityChange(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Background the tab (convenience). */
function backgroundTab(): void {
  simulateVisibilityChange("hidden");
}

/** Foreground the tab and wait for the resume debounce to complete. */
function foregroundTab(): void {
  simulateVisibilityChange("visible");
  vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
}

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
 * Register a poller that mimics the real component pattern: the `enabled`
 * flag is driven reactively by the autoRefresh degradation feature.
 */
function registerDegradationAwarePoller(
  key: string,
  callback: () => void,
  intervalMs: number
) {
  let currentEnabled = !isFeatureDisabled("autoRefresh");

  function applyEnabled(enabled: boolean) {
    if (enabled) {
      registerPoller(key, callback, intervalMs);
    } else {
      unregisterPoller(key);
    }
    currentEnabled = enabled;
  }

  applyEnabled(currentEnabled);

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
      unregisterPoller(key);
    },
  };
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

let originalVisibilityState: string;
let originalMemory: unknown;

beforeEach(() => {
  originalVisibilityState = document.visibilityState;
  originalMemory = (performance as unknown as { memory?: unknown }).memory;

  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    writable: true,
    configurable: true,
  });
  vi.useFakeTimers();

  // Initialize the full subsystem in the same order as main.ts
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
  Object.defineProperty(document, "visibilityState", {
    value: originalVisibilityState,
    writable: true,
    configurable: true,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Tab backgrounding suspends all polling
// ═══════════════════════════════════════════════════════════════════════════════

describe("polling suspension when tab becomes inactive", { timeout: 120_000 }, () => {
  it("suspends all registered pollers immediately on tab hide", () => {
    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();

    registerPoller(POLLER_KEYS.STATUS, cbStatus, POLLER_INTERVALS.STATUS);
    registerPoller(POLLER_KEYS.LOADER, cbLoader, POLLER_INTERVALS.LOADER);
    registerPoller(POLLER_KEYS.EXECUTION, cbExecution, POLLER_INTERVALS.EXECUTION);

    // Verify all pollers are active.
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(true);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(true);
    expect(isPollerActive(POLLER_KEYS.EXECUTION)).toBe(true);

    // Background the tab.
    backgroundTab();

    // All pollers should be suspended immediately (no debounce).
    expect(isSuspended()).toBe(true);
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(false);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(false);
    expect(isPollerActive(POLLER_KEYS.EXECUTION)).toBe(false);
  });

  it("fires zero callbacks during a prolonged background period", () => {
    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();

    registerPoller(POLLER_KEYS.STATUS, cbStatus, POLLER_INTERVALS.STATUS);
    registerPoller(POLLER_KEYS.LOADER, cbLoader, POLLER_INTERVALS.LOADER);
    registerPoller(POLLER_KEYS.EXECUTION, cbExecution, POLLER_INTERVALS.EXECUTION);

    // Let some polls fire to confirm they work.
    vi.advanceTimersByTime(30_000);
    expect(cbStatus).toHaveBeenCalledTimes(3);  // 30s / 10s
    expect(cbLoader).toHaveBeenCalledTimes(6);  // 30s / 5s
    expect(cbExecution).toHaveBeenCalledTimes(10); // 30s / 3s

    // Background and clear.
    backgroundTab();
    cbStatus.mockClear();
    cbLoader.mockClear();
    cbExecution.mockClear();

    // Simulate 10 minutes of background time.
    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(cbStatus).not.toHaveBeenCalled();
    expect(cbLoader).not.toHaveBeenCalled();
    expect(cbExecution).not.toHaveBeenCalled();
  });

  it("preserves poller registry during suspension", () => {
    registerPoller(POLLER_KEYS.STATUS, vi.fn(), POLLER_INTERVALS.STATUS);
    registerPoller(POLLER_KEYS.LOADER, vi.fn(), POLLER_INTERVALS.LOADER);

    backgroundTab();

    // Pollers remain registered (just inactive) — state is preserved.
    const pollers = getRegisteredPollers();
    expect(pollers).toHaveLength(2);

    const statusEntry = pollers.find((p) => p.key === POLLER_KEYS.STATUS);
    const loaderEntry = pollers.find((p) => p.key === POLLER_KEYS.LOADER);

    expect(statusEntry).toBeDefined();
    expect(statusEntry!.intervalMs).toBe(POLLER_INTERVALS.STATUS);
    expect(statusEntry!.active).toBe(false);

    expect(loaderEntry).toBeDefined();
    expect(loaderEntry!.intervalMs).toBe(POLLER_INTERVALS.LOADER);
    expect(loaderEntry!.active).toBe(false);
  });

  it("correctly tracks tab visibility state during suspension", () => {
    backgroundTab();

    expect(getTabVisibility()).toBe("hidden");
    expect(isTabVisible()).toBe(false);

    const history = getTransitionHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[history.length - 1].state).toBe("hidden");
  });

  it("pollers registered while tab is hidden start inactive", () => {
    backgroundTab();

    const lateCallback = vi.fn();
    registerPoller("late-poller", lateCallback, 1000);

    // Should not be active because the manager is suspended.
    expect(isPollerActive("late-poller")).toBe(false);

    vi.advanceTimersByTime(10_000);
    expect(lateCallback).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Tab foregrounding resumes all polling
// ═══════════════════════════════════════════════════════════════════════════════

describe("polling resumption when tab becomes active", { timeout: 120_000 }, () => {
  it("resumes all pollers after debounce when tab becomes visible", () => {
    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();

    registerPoller(POLLER_KEYS.STATUS, cbStatus, POLLER_INTERVALS.STATUS);
    registerPoller(POLLER_KEYS.LOADER, cbLoader, POLLER_INTERVALS.LOADER);
    registerPoller(POLLER_KEYS.EXECUTION, cbExecution, POLLER_INTERVALS.EXECUTION);

    // Background and clear.
    backgroundTab();
    cbStatus.mockClear();
    cbLoader.mockClear();
    cbExecution.mockClear();

    // Foreground (includes debounce wait).
    foregroundTab();

    expect(isSuspended()).toBe(false);
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(true);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(true);
    expect(isPollerActive(POLLER_KEYS.EXECUTION)).toBe(true);

    // Verify callbacks fire at their original intervals.
    vi.advanceTimersByTime(30_000);
    expect(cbStatus).toHaveBeenCalledTimes(3);  // 30s / 10s
    expect(cbLoader).toHaveBeenCalledTimes(6);  // 30s / 5s
    expect(cbExecution).toHaveBeenCalledTimes(10); // 30s / 3s
  });

  it("does not resume before debounce completes", () => {
    const cbStatus = vi.fn();
    registerPoller(POLLER_KEYS.STATUS, cbStatus, POLLER_INTERVALS.STATUS);

    backgroundTab();
    cbStatus.mockClear();

    // Trigger visible but only advance 50ms (half the debounce).
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    // Still suspended mid-debounce.
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(false);

    // Complete the debounce.
    vi.advanceTimersByTime(50);
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(true);
  });

  it("preserves original intervals after suspend/resume cycle", () => {
    const cbStatus = vi.fn();
    const cbLoader = vi.fn();

    registerPoller(POLLER_KEYS.STATUS, cbStatus, POLLER_INTERVALS.STATUS);
    registerPoller(POLLER_KEYS.LOADER, cbLoader, POLLER_INTERVALS.LOADER);

    // Full suspend/resume cycle.
    backgroundTab();
    vi.advanceTimersByTime(60_000); // long background period
    foregroundTab();

    cbStatus.mockClear();
    cbLoader.mockClear();

    // Check at exactly 5 seconds — only loader should have fired.
    vi.advanceTimersByTime(5_000);
    expect(cbLoader).toHaveBeenCalledTimes(1);
    expect(cbStatus).not.toHaveBeenCalled();

    // At 10 seconds — status fires, loader fires again.
    vi.advanceTimersByTime(5_000);
    expect(cbLoader).toHaveBeenCalledTimes(2);
    expect(cbStatus).toHaveBeenCalledTimes(1);
  });

  it("resumes pollers that were registered during background state", () => {
    backgroundTab();

    const lateCallback = vi.fn();
    registerPoller("late-poller", lateCallback, 2000);

    // Not active while backgrounded.
    expect(isPollerActive("late-poller")).toBe(false);

    foregroundTab();

    // Now it should be active.
    expect(isPollerActive("late-poller")).toBe(true);
    vi.advanceTimersByTime(6000);
    expect(lateCallback).toHaveBeenCalledTimes(3);
  });

  it("handles multiple suspend/resume cycles without timer leaks", () => {
    const callback = vi.fn();
    registerPoller(POLLER_KEYS.STATUS, callback, POLLER_INTERVALS.STATUS);

    // 10 full cycles.
    for (let i = 0; i < 10; i++) {
      backgroundTab();
      vi.advanceTimersByTime(5000);
      foregroundTab();
    }

    callback.mockClear();
    vi.advanceTimersByTime(10_000);

    // Exactly 1 fire per interval — no leaked timers from prior cycles.
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("handles rapid tab switching (alt-tab flicker)", () => {
    const callback = vi.fn();
    registerPoller(POLLER_KEYS.LOADER, callback, POLLER_INTERVALS.LOADER);

    // Rapid sequence: hidden → visible (partial debounce) → hidden → visible
    backgroundTab();
    callback.mockClear();

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(30); // partial debounce
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(30);
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(30);
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(30);
    simulateVisibilityChange("visible");

    // Complete the final debounce.
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);

    expect(isSuspended()).toBe(false);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("cancels pending resume if tab goes hidden before debounce completes", () => {
    const callback = vi.fn();
    registerPoller(POLLER_KEYS.STATUS, callback, POLLER_INTERVALS.STATUS);

    backgroundTab();
    callback.mockClear();

    // Start resuming…
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50); // halfway through debounce

    // …but go hidden again before it completes.
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(200); // well past debounce

    expect(isSuspended()).toBe(true);
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(callback).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Memory optimization during background state
// ═══════════════════════════════════════════════════════════════════════════════

describe("memory optimization during background state", { timeout: 120_000 }, () => {
  it("no polling occurs when both tab backgrounded and memory pressure active", () => {
    setMemoryUsage(0.2); // normal
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();

    const statusPoller = registerDegradationAwarePoller(
      POLLER_KEYS.STATUS, cbStatus, POLLER_INTERVALS.STATUS
    );
    const loaderPoller = registerDegradationAwarePoller(
      POLLER_KEYS.LOADER, cbLoader, POLLER_INTERVALS.LOADER
    );

    // Confirm baseline polling works.
    vi.advanceTimersByTime(10_000);
    expect(cbStatus).toHaveBeenCalledTimes(1);
    expect(cbLoader).toHaveBeenCalledTimes(2);

    // Double whammy: background the tab AND spike memory.
    backgroundTab();
    setMemoryUsage(0.60); // elevated → autoRefresh disabled
    vi.advanceTimersByTime(1000); // memory tick

    cbStatus.mockClear();
    cbLoader.mockClear();

    // Advance 5 minutes — zero callbacks.
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(cbStatus).not.toHaveBeenCalled();
    expect(cbLoader).not.toHaveBeenCalled();

    statusPoller.dispose();
    loaderPoller.dispose();
  });

  it("foregrounds tab but stays suspended if memory pressure remains", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const callback = vi.fn();
    const poller = registerDegradationAwarePoller(
      POLLER_KEYS.STATUS, callback, POLLER_INTERVALS.STATUS
    );

    // Background + memory spike.
    backgroundTab();
    setMemoryUsage(0.60);
    vi.advanceTimersByTime(1000);
    callback.mockClear();

    // Foreground the tab.
    foregroundTab();

    // Tab is visible, polling manager is resumed, but autoRefresh is still
    // disabled due to memory pressure — the component-level flag keeps
    // the poller unregistered.
    expect(isSuspended()).toBe(false); // manager itself is not suspended
    expect(poller.isEnabled()).toBe(false); // but feature-level flag blocks it
    expect(isFeatureDisabled("autoRefresh")).toBe(true);

    vi.advanceTimersByTime(60_000);
    expect(callback).not.toHaveBeenCalled();

    poller.dispose();
  });

  it("fully recovers when both tab foregrounds and memory normalizes", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const callback = vi.fn();
    const poller = registerDegradationAwarePoller(
      POLLER_KEYS.LOADER, callback, POLLER_INTERVALS.LOADER
    );

    // Background + memory spike.
    backgroundTab();
    setMemoryUsage(0.60);
    vi.advanceTimersByTime(1000);
    callback.mockClear();

    // Step 1: Foreground the tab (memory still high).
    foregroundTab();
    expect(poller.isEnabled()).toBe(false);

    // Step 2: Memory normalizes.
    setMemoryUsage(0.15);
    vi.advanceTimersByTime(1000);

    expect(poller.isEnabled()).toBe(true);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(true);
    expect(isFeatureDisabled("autoRefresh")).toBe(false);

    // Verify polling resumes at original interval.
    callback.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(callback).toHaveBeenCalledTimes(3); // 15s / 5s

    poller.dispose();
  });

  it("recovers when memory normalizes while tab is still backgrounded", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const callback = vi.fn();
    const poller = registerDegradationAwarePoller(
      POLLER_KEYS.LOADER, callback, POLLER_INTERVALS.LOADER
    );

    // Background + memory spike.
    backgroundTab();
    setMemoryUsage(0.60);
    vi.advanceTimersByTime(1000);
    callback.mockClear();

    // Memory drops but tab is still hidden.
    setMemoryUsage(0.15);
    vi.advanceTimersByTime(1000);

    // Feature flag re-enables, but tab suspension still blocks.
    expect(poller.isEnabled()).toBe(true);
    expect(isSuspended()).toBe(true);
    // Poller is re-registered but immediately inactive due to tab suspension.
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(callback).not.toHaveBeenCalled();

    // Now foreground — should activate.
    foregroundTab();
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(true);

    callback.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(callback).toHaveBeenCalledTimes(2); // 10s / 5s

    poller.dispose();
  });

  it("memory pressure during background does not corrupt state", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();

    const statusPoller = registerDegradationAwarePoller(
      POLLER_KEYS.STATUS, cbStatus, POLLER_INTERVALS.STATUS
    );
    const loaderPoller = registerDegradationAwarePoller(
      POLLER_KEYS.LOADER, cbLoader, POLLER_INTERVALS.LOADER
    );

    // Background the tab.
    backgroundTab();

    // Cycle memory through all tiers while backgrounded.
    setMemoryUsage(0.55); // elevated
    vi.advanceTimersByTime(1000);
    expect(getCurrentTier()).toBe("elevated");

    setMemoryUsage(0.75); // warning
    vi.advanceTimersByTime(1000);
    expect(getCurrentTier()).toBe("warning");

    setMemoryUsage(0.90); // critical
    vi.advanceTimersByTime(1000);
    expect(getCurrentTier()).toBe("critical");

    setMemoryUsage(0.15); // back to normal
    vi.advanceTimersByTime(1000);
    expect(getCurrentTier()).toBe("normal");

    // Foreground — everything should be healthy.
    foregroundTab();

    expect(isSuspended()).toBe(false);
    expect(statusPoller.isEnabled()).toBe(true);
    expect(loaderPoller.isEnabled()).toBe(true);
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(true);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(true);

    cbStatus.mockClear();
    cbLoader.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(cbStatus).toHaveBeenCalledTimes(1);
    expect(cbLoader).toHaveBeenCalledTimes(2);

    statusPoller.dispose();
    loaderPoller.dispose();
  });

  it("degradation listeners fire correctly during tab transitions", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const degradationListener = vi.fn();
    const unsub = onDegradationChange(degradationListener);

    // Background the tab (no degradation change expected from this alone).
    backgroundTab();
    expect(degradationListener).not.toHaveBeenCalled();

    // Spike memory while backgrounded.
    setMemoryUsage(0.60);
    vi.advanceTimersByTime(1000);

    expect(degradationListener).toHaveBeenCalledTimes(1);
    expect(degradationListener.mock.calls[0][0].tier).toBe("elevated");
    expect(
      degradationListener.mock.calls[0][0].disabledFeatures.has("autoRefresh")
    ).toBe(true);

    // Foreground (no degradation change from this).
    const callsBefore = degradationListener.mock.calls.length;
    foregroundTab();
    expect(degradationListener.mock.calls.length).toBe(callsBefore);

    // Memory normalizes.
    setMemoryUsage(0.15);
    vi.advanceTimersByTime(1000);
    expect(degradationListener).toHaveBeenCalledTimes(2);
    expect(
      degradationListener.mock.calls[1][0].disabledFeatures.has("autoRefresh")
    ).toBe(false);

    unsub();
  });

  it("visibility listeners continue to fire during memory pressure", () => {
    setMemoryUsage(0.60); // elevated from the start
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const visibilityListener = vi.fn();
    onVisibilityChange(visibilityListener);

    // Tab transitions should still be tracked even under memory pressure.
    backgroundTab();
    expect(visibilityListener).toHaveBeenCalledTimes(1);
    expect(visibilityListener.mock.calls[0][0].state).toBe("hidden");

    foregroundTab();
    expect(visibilityListener).toHaveBeenCalledTimes(2);
    expect(visibilityListener.mock.calls[1][0].state).toBe("visible");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Comprehensive end-to-end scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe("end-to-end suspension and recovery scenarios", { timeout: 120_000 }, () => {
  it("simulates a realistic user session: work → background → return", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();

    const statusPoller = registerDegradationAwarePoller(
      POLLER_KEYS.STATUS, cbStatus, POLLER_INTERVALS.STATUS
    );
    const loaderPoller = registerDegradationAwarePoller(
      POLLER_KEYS.LOADER, cbLoader, POLLER_INTERVALS.LOADER
    );
    registerPoller(POLLER_KEYS.EXECUTION, cbExecution, POLLER_INTERVALS.EXECUTION);

    // Phase 1: Active use for 1 minute.
    vi.advanceTimersByTime(60_000);
    expect(cbStatus).toHaveBeenCalledTimes(6);  // 60s / 10s
    expect(cbLoader).toHaveBeenCalledTimes(12); // 60s / 5s
    expect(cbExecution).toHaveBeenCalledTimes(20); // 60s / 3s

    // Phase 2: User switches to another tab for 5 minutes.
    backgroundTab();
    cbStatus.mockClear();
    cbLoader.mockClear();
    cbExecution.mockClear();

    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(cbStatus).not.toHaveBeenCalled();
    expect(cbLoader).not.toHaveBeenCalled();
    expect(cbExecution).not.toHaveBeenCalled();

    // Phase 3: User returns.
    foregroundTab();

    cbStatus.mockClear();
    cbLoader.mockClear();
    cbExecution.mockClear();

    vi.advanceTimersByTime(30_000);
    expect(cbStatus).toHaveBeenCalledTimes(3);
    expect(cbLoader).toHaveBeenCalledTimes(6);
    expect(cbExecution).toHaveBeenCalledTimes(10);

    statusPoller.dispose();
    loaderPoller.dispose();
  });

  it("simulates memory pressure during background and recovery", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    const callback = vi.fn();
    const poller = registerDegradationAwarePoller(
      POLLER_KEYS.LOADER, callback, POLLER_INTERVALS.LOADER
    );

    // Phase 1: Normal operation.
    vi.advanceTimersByTime(15_000);
    expect(callback).toHaveBeenCalledTimes(3);

    // Phase 2: Memory starts climbing.
    setMemoryUsage(0.55); // elevated
    vi.advanceTimersByTime(1000);
    callback.mockClear();

    // Polling stopped by feature flag (not tab visibility).
    expect(poller.isEnabled()).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(callback).not.toHaveBeenCalled();

    // Phase 3: Tab goes to background while under pressure.
    backgroundTab();
    vi.advanceTimersByTime(60_000);
    expect(callback).not.toHaveBeenCalled();

    // Phase 4: User returns, memory still high.
    foregroundTab();
    vi.advanceTimersByTime(10_000);
    expect(callback).not.toHaveBeenCalled();

    // Phase 5: Memory finally drops.
    setMemoryUsage(0.15);
    vi.advanceTimersByTime(1000);

    expect(poller.isEnabled()).toBe(true);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(true);

    callback.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(callback).toHaveBeenCalledTimes(3);

    poller.dispose();
  });

  it("simulates repeated tab switches with stable memory", () => {
    const cbLoader = vi.fn();
    registerPoller(POLLER_KEYS.LOADER, cbLoader, POLLER_INTERVALS.LOADER);

    // 5 cycles of: work 30s → background 2min → return
    for (let cycle = 0; cycle < 5; cycle++) {
      cbLoader.mockClear();

      // Active period.
      vi.advanceTimersByTime(30_000);
      expect(cbLoader).toHaveBeenCalledTimes(6); // 30s / 5s

      // Background period.
      backgroundTab();
      cbLoader.mockClear();
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(cbLoader).not.toHaveBeenCalled();

      // Return.
      foregroundTab();
    }

    // Final check: only one timer active.
    cbLoader.mockClear();
    vi.advanceTimersByTime(5000);
    expect(cbLoader).toHaveBeenCalledTimes(1);
  });

  it("all pollers resume independently with correct intervals after recovery", () => {
    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();

    registerPoller(POLLER_KEYS.STATUS, cbStatus, POLLER_INTERVALS.STATUS);
    registerPoller(POLLER_KEYS.LOADER, cbLoader, POLLER_INTERVALS.LOADER);
    registerPoller(POLLER_KEYS.EXECUTION, cbExecution, POLLER_INTERVALS.EXECUTION);

    // Background, then foreground.
    backgroundTab();
    vi.advanceTimersByTime(120_000); // 2 min background
    foregroundTab();

    cbStatus.mockClear();
    cbLoader.mockClear();
    cbExecution.mockClear();

    // At 3 seconds: only execution should have fired.
    vi.advanceTimersByTime(3000);
    expect(cbExecution).toHaveBeenCalledTimes(1);
    expect(cbLoader).not.toHaveBeenCalled();
    expect(cbStatus).not.toHaveBeenCalled();

    // At 5 seconds: loader fires too.
    vi.advanceTimersByTime(2000);
    expect(cbLoader).toHaveBeenCalledTimes(1);
    expect(cbStatus).not.toHaveBeenCalled();

    // At 10 seconds: status fires, execution at ~3, loader at 2.
    vi.advanceTimersByTime(5000);
    expect(cbStatus).toHaveBeenCalledTimes(1);
    expect(cbLoader).toHaveBeenCalledTimes(2);
    expect(cbExecution).toHaveBeenCalledTimes(3);
  });

  it("getDegradationState remains consistent throughout suspension/recovery", () => {
    setMemoryUsage(0.2);
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    // Normal state.
    let state = getDegradationState();
    expect(state.tier).toBe("normal");
    expect(state.isDegraded).toBe(false);
    expect(state.disabledFeatures.size).toBe(0);

    // Background the tab — degradation state should not change.
    backgroundTab();
    state = getDegradationState();
    expect(state.tier).toBe("normal");
    expect(state.isDegraded).toBe(false);

    // Spike memory.
    setMemoryUsage(0.75); // warning
    vi.advanceTimersByTime(1000);
    state = getDegradationState();
    expect(state.tier).toBe("warning");
    expect(state.isDegraded).toBe(true);
    expect(state.disabledFeatures.has("autoRefresh")).toBe(true);
    expect(state.disabledFeatures.has("animations")).toBe(true);

    // Foreground — degradation unchanged.
    foregroundTab();
    state = getDegradationState();
    expect(state.tier).toBe("warning");
    expect(state.isDegraded).toBe(true);

    // Memory drops.
    setMemoryUsage(0.15);
    vi.advanceTimersByTime(1000);
    state = getDegradationState();
    expect(state.tier).toBe("normal");
    expect(state.isDegraded).toBe(false);
    expect(state.disabledFeatures.size).toBe(0);
  });
});
