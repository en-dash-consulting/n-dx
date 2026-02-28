// @vitest-environment jsdom
/**
 * Tests for the tick visibility gate.
 *
 * Covers: suspension on tab hide, debounced resume on tab show, immediate
 * catch-up tick, snapshot tracking, disposal, rapid toggling, starting
 * with hidden tab, and integration with tick timer + batched dispatcher.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTickVisibilityGate,
  type TickVisibilityGate,
} from "../../../src/viewer/tick-visibility-gate.js";
import {
  onTick,
  getTickTimerState,
  resetTickTimer,
} from "../../../src/viewer/tick-timer.js";
import {
  resetBatchedTickDispatcher,
  registerTickUpdater,
  getBatchedTickDispatcherState,
} from "../../../src/viewer/batched-tick-dispatcher.js";
import {
  startTabVisibilityMonitor,
  resetTabVisibility,
} from "../../../src/viewer/tab-visibility.js";

// ─── RAF mock ─────────────────────────────────────────────────────────────────

let rafCallbacks: Array<(time: number) => void> = [];
let rafIdCounter = 0;

function mockRAF(cb: (time: number) => void): number {
  rafCallbacks.push(cb);
  return ++rafIdCounter;
}

function mockCancelRAF(_id: number): void {
  // For simplicity, clear all pending (tests use single RAF at a time)
}

/** Fire all pending RAF callbacks, simulating one animation frame. */
function flushRAF(): void {
  const cbs = rafCallbacks;
  rafCallbacks = [];
  for (const cb of cbs) {
    cb(performance.now());
  }
}

// ─── Visibility helpers ────────────────────────────────────────────────────────

let originalVisibilityState: string;

function simulateVisibilityChange(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  rafCallbacks = [];
  rafIdCounter = 0;
  vi.stubGlobal("requestAnimationFrame", mockRAF);
  vi.stubGlobal("cancelAnimationFrame", mockCancelRAF);
  originalVisibilityState = document.visibilityState;
  // Default to visible for consistent test behavior
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    writable: true,
    configurable: true,
  });
  resetBatchedTickDispatcher();
  resetTickTimer();
  resetTabVisibility();
  startTabVisibilityMonitor();
});

afterEach(() => {
  resetBatchedTickDispatcher();
  resetTickTimer();
  resetTabVisibility();
  Object.defineProperty(document, "visibilityState", {
    value: originalVisibilityState,
    writable: true,
    configurable: true,
  });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createTickVisibilityGate", () => {
  it("returns an object with isRunning, getSnapshot, and dispose methods", () => {
    const gate = createTickVisibilityGate();

    expect(typeof gate.isRunning).toBe("function");
    expect(typeof gate.getSnapshot).toBe("function");
    expect(typeof gate.dispose).toBe("function");

    gate.dispose();
  });

  it("starts with the timer running when tab is visible", () => {
    const gate = createTickVisibilityGate();

    expect(gate.isRunning()).toBe(true);
    expect(gate.getSnapshot().isRunning).toBe(true);
    expect(gate.getSnapshot().suspensionCount).toBe(0);

    gate.dispose();
  });
});

describe("timer pauses when tab becomes hidden", () => {
  it("suspends the tick timer immediately when tab is hidden", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);
    const gate = createTickVisibilityGate();

    expect(getTickTimerState().running).toBe(true);

    simulateVisibilityChange("hidden");

    expect(getTickTimerState().running).toBe(false);
    expect(gate.isRunning()).toBe(false);

    gate.dispose();
    unsub();
  });

  it("prevents ticks from firing while tab is hidden", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);
    const gate = createTickVisibilityGate();

    // Verify tick fires normally
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);

    // Hide tab
    simulateVisibilityChange("hidden");
    listener.mockClear();

    // Advance time — no ticks should fire
    vi.advanceTimersByTime(5000);
    expect(listener).not.toHaveBeenCalled();

    gate.dispose();
    unsub();
  });

  it("increments suspensionCount on each hide", () => {
    const gate = createTickVisibilityGate({ resumeDebounceMs: 50 });

    simulateVisibilityChange("hidden");
    expect(gate.getSnapshot().suspensionCount).toBe(1);

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    simulateVisibilityChange("hidden");
    expect(gate.getSnapshot().suspensionCount).toBe(2);

    gate.dispose();
  });

  it("calls onSuspend callback when timer is suspended", () => {
    const onSuspend = vi.fn();
    const gate = createTickVisibilityGate({ onSuspend });

    simulateVisibilityChange("hidden");

    expect(onSuspend).toHaveBeenCalledTimes(1);

    gate.dispose();
  });

  it("handles onSuspend errors gracefully", () => {
    const onSuspend = vi.fn(() => { throw new Error("suspend error"); });
    const gate = createTickVisibilityGate({ onSuspend });

    // Should not throw
    simulateVisibilityChange("hidden");

    expect(onSuspend).toHaveBeenCalledTimes(1);
    expect(gate.isRunning()).toBe(false);

    gate.dispose();
  });
});

