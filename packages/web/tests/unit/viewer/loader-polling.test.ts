// @vitest-environment jsdom
/**
 * Integration tests for loader polling suspension on tab backgrounding.
 *
 * Verifies that the 5-second loader data-status polling (registered via
 * registerPoller with key "loader:data-status") is paused when the tab
 * becomes hidden and resumed when the tab becomes visible again.
 * State is preserved throughout.
 *
 * These tests exercise the full stack: tab-visibility → polling-manager → poller
 * lifecycle, using the same key and interval as the real loader module.
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

// ─── Constants (mirror loader.ts) ──────────────────────────────────────────

const LOADER_KEY = "loader:data-status";
const LOADER_INTERVAL_MS = 5000;

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

describe("loader polling suspension", () => {
  it("pauses 5s loader polling when tab visibility becomes hidden", () => {
    const pollForChanges = vi.fn();
    registerPoller(LOADER_KEY, pollForChanges, LOADER_INTERVAL_MS);

    // Confirm polling is active and fires.
    vi.advanceTimersByTime(5000);
    expect(pollForChanges).toHaveBeenCalledTimes(1);

    // Background the tab.
    simulateVisibilityChange("hidden");

    expect(isSuspended()).toBe(true);
    expect(isPollerActive(LOADER_KEY)).toBe(false);

    // Advance well past several polling intervals — no calls should fire.
    pollForChanges.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(pollForChanges).not.toHaveBeenCalled();
  });

  it("prevents loader API requests during background state", () => {
    const pollForChanges = vi.fn();
    registerPoller(LOADER_KEY, pollForChanges, LOADER_INTERVAL_MS);

    // Let a few polls fire to establish a baseline.
    vi.advanceTimersByTime(15_000);
    expect(pollForChanges).toHaveBeenCalledTimes(3); // 15s / 5s = 3

    // Background the tab.
    simulateVisibilityChange("hidden");
    pollForChanges.mockClear();

    // Simulate a long background period (5 minutes).
    vi.advanceTimersByTime(5 * 60 * 1000);

    // Zero additional calls during the entire background period.
    expect(pollForChanges).not.toHaveBeenCalled();
    expect(isPollerActive(LOADER_KEY)).toBe(false);
  });

  it("maintains loader state consistency during suspension", () => {
    const pollForChanges = vi.fn();
    registerPoller(LOADER_KEY, pollForChanges, LOADER_INTERVAL_MS);

    // The poller entry should remain registered (state preserved) even while
    // suspended — only the timer is cleared, not the registry entry.
    simulateVisibilityChange("hidden");

    const pollers = getRegisteredPollers();
    const entry = pollers.find((p) => p.key === LOADER_KEY);
    expect(entry).toBeDefined();
    expect(entry!.intervalMs).toBe(LOADER_INTERVAL_MS);
    expect(entry!.active).toBe(false); // timer cleared, but entry preserved
  });

  it("resumes loader polling when tab becomes visible", () => {
    const pollForChanges = vi.fn();
    registerPoller(LOADER_KEY, pollForChanges, LOADER_INTERVAL_MS);

    // Background the tab.
    simulateVisibilityChange("hidden");
    pollForChanges.mockClear();

    // Foreground the tab.
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS); // wait for debounce

    expect(isSuspended()).toBe(false);
    expect(isPollerActive(LOADER_KEY)).toBe(true);

    // Verify polling resumes at the original 5s interval.
    vi.advanceTimersByTime(15_000);
    expect(pollForChanges).toHaveBeenCalledTimes(3); // 15s / 5s = 3
  });

  it("preserves original 5s interval after suspend/resume cycle", () => {
    const pollForChanges = vi.fn();
    registerPoller(LOADER_KEY, pollForChanges, LOADER_INTERVAL_MS);

    // Baseline: confirm 5s interval.
    vi.advanceTimersByTime(10_000);
    expect(pollForChanges).toHaveBeenCalledTimes(2);

    // Suspend and resume.
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(60_000); // 1 minute hidden
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    pollForChanges.mockClear();

    // Verify the interval hasn't drifted.
    vi.advanceTimersByTime(5000);
    expect(pollForChanges).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(pollForChanges).toHaveBeenCalledTimes(2);
  });

  it("handles multiple suspend/resume cycles without leaking timers", () => {
    const pollForChanges = vi.fn();
    registerPoller(LOADER_KEY, pollForChanges, LOADER_INTERVAL_MS);

    // Perform 5 full suspend/resume cycles.
    for (let i = 0; i < 5; i++) {
      simulateVisibilityChange("hidden");
      vi.advanceTimersByTime(10_000);
      simulateVisibilityChange("visible");
      vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    }

    // After all cycles, only one timer should be active.
    pollForChanges.mockClear();
    vi.advanceTimersByTime(5000);
    expect(pollForChanges).toHaveBeenCalledTimes(1); // not 5
  });

  it("suspends immediately on hide but debounces resume on show", () => {
    const pollForChanges = vi.fn();
    registerPoller(LOADER_KEY, pollForChanges, LOADER_INTERVAL_MS);

    // Suspension is immediate.
    simulateVisibilityChange("hidden");
    expect(isPollerActive(LOADER_KEY)).toBe(false);

    // Resume is debounced — not immediate.
    simulateVisibilityChange("visible");
    expect(isPollerActive(LOADER_KEY)).toBe(false); // still inactive

    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    expect(isPollerActive(LOADER_KEY)).toBe(true); // now active
  });
});
