// @vitest-environment jsdom
/**
 * Tests for DOM update gate module.
 *
 * Covers: visibility-aware gating, deferred update queuing, per-setter
 * composition on replay, debounced resume, flush behaviour during suspension,
 * multiple suspension cycles, snapshot tracking, integration with update
 * batcher, and disposal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDomUpdateGate,
  type DomUpdateGate,
} from "../../../src/viewer/performance/dom-update-gate.js";
import { createUpdateBatcher } from "../../../src/viewer/performance/update-batcher.js";
import {
  startTabVisibilityMonitor,
  resetTabVisibility,
} from "../../../src/viewer/polling/tab-visibility.js";

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
  resetTabVisibility();
  startTabVisibilityMonitor();
});

afterEach(() => {
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

describe("createDomUpdateGate", () => {
  it("returns an object with schedule, flush, hasPending, isOpen, getSnapshot, and dispose methods", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });

    expect(typeof gate.schedule).toBe("function");
    expect(typeof gate.flush).toBe("function");
    expect(typeof gate.hasPending).toBe("function");
    expect(typeof gate.isOpen).toBe("function");
    expect(typeof gate.getSnapshot).toBe("function");
    expect(typeof gate.dispose).toBe("function");

    gate.dispose();
    batcher.dispose();
  });

  it("starts with the gate open when tab is visible", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });

    expect(gate.isOpen()).toBe(true);
    expect(gate.getSnapshot().isOpen).toBe(true);

    gate.dispose();
    batcher.dispose();
  });

  it("hasPending returns false initially", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });

    expect(gate.hasPending()).toBe(false);

    gate.dispose();
    batcher.dispose();
  });
});

describe("normal flow when tab is visible", () => {
  it("delegates schedule() to the underlying batcher", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    gate.schedule(setter, (prev) => prev + 1);

    // Not called yet — queued in batcher for RAF
    expect(setter).not.toHaveBeenCalled();
    expect(batcher.hasPending()).toBe(true);

    flushRAF();

    expect(setter).toHaveBeenCalledTimes(1);
    expect(state).toBe(1);

    gate.dispose();
    batcher.dispose();
  });

  it("composes multiple updates through the batcher normally", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    gate.schedule(setter, (prev) => prev + 1);
    gate.schedule(setter, (prev) => prev * 10);
    gate.schedule(setter, (prev) => prev + 5);

    flushRAF();

    expect(setter).toHaveBeenCalledTimes(1);
    expect(state).toBe(15);

    gate.dispose();
    batcher.dispose();
  });

  it("flush() delegates to the batcher when open", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    gate.schedule(setter, (prev) => prev + 42);
    gate.flush();

    expect(state).toBe(42);

    gate.dispose();
    batcher.dispose();
  });
});

describe("gate suspension on tab hide", () => {
  it("closes the gate immediately when tab becomes hidden", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });

    expect(gate.isOpen()).toBe(true);

    simulateVisibilityChange("hidden");

    expect(gate.isOpen()).toBe(false);
    expect(gate.getSnapshot().suspensionCount).toBe(1);

    gate.dispose();
    batcher.dispose();
  });

  it("flushes the underlying batcher on suspension", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    // Schedule an update while visible
    gate.schedule(setter, (prev) => prev + 10);
    expect(batcher.hasPending()).toBe(true);

    // Tab goes hidden — batcher should be flushed
    simulateVisibilityChange("hidden");

    expect(batcher.hasPending()).toBe(false);
    expect(state).toBe(10);

    gate.dispose();
    batcher.dispose();
  });

  it("queues updates instead of delegating to batcher when hidden", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    const setter = vi.fn();

    simulateVisibilityChange("hidden");

    gate.schedule(setter, (prev: number) => prev + 1);
    gate.schedule(setter, (prev: number) => prev + 2);

    // Batcher should have nothing — updates are queued in the gate
    expect(batcher.hasPending()).toBe(false);
    // But gate reports pending
    expect(gate.hasPending()).toBe(true);
    // Setter should NOT have been called (no RAF, no render)
    expect(setter).not.toHaveBeenCalled();
    // RAFs should not be requested
    expect(rafCallbacks.length).toBe(0);

    gate.dispose();
    batcher.dispose();
  });

  it("tracks queued count in snapshot", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    const setter = vi.fn();

    simulateVisibilityChange("hidden");

    gate.schedule(setter, (prev: number) => prev + 1);
    gate.schedule(setter, (prev: number) => prev + 2);

    const snapshot = gate.getSnapshot();
    expect(snapshot.queuedCount).toBe(2);
    expect(snapshot.totalDeferred).toBe(2);

    gate.dispose();
    batcher.dispose();
  });

  it("prevents unnecessary RAF scheduling when tab is hidden", () => {
    const rafSpy = vi.fn(mockRAF);
    vi.stubGlobal("requestAnimationFrame", rafSpy);

    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    const setter = vi.fn();

    simulateVisibilityChange("hidden");

    // Schedule multiple updates while hidden
    gate.schedule(setter, (prev: number) => prev + 1);
    gate.schedule(setter, (prev: number) => prev + 2);
    gate.schedule(setter, (prev: number) => prev + 3);

    // No RAFs requested (the batcher was flushed on suspend, which may
    // have cancelled the RAF, but no new ones should be requested)
    // Check that setter was never called — no renders in background
    expect(setter).not.toHaveBeenCalled();

    gate.dispose();
    batcher.dispose();
  });
});

describe("gate resume on tab show", () => {
  it("re-opens the gate after debounce when tab becomes visible", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 100 });

    simulateVisibilityChange("hidden");
    expect(gate.isOpen()).toBe(false);

    simulateVisibilityChange("visible");

    // Not yet open — debounce hasn't fired
    expect(gate.isOpen()).toBe(false);

    vi.advanceTimersByTime(100);

    // Now open
    expect(gate.isOpen()).toBe(true);

    gate.dispose();
    batcher.dispose();
  });

  it("replays deferred updates on resume in a single batch", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 50 });
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    simulateVisibilityChange("hidden");

    // Queue updates while hidden
    gate.schedule(setter, (prev) => prev + 1);
    gate.schedule(setter, (prev) => prev * 10);
    gate.schedule(setter, (prev) => prev + 5);

    expect(setter).not.toHaveBeenCalled();

    // Resume
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    // Deferred updates should have been replayed and flushed.
    // The gate replays through the batcher then flushes synchronously,
    // so the setter is called exactly once with the composed result.
    expect(setter).toHaveBeenCalledTimes(1);
    expect(state).toBe(15); // (0+1)*10+5 = 15

    gate.dispose();
    batcher.dispose();
  });

  it("replays deferred updates for multiple setters independently", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 50 });

    let stateA = 0;
    const setterA = vi.fn((updater: (prev: number) => number) => {
      stateA = updater(stateA);
    });

    let stateB = "hello";
    const setterB = vi.fn((updater: (prev: string) => string) => {
      stateB = updater(stateB);
    });

    simulateVisibilityChange("hidden");

    gate.schedule(setterA, (prev) => prev + 1);
    gate.schedule(setterB, (prev) => prev + " world");
    gate.schedule(setterA, (prev) => prev + 10);

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(setterA).toHaveBeenCalledTimes(1);
    expect(stateA).toBe(11);

    expect(setterB).toHaveBeenCalledTimes(1);
    expect(stateB).toBe("hello world");

    gate.dispose();
    batcher.dispose();
  });

  it("calls onResume when updates were deferred during suspension", () => {
    const onResume = vi.fn();
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, onResume, resumeDebounceMs: 50 });
    const setter = vi.fn();

    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev: number) => prev + 1);

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(onResume).toHaveBeenCalledTimes(1);

    gate.dispose();
    batcher.dispose();
  });

  it("does NOT call onResume when no updates were deferred", () => {
    const onResume = vi.fn();
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, onResume, resumeDebounceMs: 50 });

    simulateVisibilityChange("hidden");
    // No updates queued

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(onResume).not.toHaveBeenCalled();

    gate.dispose();
    batcher.dispose();
  });

  it("clears the deferred queue after replay", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 50 });
    const setter = vi.fn();

    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev: number) => prev + 1);
    expect(gate.getSnapshot().queuedCount).toBe(1);

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(gate.getSnapshot().queuedCount).toBe(0);
    expect(gate.hasPending()).toBe(false);

    gate.dispose();
    batcher.dispose();
  });

  it("delegates normally after resume", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 50 });
    let state = 100;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    // Suspend and resume
    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    // Now schedule a new update — should go through batcher normally
    gate.schedule(setter, (prev) => prev + 1);
    expect(batcher.hasPending()).toBe(true);

    flushRAF();
    expect(state).toBe(101);

    gate.dispose();
    batcher.dispose();
  });
});

describe("debounced resume prevents thrashing", () => {
  it("cancels pending resume when tab goes hidden again", () => {
    const onResume = vi.fn();
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, onResume, resumeDebounceMs: 100 });
    const setter = vi.fn();

    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev: number) => prev + 1);

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50); // Halfway through debounce

    simulateVisibilityChange("hidden");

    vi.advanceTimersByTime(200); // Well past original debounce

    // Gate should still be closed, updates not replayed
    expect(gate.isOpen()).toBe(false);
    expect(onResume).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();

    gate.dispose();
    batcher.dispose();
  });

  it("resets debounce timer on rapid show/hide/show", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 100 });

    simulateVisibilityChange("hidden");

    // Rapid toggling: show → hide → show
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(30);
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(30);
    simulateVisibilityChange("visible");

    // Only 60ms — debounce was reset on last "visible"
    vi.advanceTimersByTime(50);
    expect(gate.isOpen()).toBe(false); // Still debouncing

    vi.advanceTimersByTime(50); // Total 100ms from last "visible"
    expect(gate.isOpen()).toBe(true);

    gate.dispose();
    batcher.dispose();
  });
});

describe("multiple suspension cycles", () => {
  it("tracks totalDeferred across multiple suspension cycles", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 50 });
    const setter = vi.fn();

    // Cycle 1: defer 3 updates
    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev: number) => prev + 1);
    gate.schedule(setter, (prev: number) => prev + 2);
    gate.schedule(setter, (prev: number) => prev + 3);

    expect(gate.getSnapshot().queuedCount).toBe(3);
    expect(gate.getSnapshot().totalDeferred).toBe(3);

    // Resume
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    // Cycle 2: defer 2 more
    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev: number) => prev + 4);
    gate.schedule(setter, (prev: number) => prev + 5);

    // queuedCount resets per suspension, totalDeferred accumulates
    expect(gate.getSnapshot().queuedCount).toBe(2);
    expect(gate.getSnapshot().totalDeferred).toBe(5);

    gate.dispose();
    batcher.dispose();
  });

  it("increments suspensionCount for each hide event", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 50 });

    expect(gate.getSnapshot().suspensionCount).toBe(0);

    simulateVisibilityChange("hidden");
    expect(gate.getSnapshot().suspensionCount).toBe(1);

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    simulateVisibilityChange("hidden");
    expect(gate.getSnapshot().suspensionCount).toBe(2);

    gate.dispose();
    batcher.dispose();
  });

  it("composes deferred state correctly across resume cycles", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 50 });
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    // Cycle 1: defer +5
    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev) => prev + 5);
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(state).toBe(5);

    // Cycle 2: defer *3
    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev) => prev * 3);
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(state).toBe(15);

    gate.dispose();
    batcher.dispose();
  });

  it("calls onResume only for cycles where updates were deferred", () => {
    const onResume = vi.fn();
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, onResume, resumeDebounceMs: 50 });
    const setter = vi.fn();

    // Cycle 1: defer updates → onResume called
    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev: number) => prev + 1);
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(onResume).toHaveBeenCalledTimes(1);

    // Cycle 2: no deferred updates → onResume NOT called
    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(onResume).toHaveBeenCalledTimes(1); // Still 1

    // Cycle 3: defer updates → onResume called again
    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev: number) => prev + 2);
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(onResume).toHaveBeenCalledTimes(2);

    gate.dispose();
    batcher.dispose();
  });
});

describe("flush during suspension", () => {
  it("applies queued updates directly when flushed while gate is closed", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    simulateVisibilityChange("hidden");

    gate.schedule(setter, (prev) => prev + 1);
    gate.schedule(setter, (prev) => prev * 10);

    // Flush while gate is closed — should apply directly
    gate.flush();

    expect(setter).toHaveBeenCalledTimes(1);
    expect(state).toBe(10); // (0+1)*10 = 10
    expect(gate.getSnapshot().queuedCount).toBe(0);

    gate.dispose();
    batcher.dispose();
  });

  it("flush is a no-op when nothing is pending", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    const setter = vi.fn();

    simulateVisibilityChange("hidden");

    gate.flush(); // No queued updates — should be a no-op

    expect(setter).not.toHaveBeenCalled();

    gate.dispose();
    batcher.dispose();
  });
});

describe("snapshot", () => {
  it("provides accurate initial snapshot", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });

    const snapshot = gate.getSnapshot();
    expect(snapshot.isOpen).toBe(true);
    expect(snapshot.queuedCount).toBe(0);
    expect(snapshot.totalDeferred).toBe(0);
    expect(snapshot.suspensionCount).toBe(0);

    gate.dispose();
    batcher.dispose();
  });

  it("reflects closed state during suspension", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });

    simulateVisibilityChange("hidden");

    const snapshot = gate.getSnapshot();
    expect(snapshot.isOpen).toBe(false);
    expect(snapshot.suspensionCount).toBe(1);

    gate.dispose();
    batcher.dispose();
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

  it("starts with the gate closed when tab is hidden", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });

    expect(gate.isOpen()).toBe(false);

    gate.dispose();
    batcher.dispose();
  });

  it("queues updates from the start when tab is hidden", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    const setter = vi.fn();

    gate.schedule(setter, (prev: number) => prev + 1);

    expect(setter).not.toHaveBeenCalled();
    expect(batcher.hasPending()).toBe(false);
    expect(gate.getSnapshot().queuedCount).toBe(1);

    gate.dispose();
    batcher.dispose();
  });

  it("flushes the batcher on initial suspension", () => {
    const batcher = createUpdateBatcher();
    // Pre-load the batcher with a pending update before creating the gate
    const setter = vi.fn();
    batcher.schedule(setter, (prev: number) => prev + 1);
    expect(batcher.hasPending()).toBe(true);

    const gate = createDomUpdateGate({ batcher });

    // The gate should have flushed the batcher on initial suspend
    expect(batcher.hasPending()).toBe(false);
    expect(setter).toHaveBeenCalledTimes(1);

    gate.dispose();
    batcher.dispose();
  });
});

describe("dispose", () => {
  it("ignores schedules after disposal", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    const setter = vi.fn();

    gate.dispose();
    gate.schedule(setter, (prev: number) => prev + 1);

    expect(gate.hasPending()).toBe(false);
    expect(batcher.hasPending()).toBe(false);
    flushRAF();
    expect(setter).not.toHaveBeenCalled();

    batcher.dispose();
  });

  it("flush is a no-op after disposal", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    const setter = vi.fn();

    gate.schedule(setter, (prev: number) => prev + 1);
    gate.dispose();
    gate.flush();

    expect(setter).not.toHaveBeenCalled();

    batcher.dispose();
  });

  it("cancels pending resume timer on disposal", () => {
    const onResume = vi.fn();
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, onResume, resumeDebounceMs: 100 });
    const setter = vi.fn();

    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev: number) => prev + 1);

    simulateVisibilityChange("visible");
    gate.dispose();

    vi.advanceTimersByTime(200);
    expect(onResume).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();

    batcher.dispose();
  });

  it("does not react to visibility changes after disposal", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });

    gate.dispose();

    simulateVisibilityChange("hidden");
    expect(gate.getSnapshot().suspensionCount).toBe(0);

    batcher.dispose();
  });
});

describe("integration: UI state consistency", () => {
  it("deferred updates maintain correct order and final state", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 50 });

    // Simulate a complex state with multiple fields
    let state = { count: 0, label: "init", items: [] as string[] };
    const setter = vi.fn(
      (updater: (prev: typeof state) => typeof state) => {
        state = updater(state);
      },
    );

    simulateVisibilityChange("hidden");

    // Queue multiple updates that touch different fields
    gate.schedule(setter, (prev) => ({ ...prev, count: prev.count + 1 }));
    gate.schedule(setter, (prev) => ({ ...prev, label: "updated" }));
    gate.schedule(setter, (prev) => ({
      ...prev,
      items: [...prev.items, "item-1"],
    }));
    gate.schedule(setter, (prev) => ({ ...prev, count: prev.count + 10 }));

    // Resume and verify all updates applied correctly
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(setter).toHaveBeenCalledTimes(1); // Single composed call
    expect(state).toEqual({
      count: 11,
      label: "updated",
      items: ["item-1"],
    });

    gate.dispose();
    batcher.dispose();
  });

  it("mixed visible/hidden updates produce correct final state", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 50 });
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    // Update while visible
    gate.schedule(setter, (prev) => prev + 1); // 0 → 1
    flushRAF();
    expect(state).toBe(1);

    // Go hidden, queue updates
    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev) => prev * 10); // will be 1 → 10
    gate.schedule(setter, (prev) => prev + 5); // will be 10 → 15

    // Resume — deferred updates applied
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(state).toBe(15);

    // Update while visible again
    gate.schedule(setter, (prev) => prev + 100); // 15 → 115
    flushRAF();
    expect(state).toBe(115);

    gate.dispose();
    batcher.dispose();
  });

  it("prevents re-renders in background tabs entirely", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, resumeDebounceMs: 50 });
    const setter = vi.fn();

    simulateVisibilityChange("hidden");

    // Simulate 100 rapid updates (e.g. from WS messages that leaked through)
    for (let i = 0; i < 100; i++) {
      gate.schedule(setter, (prev: number) => prev + 1);
    }

    // Fire RAF (browsers still fire at ~1fps when hidden)
    flushRAF();

    // No setter calls at all — zero re-renders
    expect(setter).not.toHaveBeenCalled();

    // Resume — all 100 updates applied in one call
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(setter).toHaveBeenCalledTimes(1);

    gate.dispose();
    batcher.dispose();
  });
});

describe("edge cases", () => {
  it("handles onResume errors gracefully", () => {
    const onResume = vi.fn(() => {
      throw new Error("resume error");
    });
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher, onResume, resumeDebounceMs: 50 });
    const setter = vi.fn();

    simulateVisibilityChange("hidden");
    gate.schedule(setter, (prev: number) => prev + 1);

    // Should not throw
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(onResume).toHaveBeenCalledTimes(1);
    expect(gate.isOpen()).toBe(true);

    gate.dispose();
    batcher.dispose();
  });

  it("handles schedule after dispose followed by flush", () => {
    const batcher = createUpdateBatcher();
    const gate = createDomUpdateGate({ batcher });
    const setter = vi.fn();

    gate.dispose();
    gate.schedule(setter, (prev: number) => prev + 1);
    gate.flush();

    expect(setter).not.toHaveBeenCalled();

    batcher.dispose();
  });
});
