// @vitest-environment jsdom
/**
 * Integration tests for memory-aware polling suspension.
 *
 * Verifies that all three client-side polling loops are properly suspended
 * when memory pressure is detected and restarted when it clears.
 *
 * The three polling loops under test:
 *   1. status-indicators  (10 s interval) — dashboard status polling
 *   2. loader:data-status  (5 s interval) — file change detection
 *   3. execution-panel     (3 s interval) — hench execution status
 *
 * Memory pressure flow:
 *   memory-monitor → graceful-degradation → autoRefresh feature flag
 *     → component-level register/unregister with polling-manager
 *
 * Additionally validates refresh-throttle behaviour under pressure.
 *
 * Acceptance criteria:
 *   ✓ All three polling loops stop under simulated memory pressure
 *   ✓ All three polling loops restart when memory pressure clears
 *   ✓ No resource leaks during suspension/restart cycles
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
} from "../../src/viewer/polling-manager.js";
import {
  startTabVisibilityMonitor,
  resetTabVisibility,
} from "../../src/viewer/tab-visibility.js";
import {
  startMemoryMonitor,
  getCurrentLevel,
  resetMemoryMonitor,
} from "../../src/viewer/memory-monitor.js";
import {
  startDegradation,
  isFeatureDisabled,
  onDegradationChange,
  getDegradationState,
  getCurrentTier,
  resetDegradation,
} from "../../src/viewer/graceful-degradation.js";
import {
  startRefreshThrottle,
  getQueueState,
  enqueueRefresh,
  getRecommendedInterval,
  resetRefreshThrottle,
} from "../../src/viewer/refresh-throttle.js";

// ─── Constants (mirror real component keys & intervals) ─────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/** Advance time to trigger a memory monitor tick (polls at configured interval). */
function triggerMemoryTick(ms = 1000): void {
  vi.advanceTimersByTime(ms);
}

/**
 * Register a degradation-aware poller — mirrors the real component pattern
 * where the `enabled` flag is driven reactively by the autoRefresh feature.
 *
 * When autoRefresh is disabled (memory pressure), the poller is unregistered.
 * When autoRefresh is re-enabled, the poller is re-registered.
 */
