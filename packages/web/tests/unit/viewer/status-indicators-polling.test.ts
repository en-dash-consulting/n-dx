// @vitest-environment jsdom
/**
 * Integration tests for status indicators polling suspension on tab backgrounding.
 *
 * Verifies that the 10-second status indicators polling (registered via usePolling
 * with key "status-indicators") is paused when the tab becomes hidden and resumed
 * when the tab becomes visible again. State is preserved throughout.
 *
 * These tests exercise the full stack: tab-visibility → polling-manager → poller
 * lifecycle, using the same key and interval as the real status-indicators component.
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
  setDocumentVisibility,
  simulateVisibilityChange,
} from "../../helpers/visibility-test-support.js";

// ─── Constants (mirror status-indicators.ts) ─────────────────────────────────

const STATUS_INDICATORS_KEY = "status-indicators";
const STATUS_POLL_INTERVAL_MS = 10_000;

/** Debounce delay used by the polling manager when the tab becomes visible. */
const RESUME_DEBOUNCE_MS = 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

let originalVisibilityState: string;

beforeEach(() => {
  originalVisibilityState = document.visibilityState;
  setDocumentVisibility("visible");
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
  setDocumentVisibility(originalVisibilityState);
});

// ─── Acceptance criteria ──────────────────────────────────────────────────────

describe("status indicators polling suspension", () => {
  it("pauses 10s status polling when tab visibility becomes hidden", () => {
    const refresh = vi.fn();
    registerPoller(STATUS_INDICATORS_KEY, refresh, STATUS_POLL_INTERVAL_MS);

    // Confirm polling is active and fires.
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Background the tab.
    simulateVisibilityChange("hidden");

    expect(isSuspended()).toBe(true);
    expect(isPollerActive(STATUS_INDICATORS_KEY)).toBe(false);

    // Advance well past several polling intervals — no calls should fire.
    refresh.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops status API requests during background state", () => {
    const refresh = vi.fn();
    registerPoller(STATUS_INDICATORS_KEY, refresh, STATUS_POLL_INTERVAL_MS);

    // Let a few polls fire to establish a baseline.
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(3); // 30s / 10s = 3

    // Background the tab.
    simulateVisibilityChange("hidden");
    refresh.mockClear();

    // Simulate a long background period (5 minutes).
    vi.advanceTimersByTime(5 * 60 * 1000);

    // Zero additional calls during the entire background period.
    expect(refresh).not.toHaveBeenCalled();
    expect(isPollerActive(STATUS_INDICATORS_KEY)).toBe(false);
  });

  it("maintains status consistency during suspension", () => {
    const refresh = vi.fn();
    registerPoller(STATUS_INDICATORS_KEY, refresh, STATUS_POLL_INTERVAL_MS);

    // The poller entry should remain registered (state preserved) even while
    // suspended — only the timer is cleared, not the registry entry.
    simulateVisibilityChange("hidden");

    const pollers = getRegisteredPollers();
    const entry = pollers.find((p) => p.key === STATUS_INDICATORS_KEY);
    expect(entry).toBeDefined();
    expect(entry!.intervalMs).toBe(STATUS_POLL_INTERVAL_MS);
    expect(entry!.active).toBe(false); // timer cleared, but entry preserved
  });

  it("resumes status polling when tab becomes visible", () => {
    const refresh = vi.fn();
    registerPoller(STATUS_INDICATORS_KEY, refresh, STATUS_POLL_INTERVAL_MS);

    // Background the tab.
    simulateVisibilityChange("hidden");
    refresh.mockClear();

    // Foreground the tab.
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS); // wait for debounce

    expect(isSuspended()).toBe(false);
    expect(isPollerActive(STATUS_INDICATORS_KEY)).toBe(true);

    // Verify polling resumes at the original 10s interval.
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(3); // 30s / 10s = 3
  });

  it("preserves original 10s interval after suspend/resume cycle", () => {
    const refresh = vi.fn();
    registerPoller(STATUS_INDICATORS_KEY, refresh, STATUS_POLL_INTERVAL_MS);

    // Baseline: confirm 10s interval.
    vi.advanceTimersByTime(20_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    // Suspend and resume.
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(60_000); // 1 minute hidden
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    refresh.mockClear();

    // Verify the interval hasn't drifted.
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("handles multiple suspend/resume cycles without leaking timers", () => {
    const refresh = vi.fn();
    registerPoller(STATUS_INDICATORS_KEY, refresh, STATUS_POLL_INTERVAL_MS);

    // Perform 5 full suspend/resume cycles.
    for (let i = 0; i < 5; i++) {
      simulateVisibilityChange("hidden");
      vi.advanceTimersByTime(20_000);
      simulateVisibilityChange("visible");
      vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    }

    // After all cycles, only one timer should be active.
    refresh.mockClear();
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1); // not 5
  });

  it("suspends immediately on hide but debounces resume on show", () => {
    const refresh = vi.fn();
    registerPoller(STATUS_INDICATORS_KEY, refresh, STATUS_POLL_INTERVAL_MS);

    // Suspension is immediate.
    simulateVisibilityChange("hidden");
    expect(isPollerActive(STATUS_INDICATORS_KEY)).toBe(false);

    // Resume is debounced — not immediate.
    simulateVisibilityChange("visible");
    expect(isPollerActive(STATUS_INDICATORS_KEY)).toBe(false); // still inactive

    vi.advanceTimersByTime(RESUME_DEBOUNCE_MS);
    expect(isPollerActive(STATUS_INDICATORS_KEY)).toBe(true); // now active
  });
});