describe("timer resumes when tab becomes visible", () => {
  it("resumes the tick timer after debounce when tab becomes visible", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);
    const gate = createTickVisibilityGate({ resumeDebounceMs: 100 });

    simulateVisibilityChange("hidden");
    expect(getTickTimerState().running).toBe(false);

    simulateVisibilityChange("visible");

    // Not yet resumed — debounce hasn't fired
    expect(gate.isRunning()).toBe(false);

    vi.advanceTimersByTime(100);

    // Now resumed
    expect(gate.isRunning()).toBe(true);
    expect(getTickTimerState().running).toBe(true);

    gate.dispose();
    unsub();
  });

  it("calls onResume callback after debounce", () => {
    const onResume = vi.fn();
    const gate = createTickVisibilityGate({ onResume, resumeDebounceMs: 50 });

    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");

    expect(onResume).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(onResume).toHaveBeenCalledTimes(1);

    gate.dispose();
  });

  it("handles onResume errors gracefully", () => {
    const onResume = vi.fn(() => { throw new Error("resume error"); });
    const gate = createTickVisibilityGate({ onResume, resumeDebounceMs: 50 });

    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(onResume).toHaveBeenCalledTimes(1);
    expect(gate.isRunning()).toBe(true);

    gate.dispose();
  });

  it("increments resumeCount on each resume", () => {
    const gate = createTickVisibilityGate({ resumeDebounceMs: 50 });

    expect(gate.getSnapshot().resumeCount).toBe(0);

    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(gate.getSnapshot().resumeCount).toBe(1);

    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(gate.getSnapshot().resumeCount).toBe(2);

    gate.dispose();
  });
});

describe("elapsed time catches up correctly on resume", () => {
  it("fires an immediate tick on resume for catch-up", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);
    const gate = createTickVisibilityGate({ resumeDebounceMs: 50 });

    // Hide the tab
    simulateVisibilityChange("hidden");
    listener.mockClear();

    // Advance time significantly while hidden
    vi.advanceTimersByTime(30000);
    expect(listener).not.toHaveBeenCalled();

    // Resume
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50); // debounce fires

    // Immediate tick should have fired on resume
    expect(listener).toHaveBeenCalledTimes(1);

    gate.dispose();
    unsub();
  });

  it("catches up elapsed time display via batched dispatcher on resume", () => {
    let counter = 0;
    const setter = vi.fn();
    const ref = { current: "" };

    const unreg = registerTickUpdater(
      () => `${counter++}s`,
      setter,
      ref,
    );

    const gate = createTickVisibilityGate({ resumeDebounceMs: 50 });

    // First tick while visible — "0s"
    vi.advanceTimersByTime(1000);
    flushRAF();
    expect(setter).toHaveBeenCalledWith("0s");

    // Hide tab
    simulateVisibilityChange("hidden");
    setter.mockClear();

    // Advance time while hidden — no ticks fire
    vi.advanceTimersByTime(60000);
    expect(setter).not.toHaveBeenCalled();

    // Resume — immediate catch-up tick fires
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    // The catch-up tick computed "1s" (counter incremented)
    // and batched it into RAF
    expect(getBatchedTickDispatcherState().hasPendingRAF).toBe(true);

    flushRAF();
    expect(setter).toHaveBeenCalledTimes(1);
    expect(setter).toHaveBeenCalledWith("1s");

    gate.dispose();
    unreg();
  });

  it("resumes regular 1-second ticking after catch-up", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);
    const gate = createTickVisibilityGate({ resumeDebounceMs: 50 });

    // Hide and resume
    simulateVisibilityChange("hidden");
    listener.mockClear();
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    // Immediate catch-up tick
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();

    // Regular ticks should resume at 1-second intervals
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(2);

    gate.dispose();
    unsub();
  });
});

describe("debounced resume prevents thrashing", () => {
  it("cancels pending resume when tab goes hidden again", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);
    const gate = createTickVisibilityGate({ resumeDebounceMs: 100 });

    simulateVisibilityChange("hidden");
    listener.mockClear();

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50); // Halfway through debounce

    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(200); // Well past original debounce

    // Timer should still be suspended
    expect(gate.isRunning()).toBe(false);
    expect(getTickTimerState().running).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    gate.dispose();
    unsub();
  });

  it("resets debounce timer on rapid show/hide/show", () => {
    const gate = createTickVisibilityGate({ resumeDebounceMs: 100 });

    simulateVisibilityChange("hidden");

    // Rapid toggling: show → hide → show
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(30);
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(30);
    simulateVisibilityChange("visible");

    // Only 60ms — debounce was reset on last "visible"
    vi.advanceTimersByTime(50);
    expect(gate.isRunning()).toBe(false); // Still debouncing

    vi.advanceTimersByTime(50); // Total 100ms from last "visible"
    expect(gate.isRunning()).toBe(true);

    gate.dispose();
  });

  it("uses default 100ms debounce when not configured", () => {
    const gate = createTickVisibilityGate();

    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");

    vi.advanceTimersByTime(99);
    expect(gate.isRunning()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(gate.isRunning()).toBe(true);

    gate.dispose();
  });
});