function registerDegradationAwarePoller(
  key: string,
  callback: () => void,
  intervalMs: number,
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

/**
 * Register all three degradation-aware pollers and return controls.
 */
function registerAllPollers(
  cbStatus: () => void,
  cbLoader: () => void,
  cbExecution: () => void,
) {
  const status = registerDegradationAwarePoller(
    POLLER_KEYS.STATUS,
    cbStatus,
    POLLER_INTERVALS.STATUS,
  );
  const loader = registerDegradationAwarePoller(
    POLLER_KEYS.LOADER,
    cbLoader,
    POLLER_INTERVALS.LOADER,
  );
  const execution = registerDegradationAwarePoller(
    POLLER_KEYS.EXECUTION,
    cbExecution,
    POLLER_INTERVALS.EXECUTION,
  );

  return {
    status,
    loader,
    execution,
    disposeAll: () => {
      status.dispose();
      loader.dispose();
      execution.dispose();
    },
    allEnabled: () =>
      status.isEnabled() && loader.isEnabled() && execution.isEnabled(),
    noneEnabled: () =>
      !status.isEnabled() && !loader.isEnabled() && !execution.isEnabled(),
  };
}

/** Start the full memory-aware subsystem with a given initial memory ratio. */
function startMemorySubsystem(initialRatio: number, memoryIntervalMs = 1000) {
  setMemoryUsage(initialRatio);
  startMemoryMonitor({ intervalMs: memoryIntervalMs });
  startDegradation();
  startRefreshThrottle();
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

let originalMemory: unknown;

beforeEach(() => {
  originalMemory = (performance as unknown as { memory?: unknown }).memory;
  vi.useFakeTimers();

  // Reset all modules in dependency order.
  resetTabVisibility();
  resetPollingManager();
  resetMemoryMonitor();
  resetDegradation();
  resetRefreshThrottle();

  // Initialize the subsystem (same order as main.ts).
  startTabVisibilityMonitor();
  startPollingManager();
});

afterEach(() => {
  resetRefreshThrottle();
  resetDegradation();
  resetMemoryMonitor();
  resetPollingManager();
  resetTabVisibility();
  vi.useRealTimers();
  clearMemoryMock(originalMemory);
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. All three polling loops stop under simulated memory pressure
// ═════════════════════════════════════════════════════════════════════════════

describe("all three polling loops stop under memory pressure", () => {
  it("suspends all pollers when memory crosses the elevated threshold (50%)", () => {
    startMemorySubsystem(0.2);

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();
    const pollers = registerAllPollers(cbStatus, cbLoader, cbExecution);

    // All pollers should be active initially.
    expect(pollers.allEnabled()).toBe(true);
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(true);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(true);
    expect(isPollerActive(POLLER_KEYS.EXECUTION)).toBe(true);

    // Spike memory to elevated (55% > 50% threshold).
    setMemoryUsage(0.55);
    triggerMemoryTick();

    // All three should now be disabled.
    expect(pollers.noneEnabled()).toBe(true);
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(false);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(false);
    expect(isPollerActive(POLLER_KEYS.EXECUTION)).toBe(false);
    expect(isFeatureDisabled("autoRefresh")).toBe(true);

    pollers.disposeAll();
  });

  it("suspends all pollers at warning threshold (70%)", () => {
    startMemorySubsystem(0.2);

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();
    const pollers = registerAllPollers(cbStatus, cbLoader, cbExecution);

    setMemoryUsage(0.75);
    triggerMemoryTick();

    expect(pollers.noneEnabled()).toBe(true);
    expect(getCurrentTier()).toBe("warning");
    expect(isFeatureDisabled("autoRefresh")).toBe(true);
    expect(isFeatureDisabled("graphRendering")).toBe(true);
    expect(isFeatureDisabled("animations")).toBe(true);

    pollers.disposeAll();
  });

  it("suspends all pollers at critical threshold (85%)", () => {
    startMemorySubsystem(0.2);

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();
    const pollers = registerAllPollers(cbStatus, cbLoader, cbExecution);

    setMemoryUsage(0.90);
    triggerMemoryTick();

    expect(pollers.noneEnabled()).toBe(true);
    expect(getCurrentTier()).toBe("critical");
    expect(isFeatureDisabled("autoRefresh")).toBe(true);
    expect(isFeatureDisabled("detailPanel")).toBe(true);

    pollers.disposeAll();
  });

  it("fires zero callbacks from any poller during prolonged memory pressure", () => {
    startMemorySubsystem(0.2);

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();
    const pollers = registerAllPollers(cbStatus, cbLoader, cbExecution);

    // Let initial polls fire to confirm baseline.
    vi.advanceTimersByTime(30_000);
    expect(cbStatus).toHaveBeenCalledTimes(3); // 30s / 10s
    expect(cbLoader).toHaveBeenCalledTimes(6); // 30s / 5s
    expect(cbExecution).toHaveBeenCalledTimes(10); // 30s / 3s

    // Enter memory pressure.
    setMemoryUsage(0.55);
    triggerMemoryTick();

    cbStatus.mockClear();
    cbLoader.mockClear();
    cbExecution.mockClear();

    // Advance 5 minutes — zero callbacks from any poller.
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(cbStatus).not.toHaveBeenCalled();
    expect(cbLoader).not.toHaveBeenCalled();
    expect(cbExecution).not.toHaveBeenCalled();

    pollers.disposeAll();
  });

  it("suspension is driven by memory pressure, not tab visibility", () => {
    startMemorySubsystem(0.2);

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();
    const pollers = registerAllPollers(cbStatus, cbLoader, cbExecution);

    // Tab is still visible — polling manager is NOT suspended.
    expect(isSuspended()).toBe(false);

    // But memory pressure disables the feature flag.
    setMemoryUsage(0.60);
    triggerMemoryTick();

    // Polling manager itself is not suspended (tab is visible).
    expect(isSuspended()).toBe(false);
    // But all pollers are disabled by the degradation system.
    expect(pollers.noneEnabled()).toBe(true);

    // Confirm no callbacks fire even though tab is visible.
    cbStatus.mockClear();
    cbLoader.mockClear();
    cbExecution.mockClear();

    vi.advanceTimersByTime(30_000);
    expect(cbStatus).not.toHaveBeenCalled();
    expect(cbLoader).not.toHaveBeenCalled();
    expect(cbExecution).not.toHaveBeenCalled();

    pollers.disposeAll();
  });

  it("refresh throttle also pauses under critical memory pressure", () => {
    startMemorySubsystem(0.2);

    // Verify baseline state.
    expect(getQueueState().paused).toBe(false);
    expect(getQueueState().maxConcurrency).toBe(3);

    // Enter critical pressure.
    setMemoryUsage(0.90);
    triggerMemoryTick();

    expect(getQueueState().paused).toBe(true);
    expect(getQueueState().maxConcurrency).toBe(0);
    expect(getRecommendedInterval()).toBe(Infinity);
  });

  it("refresh throttle reduces concurrency at elevated and warning levels", () => {
    startMemorySubsystem(0.2);

    // Normal: max 3 concurrent
    expect(getQueueState().maxConcurrency).toBe(3);

    // Elevated: max 2 concurrent
    setMemoryUsage(0.55);
    triggerMemoryTick();
    expect(getQueueState().maxConcurrency).toBe(2);

    // Warning: max 1 concurrent (serial)
    setMemoryUsage(0.75);
    triggerMemoryTick();
    expect(getQueueState().maxConcurrency).toBe(1);

    // Critical: max 0 concurrent (paused)
    setMemoryUsage(0.90);
    triggerMemoryTick();
    expect(getQueueState().maxConcurrency).toBe(0);
    expect(getQueueState().paused).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Polling restart when memory pressure clears
// ═════════════════════════════════════════════════════════════════════════════

describe("polling restart when memory pressure clears", () => {
  it("resumes all three pollers when memory drops back to normal", () => {
    startMemorySubsystem(0.2);

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();
    const pollers = registerAllPollers(cbStatus, cbLoader, cbExecution);

    // Enter memory pressure.
    setMemoryUsage(0.55);
    triggerMemoryTick();
    expect(pollers.noneEnabled()).toBe(true);

    // Clear memory pressure.
    setMemoryUsage(0.15);
    triggerMemoryTick();

    // All pollers should be re-enabled and active.
    expect(pollers.allEnabled()).toBe(true);
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(true);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(true);
    expect(isPollerActive(POLLER_KEYS.EXECUTION)).toBe(true);
    expect(isFeatureDisabled("autoRefresh")).toBe(false);
    expect(getCurrentTier()).toBe("normal");

    pollers.disposeAll();
  });

  it("resumes polling at original intervals after pressure clears", () => {
    startMemorySubsystem(0.2);

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();
    const pollers = registerAllPollers(cbStatus, cbLoader, cbExecution);

    // Enter and exit memory pressure.
    setMemoryUsage(0.60);
    triggerMemoryTick();
    setMemoryUsage(0.15);
    triggerMemoryTick();

    cbStatus.mockClear();
    cbLoader.mockClear();
    cbExecution.mockClear();

    // Verify correct intervals: at 3s only execution, at 5s loader too, at 10s status too.
    vi.advanceTimersByTime(3_000);
    expect(cbExecution).toHaveBeenCalledTimes(1);
    expect(cbLoader).not.toHaveBeenCalled();
    expect(cbStatus).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000); // now at 5s
    expect(cbLoader).toHaveBeenCalledTimes(1);
    expect(cbStatus).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000); // now at 10s
    expect(cbStatus).toHaveBeenCalledTimes(1);
    expect(cbLoader).toHaveBeenCalledTimes(2);
    expect(cbExecution).toHaveBeenCalledTimes(3);

    pollers.disposeAll();
  });

  it("resumes from critical → normal in a single step", () => {
    startMemorySubsystem(0.2);

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();
    const pollers = registerAllPollers(cbStatus, cbLoader, cbExecution);

    // Jump to critical.
    setMemoryUsage(0.90);
    triggerMemoryTick();
    expect(getCurrentTier()).toBe("critical");
    expect(pollers.noneEnabled()).toBe(true);

    // Drop straight to normal.
    setMemoryUsage(0.10);
    triggerMemoryTick();

    expect(getCurrentTier()).toBe("normal");
    expect(pollers.allEnabled()).toBe(true);
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(true);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(true);
    expect(isPollerActive(POLLER_KEYS.EXECUTION)).toBe(true);

    // Verify callbacks actually fire.
    cbStatus.mockClear();
    cbLoader.mockClear();
    cbExecution.mockClear();

    vi.advanceTimersByTime(10_000);
    expect(cbStatus).toHaveBeenCalledTimes(1);
    expect(cbLoader).toHaveBeenCalledTimes(2);
    expect(cbExecution).toHaveBeenCalledTimes(3);

    pollers.disposeAll();
  });

  it("resumes from warning → normal (skipping elevated)", () => {
    startMemorySubsystem(0.2);

    const cbLoader = vi.fn();
    const pollers = registerAllPollers(vi.fn(), cbLoader, vi.fn());

    // Jump to warning.
    setMemoryUsage(0.75);
    triggerMemoryTick();
    expect(getCurrentTier()).toBe("warning");
    expect(pollers.noneEnabled()).toBe(true);

    // Drop to normal (skip elevated).
    setMemoryUsage(0.20);
    triggerMemoryTick();

    expect(getCurrentTier()).toBe("normal");
    expect(pollers.allEnabled()).toBe(true);

    cbLoader.mockClear();
    vi.advanceTimersByTime(15_000);
    expect(cbLoader).toHaveBeenCalledTimes(3); // 15s / 5s

    pollers.disposeAll();
  });

  it("degradation state returns to normal after pressure clears", () => {
    startMemorySubsystem(0.2);

    const pollers = registerAllPollers(vi.fn(), vi.fn(), vi.fn());

    // Enter critical.
    setMemoryUsage(0.90);
    triggerMemoryTick();

    let state = getDegradationState();
    expect(state.isDegraded).toBe(true);
    expect(state.tier).toBe("critical");
    expect(state.disabledFeatures.size).toBe(5);

    // Clear pressure.
    setMemoryUsage(0.10);
    triggerMemoryTick();

    state = getDegradationState();
    expect(state.isDegraded).toBe(false);
    expect(state.tier).toBe("normal");
    expect(state.disabledFeatures.size).toBe(0);
    expect(state.summary).toBe("");

    pollers.disposeAll();
  });

  it("refresh throttle restores full concurrency when pressure clears", () => {
    startMemorySubsystem(0.2);

    // Enter critical.
    setMemoryUsage(0.90);
    triggerMemoryTick();
    expect(getQueueState().paused).toBe(true);
    expect(getQueueState().maxConcurrency).toBe(0);

    // Clear.
    setMemoryUsage(0.15);
    triggerMemoryTick();
    expect(getQueueState().paused).toBe(false);
    expect(getQueueState().maxConcurrency).toBe(3);
    expect(getRecommendedInterval()).toBe(5000);
  });

  it("degradation listeners fire correct events during recovery", () => {
    startMemorySubsystem(0.2);

    const pollers = registerAllPollers(vi.fn(), vi.fn(), vi.fn());
    const listener = vi.fn();
    const unsub = onDegradationChange(listener);

    // Enter pressure.
    setMemoryUsage(0.60);
    triggerMemoryTick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].tier).toBe("elevated");
    expect(
      listener.mock.calls[0][0].disabledFeatures.has("autoRefresh"),
    ).toBe(true);

    // Clear pressure.
    setMemoryUsage(0.15);
    triggerMemoryTick();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].tier).toBe("normal");
    expect(
      listener.mock.calls[1][0].disabledFeatures.has("autoRefresh"),
    ).toBe(false);
    expect(listener.mock.calls[1][0].disabledFeatures.size).toBe(0);

    unsub();
    pollers.disposeAll();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. No resource leaks during suspension/restart cycles
// ═════════════════════════════════════════════════════════════════════════════

describe("no resource leaks during suspension/restart cycles", () => {
  it("repeated memory pressure cycles produce no leaked timers", () => {
    startMemorySubsystem(0.2);

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();
    const pollers = registerAllPollers(cbStatus, cbLoader, cbExecution);

    // Run 20 pressure cycles: normal → elevated → normal.
    for (let i = 0; i < 20; i++) {
      setMemoryUsage(0.55);
      triggerMemoryTick();
      expect(pollers.noneEnabled()).toBe(true);

      setMemoryUsage(0.15);
      triggerMemoryTick();
      expect(pollers.allEnabled()).toBe(true);
    }

    // After all cycles, exactly one timer per poller should be active.
    cbStatus.mockClear();
    cbLoader.mockClear();
    cbExecution.mockClear();

    vi.advanceTimersByTime(10_000);
    expect(cbStatus).toHaveBeenCalledTimes(1); // not 20
    expect(cbLoader).toHaveBeenCalledTimes(2); // not 40
    expect(cbExecution).toHaveBeenCalledTimes(3); // not 60+

    pollers.disposeAll();
  });

  it("rapid oscillation around the threshold does not leak timers", () => {
    startMemorySubsystem(0.2);

    const callback = vi.fn();
    const pollers = registerAllPollers(callback, vi.fn(), vi.fn());

    // Rapid oscillation: 49% → 51% → 49% → 51% ...
    for (let i = 0; i < 50; i++) {
      setMemoryUsage(i % 2 === 0 ? 0.49 : 0.51);
      triggerMemoryTick();
    }

    // Final state: 51% → elevated → disabled.
    expect(pollers.status.isEnabled()).toBe(false);

    // Return to normal.
    setMemoryUsage(0.20);
    triggerMemoryTick();
    expect(pollers.status.isEnabled()).toBe(true);

    // Verify only one timer fires per interval.
    callback.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(callback).toHaveBeenCalledTimes(1); // one status fire at 10s

    pollers.disposeAll();
  });

  it("poller count remains stable through suspension cycles", () => {
    startMemorySubsystem(0.2);

    const pollers = registerAllPollers(vi.fn(), vi.fn(), vi.fn());

    // Track poller count through cycles.
    for (let i = 0; i < 10; i++) {
      setMemoryUsage(0.60);
      triggerMemoryTick();
      // When disabled, pollers are unregistered.
      expect(getPollerCount()).toBe(0);

      setMemoryUsage(0.15);
      triggerMemoryTick();
      // When re-enabled, pollers are re-registered.
      expect(getPollerCount()).toBe(3);
    }

    pollers.disposeAll();
  });

  it("degradation listener subscriptions do not accumulate", () => {
    startMemorySubsystem(0.2);

    const listener = vi.fn();
    const unsub = onDegradationChange(listener);

    // Many memory transitions.
    for (let i = 0; i < 10; i++) {
      setMemoryUsage(0.60);
      triggerMemoryTick();
      setMemoryUsage(0.15);
      triggerMemoryTick();
    }

    // Each transition fires the listener exactly once per direction.
    // 10 elevated + 10 normal = 20 calls.
    expect(listener).toHaveBeenCalledTimes(20);

    unsub();
  });

  it("dispose cleanly removes all poller state", () => {
    startMemorySubsystem(0.2);

    const cbStatus = vi.fn();
    const cbLoader = vi.fn();
    const cbExecution = vi.fn();
    const pollers = registerAllPollers(cbStatus, cbLoader, cbExecution);

    // Verify active.
    expect(getPollerCount()).toBe(3);

    // Dispose.
    pollers.disposeAll();

    // All pollers should be gone.
    expect(getPollerCount()).toBe(0);
    expect(isPollerActive(POLLER_KEYS.STATUS)).toBe(false);
    expect(isPollerActive(POLLER_KEYS.LOADER)).toBe(false);
    expect(isPollerActive(POLLER_KEYS.EXECUTION)).toBe(false);

    // No callbacks after dispose.
    cbStatus.mockClear();
    cbLoader.mockClear();
    cbExecution.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(cbStatus).not.toHaveBeenCalled();
    expect(cbLoader).not.toHaveBeenCalled();
    expect(cbExecution).not.toHaveBeenCalled();
  });

  it("suspension during active callback execution does not cause double fires", () => {
    startMemorySubsystem(0.2);

    let callCount = 0;
    const slowCallback = () => {
      callCount++;
    };

    const pollers = registerAllPollers(slowCallback, vi.fn(), vi.fn());

    // Let one status tick fire.
    vi.advanceTimersByTime(10_000);
    expect(callCount).toBe(1);

    // Immediately enter memory pressure.
    setMemoryUsage(0.60);
    triggerMemoryTick();

    // Let time pass — no additional fires.
    vi.advanceTimersByTime(60_000);
    expect(callCount).toBe(1); // still just 1

    // Recover and verify clean resumption.
    setMemoryUsage(0.15);
    triggerMemoryTick();

    vi.advanceTimersByTime(10_000);
    expect(callCount).toBe(2); // exactly one more fire

    pollers.disposeAll();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Multi-tier memory pressure transitions
// ═════════════════════════════════════════════════════════════════════════════

describe("multi-tier memory pressure transitions", () => {
  it("walks through all tiers ascending then descending", () => {
    startMemorySubsystem(0.2);

    const pollers = registerAllPollers(vi.fn(), vi.fn(), vi.fn());

    // Ascending: normal → elevated → warning → critical
    const ascending: Array<{ ratio: number; tier: string }> = [
      { ratio: 0.55, tier: "elevated" },
      { ratio: 0.75, tier: "warning" },
      { ratio: 0.90, tier: "critical" },
    ];

    for (const { ratio, tier } of ascending) {
      setMemoryUsage(ratio);
      triggerMemoryTick();
      expect(getCurrentTier()).toBe(tier);
      expect(pollers.noneEnabled()).toBe(true);
    }

    // Descending: critical → warning → elevated → normal
    const descending: Array<{
      ratio: number;
      tier: string;
      pollersEnabled: boolean;
    }> = [
      { ratio: 0.75, tier: "warning", pollersEnabled: false },
      { ratio: 0.55, tier: "elevated", pollersEnabled: false },
      { ratio: 0.20, tier: "normal", pollersEnabled: true },
    ];

    for (const { ratio, tier, pollersEnabled } of descending) {
      setMemoryUsage(ratio);
      triggerMemoryTick();
      expect(getCurrentTier()).toBe(tier);
      if (pollersEnabled) {
        expect(pollers.allEnabled()).toBe(true);
      } else {
        expect(pollers.noneEnabled()).toBe(true);
      }
    }

    pollers.disposeAll();
  });

  it("partial recovery (critical → elevated) keeps pollers suspended", () => {
    startMemorySubsystem(0.2);

    const cbLoader = vi.fn();
    const pollers = registerAllPollers(vi.fn(), cbLoader, vi.fn());

    // Critical.
    setMemoryUsage(0.90);
    triggerMemoryTick();
    expect(pollers.noneEnabled()).toBe(true);

    // Partial recovery to elevated — still above autoRefresh threshold.
    setMemoryUsage(0.55);
    triggerMemoryTick();
    expect(getCurrentTier()).toBe("elevated");
    expect(pollers.noneEnabled()).toBe(true);
    expect(isFeatureDisabled("autoRefresh")).toBe(true);

    // Verify no callbacks fire.
    cbLoader.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(cbLoader).not.toHaveBeenCalled();

    pollers.disposeAll();
  });

  it("memory oscillation between elevated and warning keeps pollers suspended", () => {
    startMemorySubsystem(0.2);

    const cbExecution = vi.fn();
    const pollers = registerAllPollers(vi.fn(), vi.fn(), cbExecution);

    // Oscillate between elevated and warning.
    for (let i = 0; i < 10; i++) {
      setMemoryUsage(0.55); // elevated
      triggerMemoryTick();
      expect(pollers.noneEnabled()).toBe(true);

      setMemoryUsage(0.75); // warning
      triggerMemoryTick();
      expect(pollers.noneEnabled()).toBe(true);
    }

    // Still no callbacks.
    cbExecution.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(cbExecution).not.toHaveBeenCalled();

    // Full recovery.
    setMemoryUsage(0.15);
    triggerMemoryTick();
    expect(pollers.allEnabled()).toBe(true);

    pollers.disposeAll();
  });

  it("refresh throttle tracks tier transitions accurately", () => {
    startMemorySubsystem(0.2);

    // Normal: interval 5s, concurrency 3
    expect(getRecommendedInterval()).toBe(5_000);
    expect(getQueueState().maxConcurrency).toBe(3);

    // Elevated: interval 10s, concurrency 2
    setMemoryUsage(0.55);
    triggerMemoryTick();
    expect(getRecommendedInterval()).toBe(10_000);
    expect(getQueueState().maxConcurrency).toBe(2);

    // Warning: interval 20s, concurrency 1
    setMemoryUsage(0.75);
    triggerMemoryTick();
    expect(getRecommendedInterval()).toBe(20_000);
    expect(getQueueState().maxConcurrency).toBe(1);

    // Critical: interval Infinity, concurrency 0
    setMemoryUsage(0.90);
    triggerMemoryTick();
    expect(getRecommendedInterval()).toBe(Infinity);
    expect(getQueueState().maxConcurrency).toBe(0);

    // Back to normal: interval 5s, concurrency 3
    setMemoryUsage(0.15);
    triggerMemoryTick();
    expect(getRecommendedInterval()).toBe(5_000);
    expect(getQueueState().maxConcurrency).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Combined memory pressure + tab visibility
// ═════════════════════════════════════════════════════════════════════════════

describe("memory pressure combined with tab visibility", () => {
  const RESUME_DEBOUNCE_MS = 100;

  function backgroundTab(): void {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  function foregroundTab(): void {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
  }

  it("both pressure sources active: pollers stay stopped until both clear", () => {
    startMemorySubsystem(0.2);

    const cbLoader = vi.fn();
    const pollers = registerAllPollers(vi.fn(), cbLoader, vi.fn());

    // Background tab + memory pressure.
    backgroundTab();
    setMemoryUsage(0.60);
    triggerMemoryTick();

    cbLoader.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(cbLoader).not.toHaveBeenCalled();

    // Foreground tab — still blocked by memory.
    foregroundTab();
    vi.advanceTimersByTime(30_000);
    expect(cbLoader).not.toHaveBeenCalled();

    // Clear memory — now polling resumes.
    setMemoryUsage(0.15);
    triggerMemoryTick();
    expect(pollers.allEnabled()).toBe(true);

    cbLoader.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(cbLoader).toHaveBeenCalledTimes(2); // 10s / 5s

    pollers.disposeAll();
  });

  it("memory clears while tab is backgrounded: pollers resume on foreground", () => {
    startMemorySubsystem(0.2);

    const cbExecution = vi.fn();
    const pollers = registerAllPollers(vi.fn(), vi.fn(), cbExecution);

    // Background + pressure.
    backgroundTab();
    setMemoryUsage(0.60);
    triggerMemoryTick();
    cbExecution.mockClear();

    // Memory clears while still backgrounded.
    setMemoryUsage(0.15);
    triggerMemoryTick();
    expect(pollers.allEnabled()).toBe(true);

    // Tab is still hidden — pollers re-registered but inactive.
    expect(isSuspended()).toBe(true);
    expect(isPollerActive(POLLER_KEYS.EXECUTION)).toBe(false);

    vi.advanceTimersByTime(30_000);
    expect(cbExecution).not.toHaveBeenCalled();

    // Foreground — pollers activate.
    foregroundTab();
    expect(isPollerActive(POLLER_KEYS.EXECUTION)).toBe(true);

    cbExecution.mockClear();
    vi.advanceTimersByTime(9_000);
    expect(cbExecution).toHaveBeenCalledTimes(3); // 9s / 3s

    pollers.disposeAll();
  });

  it("no leaks through combined pressure + visibility cycles", () => {
    startMemorySubsystem(0.2);

    const cbStatus = vi.fn();
    const pollers = registerAllPollers(cbStatus, vi.fn(), vi.fn());

    // 10 combined cycles.
    for (let i = 0; i < 10; i++) {
      // Memory pressure + background.
      setMemoryUsage(0.60);
      triggerMemoryTick();
      backgroundTab();
      vi.advanceTimersByTime(5_000);

      // Recovery: foreground + clear memory.
      foregroundTab();
      setMemoryUsage(0.15);
      triggerMemoryTick();
    }

    // Verify clean state: exactly one timer per poller.
    cbStatus.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(cbStatus).toHaveBeenCalledTimes(1);

    pollers.disposeAll();
  });
});
