// @vitest-environment jsdom
/**
 * Integration tests for execution panel polling suspension on tab backgrounding.
 *
 * Verifies that the 3-second execution panel polling (registered via usePolling
 * with key "execution-panel") is paused when the tab becomes hidden and resumed
 * when the tab becomes visible again. State is preserved throughout.
 *
 * These tests exercise the full stack: tab-visibility → polling-manager → poller
 * lifecycle, using the same key and interval as the real execution panel component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startPollingManager,
  registerPoller,
  isSuspended,
  isPollerActive,
  getRegisteredPollers,
  resetPollingManager,
} from "../../../src/viewer/polling/polling-manager.js";
import {
  startTabVisibilityMonitor,
  resetTabVisibility,
} from "../../../src/viewer/polling/tab-visibility.js";

// ─── Constants (mirror execution-panel.ts) ────────────────────────────────────

const EXECUTION_PANEL_KEY = "execution-panel";
const EXECUTION_PANEL_INTERVAL_MS = 3000;

/** Debounce delay used by the polling manager when the tab becomes visible. */
const RESUME_DEBOUNCE_MS = 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate a visibility state change by setting the property and dispatching the event. */
function simulateVisibilityChange(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

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
  startTabVisibilityMonitor();
  startPollingManager();
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

// ─── Acceptance criteria ──────────────────────────────────────────────────────

describe("execution panel polling suspension", () => {
  it("pauses 3s execution panel polling when tab becomes hidden", () => {
    const fetchStatus = vi.fn();
    registerPoller(EXECUTION_PANEL_KEY, fetchStatus, EXECUTION_PANEL_INTERVAL_MS);

    // Confirm polling is active and fires.
    vi.advanceTimersByTime(3000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    // Background the tab.
    simulateVisibilityChange("hidden");

    expect(isSuspended()).toBe(true);
    expect(isPollerActive(EXECUTION_PANEL_KEY)).toBe(false);

    // Advance well past several polling intervals — no calls should fire.
    fetchStatus.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it("stops execution status API requests during background state", () => {
    const fetchStatus = vi.fn();
    registerPoller(EXECUTION_PANEL_KEY, fetchStatus, EXECUTION_PANEL_INTERVAL_MS);

    // Let a few polls fire to establish a baseline.
    vi.advanceTimersByTime(9000);
    expect(fetchStatus).toHaveBeenCalledTimes(3); // 9s / 3s = 3

    // Background the tab.
    simulateVisibilityChange("hidden");
    fetchStatus.mockClear();

    // Simulate a long background period (5 minutes).
    vi.advanceTimersByTime(5 * 60 * 1000);

    // Zero additional calls during the entire background period.
    expect(fetchStatus).not.toHaveBeenCalled();
    expect(isPollerActive(EXECUTION_PANEL_KEY)).toBe(false);
  });

  it("preserves execution panel state during suspension period", () => {
    const fetchStatus = vi.fn();
    registerPoller(EXECUTION_PANEL_KEY, fetchStatus, EXECUTION_PANEL_INTERVAL_MS);

    // The poller entry should remain registered (state preserved) even while
    // suspended — only the timer is cleared, not the registry entry.
    simulateVisibilityChange("hidden");

    const pollers = getRegisteredPollers();
    const entry = pollers.find((p) => p.key === EXECUTION_PANEL_KEY);
    expect(entry).toBeDefined();
    expect(entry!.intervalMs).toBe(EXECUTION_PANEL_INTERVAL_MS);
    expect(entry!.active).toBe(false); // timer cleared, but entry preserved
  });

  it("resumes execution panel polling when tab becomes visible", () => {
    const fetchStatus = vi.fn();
    registerPoller(EXECUTION_PANEL_KEY, fetchStatus, EXECUTION_PANEL_INTERVAL_MS);

    // Background the tab.
    simulateVisibilityChange("hidden");
    fetchStatus.mockClear();

    // Foreground the tab.
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS); // wait for debounce

    expect(isSuspended()).toBe(false);
    expect(isPollerActive(EXECUTION_PANEL_KEY)).toBe(true);

    // Verify polling resumes at the original 3s interval.
    vi.advanceTimersByTime(9000);
    expect(fetchStatus).toHaveBeenCalledTimes(3); // 9s / 3s = 3
  });

  it("preserves original 3s interval after suspend/resume cycle", () => {
    const fetchStatus = vi.fn();
    registerPoller(EXECUTION_PANEL_KEY, fetchStatus, EXECUTION_PANEL_INTERVAL_MS);

    // Baseline: confirm 3s interval.
    vi.advanceTimersByTime(6000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);

    // Suspend and resume.
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(60_000); // 1 minute hidden
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    fetchStatus.mockClear();

    // Verify the interval hasn't drifted.
    vi.advanceTimersByTime(3000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("handles multiple suspend/resume cycles without leaking timers", () => {
    const fetchStatus = vi.fn();
    registerPoller(EXECUTION_PANEL_KEY, fetchStatus, EXECUTION_PANEL_INTERVAL_MS);

    // Perform 5 full suspend/resume cycles.
    for (let i = 0; i < 5; i++) {
      simulateVisibilityChange("hidden");
      vi.advanceTimersByTime(10_000);
      simulateVisibilityChange("visible");
      vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    }

    // After all cycles, only one timer should be active.
    fetchStatus.mockClear();
    vi.advanceTimersByTime(3000);
    expect(fetchStatus).toHaveBeenCalledTimes(1); // not 5
  });

  it("suspends immediately on hide but debounces resume on show", () => {
    const fetchStatus = vi.fn();
    registerPoller(EXECUTION_PANEL_KEY, fetchStatus, EXECUTION_PANEL_INTERVAL_MS);

    // Suspension is immediate.
    simulateVisibilityChange("hidden");
    expect(isPollerActive(EXECUTION_PANEL_KEY)).toBe(false);

    // Resume is debounced — not immediate.
    simulateVisibilityChange("visible");
    expect(isPollerActive(EXECUTION_PANEL_KEY)).toBe(false); // still inactive

    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    expect(isPollerActive(EXECUTION_PANEL_KEY)).toBe(true); // now active
  });
});
