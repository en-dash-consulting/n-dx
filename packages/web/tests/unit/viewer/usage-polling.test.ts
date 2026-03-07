// @vitest-environment jsdom
/**
 * Integration tests for usage polling suspension on tab backgrounding.
 *
 * Verifies that the 10-second token usage polling (registered via usePolling
 * with key "token-usage") is paused when the tab becomes hidden and resumed
 * when the tab becomes visible again. Usage data state is preserved throughout.
 *
 * These tests exercise the full stack: tab-visibility → polling-manager → poller
 * lifecycle, using the same key and interval as the real token-usage component.
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
import {
  TOKEN_USAGE_POLL_KEY as TOKEN_USAGE_KEY,
  USAGE_POLL_INTERVAL_MS,
} from "../../../src/viewer/usage/constants.js";

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

describe("usage polling suspension", () => {
  it("pauses 10s usage polling when tab visibility becomes hidden", () => {
    const fetchData = vi.fn();
    registerPoller(TOKEN_USAGE_KEY, fetchData, USAGE_POLL_INTERVAL_MS);

    // Confirm polling is active and fires.
    vi.advanceTimersByTime(10_000);
    expect(fetchData).toHaveBeenCalledTimes(1);

    // Background the tab.
    simulateVisibilityChange("hidden");

    expect(isSuspended()).toBe(true);
    expect(isPollerActive(TOKEN_USAGE_KEY)).toBe(false);

    // Advance well past several polling intervals — no calls should fire.
    fetchData.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("stops usage API requests during background state", () => {
    const fetchData = vi.fn();
    registerPoller(TOKEN_USAGE_KEY, fetchData, USAGE_POLL_INTERVAL_MS);

    // Let a few polls fire to establish a baseline.
    vi.advanceTimersByTime(30_000);
    expect(fetchData).toHaveBeenCalledTimes(3); // 30s / 10s = 3

    // Background the tab.
    simulateVisibilityChange("hidden");
    fetchData.mockClear();

    // Simulate a long background period (5 minutes).
    vi.advanceTimersByTime(5 * 60 * 1000);

    // Zero additional calls during the entire background period.
    expect(fetchData).not.toHaveBeenCalled();
    expect(isPollerActive(TOKEN_USAGE_KEY)).toBe(false);
  });

  it("preserves usage data state during suspension period", () => {
    const fetchData = vi.fn();
    registerPoller(TOKEN_USAGE_KEY, fetchData, USAGE_POLL_INTERVAL_MS);

    // The poller entry should remain registered (state preserved) even while
    // suspended — only the timer is cleared, not the registry entry.
    simulateVisibilityChange("hidden");

    const pollers = getRegisteredPollers();
    const entry = pollers.find((p) => p.key === TOKEN_USAGE_KEY);
    expect(entry).toBeDefined();
    expect(entry!.intervalMs).toBe(USAGE_POLL_INTERVAL_MS);
    expect(entry!.active).toBe(false); // timer cleared, but entry preserved
  });

  it("resumes usage polling when tab becomes visible", () => {
    const fetchData = vi.fn();
    registerPoller(TOKEN_USAGE_KEY, fetchData, USAGE_POLL_INTERVAL_MS);

    // Background the tab.
    simulateVisibilityChange("hidden");
    fetchData.mockClear();

    // Foreground the tab.
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS); // wait for debounce

    expect(isSuspended()).toBe(false);
    expect(isPollerActive(TOKEN_USAGE_KEY)).toBe(true);

    // Verify polling resumes at the original 10s interval.
    vi.advanceTimersByTime(30_000);
    expect(fetchData).toHaveBeenCalledTimes(3); // 30s / 10s = 3
  });

  it("preserves original 10s interval after suspend/resume cycle", () => {
    const fetchData = vi.fn();
    registerPoller(TOKEN_USAGE_KEY, fetchData, USAGE_POLL_INTERVAL_MS);

    // Baseline: confirm 10s interval.
    vi.advanceTimersByTime(20_000);
    expect(fetchData).toHaveBeenCalledTimes(2);

    // Suspend and resume.
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(60_000); // 1 minute hidden
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    fetchData.mockClear();

    // Verify the interval hasn't drifted.
    vi.advanceTimersByTime(10_000);
    expect(fetchData).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    expect(fetchData).toHaveBeenCalledTimes(2);
  });

  it("handles multiple suspend/resume cycles without leaking timers", () => {
    const fetchData = vi.fn();
    registerPoller(TOKEN_USAGE_KEY, fetchData, USAGE_POLL_INTERVAL_MS);

    // Perform 5 full suspend/resume cycles.
    for (let i = 0; i < 5; i++) {
      simulateVisibilityChange("hidden");
      vi.advanceTimersByTime(20_000);
      simulateVisibilityChange("visible");
      vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    }

    // After all cycles, only one timer should be active.
    fetchData.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(fetchData).toHaveBeenCalledTimes(1); // not 5
  });

  it("suspends immediately on hide but debounces resume on show", () => {
    const fetchData = vi.fn();
    registerPoller(TOKEN_USAGE_KEY, fetchData, USAGE_POLL_INTERVAL_MS);

    // Suspension is immediate.
    simulateVisibilityChange("hidden");
    expect(isPollerActive(TOKEN_USAGE_KEY)).toBe(false);

    // Resume is debounced — not immediate.
    simulateVisibilityChange("visible");
    expect(isPollerActive(TOKEN_USAGE_KEY)).toBe(false); // still inactive

    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    expect(isPollerActive(TOKEN_USAGE_KEY)).toBe(true); // now active
  });
});