describe("starting with hidden tab", () => {
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    resetTabVisibility();
    startTabVisibilityMonitor();
  });

  it("starts in suspended state when tab is already hidden", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);

    const gate = createTickVisibilityGate();

    expect(gate.isRunning()).toBe(false);
    expect(gate.getSnapshot().suspensionCount).toBe(1);
    expect(getTickTimerState().running).toBe(false);

    // Advance time — no ticks should fire
    vi.advanceTimersByTime(5000);
    expect(listener).not.toHaveBeenCalled();

    gate.dispose();
    unsub();
  });

  it("resumes correctly when tab becomes visible for the first time", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);

    const gate = createTickVisibilityGate({ resumeDebounceMs: 50 });

    expect(gate.isRunning()).toBe(false);

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(gate.isRunning()).toBe(true);
    // Immediate catch-up tick should have fired
    expect(listener).toHaveBeenCalledTimes(1);

    gate.dispose();
    unsub();
  });
});

describe("multiple suspension cycles", () => {
  it("suspends and resumes correctly across multiple cycles", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);
    const gate = createTickVisibilityGate({ resumeDebounceMs: 50 });

    // Cycle 1
    simulateVisibilityChange("hidden");
    listener.mockClear();
    vi.advanceTimersByTime(3000);
    expect(listener).not.toHaveBeenCalled();

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(listener).toHaveBeenCalledTimes(1); // catch-up tick

    // Regular ticking
    listener.mockClear();
    vi.advanceTimersByTime(2000);
    expect(listener).toHaveBeenCalledTimes(2);

    // Cycle 2
    simulateVisibilityChange("hidden");
    listener.mockClear();
    vi.advanceTimersByTime(10000);
    expect(listener).not.toHaveBeenCalled();

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(listener).toHaveBeenCalledTimes(1); // catch-up tick

    expect(gate.getSnapshot().suspensionCount).toBe(2);
    expect(gate.getSnapshot().resumeCount).toBe(2);

    gate.dispose();
    unsub();
  });
});

describe("snapshot", () => {
  it("provides accurate initial snapshot", () => {
    const gate = createTickVisibilityGate();

    const snapshot = gate.getSnapshot();
    expect(snapshot.isRunning).toBe(true);
    expect(snapshot.suspensionCount).toBe(0);
    expect(snapshot.resumeCount).toBe(0);
    expect(snapshot.disposed).toBe(false);

    gate.dispose();
  });

  it("reflects suspended state after hide", () => {
    const gate = createTickVisibilityGate();

    simulateVisibilityChange("hidden");

    const snapshot = gate.getSnapshot();
    expect(snapshot.isRunning).toBe(false);
    expect(snapshot.suspensionCount).toBe(1);

    gate.dispose();
  });

  it("reflects disposed state after dispose", () => {
    const gate = createTickVisibilityGate();
    gate.dispose();

    expect(gate.getSnapshot().disposed).toBe(true);
  });
});

describe("dispose", () => {
  it("does not react to visibility changes after disposal", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);
    const gate = createTickVisibilityGate();

    gate.dispose();

    simulateVisibilityChange("hidden");
    expect(gate.getSnapshot().suspensionCount).toBe(0);
    expect(getTickTimerState().running).toBe(true); // Timer unaffected

    unsub();
  });

  it("cancels pending resume timer on disposal", () => {
    const onResume = vi.fn();
    const gate = createTickVisibilityGate({ onResume, resumeDebounceMs: 100 });

    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");

    gate.dispose();

    vi.advanceTimersByTime(200);
    expect(onResume).not.toHaveBeenCalled();
  });

  it("is safe to call multiple times", () => {
    const gate = createTickVisibilityGate();

    gate.dispose();
    gate.dispose(); // should not throw

    expect(gate.getSnapshot().disposed).toBe(true);
  });
});

describe("no subscribers edge case", () => {
  it("handles suspend/resume when tick timer has no subscribers", () => {
    const gate = createTickVisibilityGate({ resumeDebounceMs: 50 });

    // No subscribers — timer shouldn't be running
    expect(getTickTimerState().subscriberCount).toBe(0);

    simulateVisibilityChange("hidden");
    expect(gate.isRunning()).toBe(false);

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(gate.isRunning()).toBe(true);

    // Timer still not running because no subscribers (correct — auto-lifecycle)
    expect(getTickTimerState().running).toBe(false);

    gate.dispose();
  });
});
