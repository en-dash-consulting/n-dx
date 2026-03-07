// @vitest-environment jsdom
/**
 * Tests for the centralized polling manager with tab visibility integration.
 *
 * Covers: poller registration/unregistration, suspend/resume lifecycle,
 * tab visibility integration, rapid visibility change debouncing,
 * poller replacement, state inspection, and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startPollingManager,
  stopPollingManager,
  registerPoller,
  unregisterPoller,
  suspendAll,
  resumeAll,
  isSuspended,
  isPollerActive,
  getRegisteredPollers,
  getPollerCount,
  resetPollingManager,
} from "../../../src/viewer/polling/polling-manager.js";
import {
  startTabVisibilityMonitor,
  resetTabVisibility,
} from "../../../src/viewer/polling/tab-visibility.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simulate a visibility state change by setting the property and dispatching the event. */
function simulateVisibilityChange(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

let originalVisibilityState: string;

beforeEach(() => {
  originalVisibilityState = document.visibilityState;
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    writable: true,
    configurable: true,
  });
  vi.useFakeTimers();
  resetTabVisibility();
  resetPollingManager();
});

afterEach(() => {
  resetPollingManager();
  resetTabVisibility();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    value: originalVisibilityState,
    writable: true,
    configurable: true,
  });
});

// ─── Registration ─────────────────────────────────────────────────────────────

describe("poller registration", () => {
  it("registers a poller and starts its timer", () => {
    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    expect(getPollerCount()).toBe(1);
    expect(isPollerActive("test")).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("returns an unregister function", () => {
    const callback = vi.fn();
    const unregister = registerPoller("test", callback, 1000);

    unregister();
    expect(getPollerCount()).toBe(0);
    expect(isPollerActive("test")).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("replaces existing poller with the same key", () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    registerPoller("test", callback1, 1000);
    registerPoller("test", callback2, 2000);

    expect(getPollerCount()).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
  });

  it("supports multiple pollers with different keys", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    registerPoller("fast", cb1, 1000);
    registerPoller("medium", cb2, 3000);
    registerPoller("slow", cb3, 5000);

    expect(getPollerCount()).toBe(3);

    vi.advanceTimersByTime(5000);
    expect(cb1).toHaveBeenCalledTimes(5);
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb3).toHaveBeenCalledTimes(1);
  });
});

// ─── Unregistration ──────────────────────────────────────────────────────────

describe("poller unregistration", () => {
  it("removes poller and stops its timer", () => {
    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    unregisterPoller("test");

    expect(getPollerCount()).toBe(0);
    expect(isPollerActive("test")).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("is safe to call with a non-existent key", () => {
    expect(() => unregisterPoller("non-existent")).not.toThrow();
  });

  it("is safe to call twice for the same key", () => {
    registerPoller("test", vi.fn(), 1000);
    unregisterPoller("test");
    expect(() => unregisterPoller("test")).not.toThrow();
  });
});

// ─── Suspend / Resume ────────────────────────────────────────────────────────

describe("suspendAll / resumeAll", () => {
  it("suspendAll stops all active timers", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    registerPoller("a", cb1, 1000);
    registerPoller("b", cb2, 2000);

    suspendAll();

    expect(isSuspended()).toBe(true);
    expect(isPollerActive("a")).toBe(false);
    expect(isPollerActive("b")).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
  });

  it("resumeAll restarts all timers with original intervals", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    registerPoller("fast", cb1, 1000);
    registerPoller("slow", cb2, 3000);

    suspendAll();
    vi.advanceTimersByTime(10_000);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();

    resumeAll();

    expect(isSuspended()).toBe(false);
    expect(isPollerActive("fast")).toBe(true);
    expect(isPollerActive("slow")).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(cb1).toHaveBeenCalledTimes(3);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("pollers registered during suspension stay inactive until resume", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    suspendAll();

    const callback = vi.fn();
    registerPoller("late", callback, 1000);

    // Should not be active because manager is suspended.
    expect(isPollerActive("late")).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();

    resumeAll();

    vi.advanceTimersByTime(3000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("suspendAll is idempotent", () => {
    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    suspendAll();
    suspendAll();
    suspendAll();

    expect(isSuspended()).toBe(true);

    resumeAll();
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("resumeAll is idempotent", () => {
    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    suspendAll();
    resumeAll();
    resumeAll();
    resumeAll();

    vi.advanceTimersByTime(1000);
    // Should only have 1 timer active, not 3.
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

// ─── Tab visibility integration ──────────────────────────────────────────────

describe("tab visibility integration", () => {
  it("suspends pollers when tab becomes hidden", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    vi.advanceTimersByTime(2000);
    expect(callback).toHaveBeenCalledTimes(2);

    simulateVisibilityChange("hidden");
    callback.mockClear();

    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
    expect(isSuspended()).toBe(true);
  });

  it("resumes pollers when tab becomes visible (after debounce)", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    simulateVisibilityChange("hidden");
    callback.mockClear();

    simulateVisibilityChange("visible");

    // Resume is debounced — pollers should not fire immediately.
    vi.advanceTimersByTime(50);
    expect(callback).not.toHaveBeenCalled();

    // After debounce completes, pollers should be active.
    vi.advanceTimersByTime(50); // Total: 100ms debounce
    expect(isSuspended()).toBe(false);

    // Now advance time for the poller's interval.
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("preserves original intervals after resume", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    const cb5s = vi.fn();
    const cb3s = vi.fn();
    const cb10s = vi.fn();

    registerPoller("loader", cb5s, 5000);
    registerPoller("execution", cb3s, 3000);
    registerPoller("dashboard", cb10s, 10_000);

    // Suspend and resume.
    simulateVisibilityChange("hidden");
    cb5s.mockClear();
    cb3s.mockClear();
    cb10s.mockClear();

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(100); // debounce

    // Verify intervals are restored correctly.
    vi.advanceTimersByTime(10_000);

    expect(cb5s).toHaveBeenCalledTimes(2); // 10s / 5s = 2
    expect(cb3s).toHaveBeenCalledTimes(3); // 10s / 3s = 3 (floor)
    expect(cb10s).toHaveBeenCalledTimes(1); // 10s / 10s = 1
  });

  it("resumes all four standard intervals (5s, 3s, 10s, 10s)", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    const cbLoader = vi.fn();
    const cbExecution = vi.fn();
    const cbDashboard = vi.fn();
    const cbStatus = vi.fn();

    registerPoller("loader", cbLoader, 5000);
    registerPoller("execution", cbExecution, 3000);
    registerPoller("dashboard", cbDashboard, 10_000);
    registerPoller("status", cbStatus, 10_000);

    // All should be active.
    expect(isPollerActive("loader")).toBe(true);
    expect(isPollerActive("execution")).toBe(true);
    expect(isPollerActive("dashboard")).toBe(true);
    expect(isPollerActive("status")).toBe(true);

    // Suspend.
    simulateVisibilityChange("hidden");

    expect(isPollerActive("loader")).toBe(false);
    expect(isPollerActive("execution")).toBe(false);
    expect(isPollerActive("dashboard")).toBe(false);
    expect(isPollerActive("status")).toBe(false);

    // Resume.
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(100); // debounce

    expect(isPollerActive("loader")).toBe(true);
    expect(isPollerActive("execution")).toBe(true);
    expect(isPollerActive("dashboard")).toBe(true);
    expect(isPollerActive("status")).toBe(true);

    // Verify each fires at its original interval.
    vi.advanceTimersByTime(30_000);

    expect(cbLoader).toHaveBeenCalledTimes(6);     // 30s / 5s
    expect(cbExecution).toHaveBeenCalledTimes(10);  // 30s / 3s
    expect(cbDashboard).toHaveBeenCalledTimes(3);   // 30s / 10s
    expect(cbStatus).toHaveBeenCalledTimes(3);      // 30s / 10s
  });
});

// ─── Rapid visibility changes ────────────────────────────────────────────────

describe("rapid visibility changes", () => {
  it("debounces rapid show/hide toggles", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    // Rapid toggling: hidden → visible → hidden → visible → hidden → visible
    simulateVisibilityChange("hidden");
    callback.mockClear();

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50); // halfway through debounce
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(50);
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(50);
    simulateVisibilityChange("visible");

    // The last change was to visible, but debounce hasn't completed yet.
    vi.advanceTimersByTime(100); // complete the debounce

    // Now pollers should be active.
    expect(isSuspended()).toBe(false);
    expect(isPollerActive("test")).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("handles hidden → visible → hidden before debounce completes", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    simulateVisibilityChange("hidden");
    callback.mockClear();

    // Start resuming...
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50); // debounce in progress

    // ...but go hidden again before it completes.
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(200); // well past debounce time

    // Should remain suspended because the last state was hidden.
    expect(isSuspended()).toBe(true);
    expect(isPollerActive("test")).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not create duplicate timers after rapid toggles", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    // Multiple suspend/resume cycles
    for (let i = 0; i < 10; i++) {
      simulateVisibilityChange("hidden");
      simulateVisibilityChange("visible");
      vi.advanceTimersByTime(100); // complete debounce
    }

    callback.mockClear();
    vi.advanceTimersByTime(1000);

    // Should only fire once per interval, not 10 times.
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

// ─── Manager lifecycle ───────────────────────────────────────────────────────

describe("polling manager lifecycle", () => {
  it("starts in non-suspended state when tab is visible", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    expect(isSuspended()).toBe(false);
  });

  it("starts in suspended state when tab is hidden", () => {
    startTabVisibilityMonitor();
    simulateVisibilityChange("hidden");

    startPollingManager();

    expect(isSuspended()).toBe(true);
  });

  it("stopPollingManager disconnects from visibility events", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    stopPollingManager();

    // Visibility changes should have no effect.
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(5000);

    // Poller was registered before stop, and stop doesn't clear pollers.
    // It should still be ticking because stop doesn't deactivate pollers.
    expect(callback).toHaveBeenCalled();
  });

  it("resetPollingManager clears everything", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    const callback = vi.fn();
    registerPoller("a", callback, 1000);
    registerPoller("b", callback, 2000);

    resetPollingManager();

    expect(getPollerCount()).toBe(0);
    expect(isSuspended()).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });
});

// ─── State inspection ────────────────────────────────────────────────────────

describe("state inspection", () => {
  it("getRegisteredPollers returns correct info", () => {
    registerPoller("fast", vi.fn(), 1000);
    registerPoller("slow", vi.fn(), 5000);

    const pollers = getRegisteredPollers();
    expect(pollers).toHaveLength(2);

    const fast = pollers.find((p) => p.key === "fast");
    const slow = pollers.find((p) => p.key === "slow");

    expect(fast).toEqual({ key: "fast", intervalMs: 1000, active: true });
    expect(slow).toEqual({ key: "slow", intervalMs: 5000, active: true });
  });

  it("getRegisteredPollers reflects suspended state", () => {
    registerPoller("test", vi.fn(), 1000);

    suspendAll();
    const pollers = getRegisteredPollers();
    expect(pollers[0].active).toBe(false);

    resumeAll();
    const resumedPollers = getRegisteredPollers();
    expect(resumedPollers[0].active).toBe(true);
  });

  it("getPollerCount tracks additions and removals", () => {
    expect(getPollerCount()).toBe(0);

    registerPoller("a", vi.fn(), 1000);
    expect(getPollerCount()).toBe(1);

    registerPoller("b", vi.fn(), 2000);
    expect(getPollerCount()).toBe(2);

    unregisterPoller("a");
    expect(getPollerCount()).toBe(1);

    unregisterPoller("b");
    expect(getPollerCount()).toBe(0);
  });

  it("isPollerActive returns false for unknown keys", () => {
    expect(isPollerActive("non-existent")).toBe(false);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("works without starting the manager (unmanaged mode)", () => {
    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    vi.advanceTimersByTime(3000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("handles registering and immediately unregistering", () => {
    const callback = vi.fn();
    const unregister = registerPoller("test", callback, 100);
    unregister();

    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
    expect(getPollerCount()).toBe(0);
  });

  it("handles very short interval pollers gracefully", () => {
    const callback = vi.fn();
    registerPoller("short", callback, 50);

    vi.advanceTimersByTime(200);
    expect(callback).toHaveBeenCalledTimes(4);

    unregisterPoller("short");
  });

  it("handles async callbacks without errors", () => {
    const callback = vi.fn(async () => {
      await Promise.resolve();
    });

    registerPoller("async", callback, 1000);

    vi.advanceTimersByTime(3000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("resume after manager restart works", () => {
    startTabVisibilityMonitor();
    startPollingManager();

    const callback = vi.fn();
    registerPoller("test", callback, 1000);

    stopPollingManager();
    startPollingManager();

    simulateVisibilityChange("hidden");
    callback.mockClear();

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(100); // debounce

    vi.advanceTimersByTime(3000);
    expect(callback).toHaveBeenCalledTimes(3);
  });
});
