/**
 * Tests for the batched tick dispatcher.
 *
 * Covers: registration lifecycle, auto-start/stop, RAF batching,
 * equality skipping, compute error resilience, flush, reset,
 * and high-registration-count scenarios.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerTickUpdater,
  getBatchedTickDispatcherState,
  flushBatchedTicks,
  resetBatchedTickDispatcher,
} from "../../../src/viewer/polling/batched-tick-dispatcher.js";
import { resetTickTimer } from "../../../src/viewer/polling/tick-timer.js";

// ─── RAF mock ────────────────────────────────────────────────────────────────

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

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  rafCallbacks = [];
  rafIdCounter = 0;
  vi.stubGlobal("requestAnimationFrame", mockRAF);
  vi.stubGlobal("cancelAnimationFrame", mockCancelRAF);
  resetBatchedTickDispatcher();
  resetTickTimer();
});

afterEach(() => {
  resetBatchedTickDispatcher();
  resetTickTimer();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── Initial state ───────────────────────────────────────────────────────────

describe("initial state", () => {
  it("starts with zero registrations and no pending RAF", () => {
    const state = getBatchedTickDispatcherState();
    expect(state.registrationCount).toBe(0);
    expect(state.hasPendingRAF).toBe(false);
    expect(state.pendingUpdateCount).toBe(0);
  });
});

// ─── Registration lifecycle ──────────────────────────────────────────────────

describe("registration lifecycle", () => {
  it("increments registration count on register", () => {
    const unregister = registerTickUpdater(
      () => "0s",
      vi.fn(),
      { current: "" },
    );
    expect(getBatchedTickDispatcherState().registrationCount).toBe(1);
    unregister();
  });

  it("decrements registration count on unregister", () => {
    const unregister = registerTickUpdater(
      () => "0s",
      vi.fn(),
      { current: "" },
    );
    expect(getBatchedTickDispatcherState().registrationCount).toBe(1);
    unregister();
    expect(getBatchedTickDispatcherState().registrationCount).toBe(0);
  });

  it("tracks multiple registrations independently", () => {
    const unreg1 = registerTickUpdater(() => "1s", vi.fn(), { current: "" });
    const unreg2 = registerTickUpdater(() => "2s", vi.fn(), { current: "" });
    const unreg3 = registerTickUpdater(() => "3s", vi.fn(), { current: "" });
    expect(getBatchedTickDispatcherState().registrationCount).toBe(3);

    unreg2();
    expect(getBatchedTickDispatcherState().registrationCount).toBe(2);

    unreg1();
    unreg3();
    expect(getBatchedTickDispatcherState().registrationCount).toBe(0);
  });

  it("returns an unregister function", () => {
    const unregister = registerTickUpdater(
      () => "0s",
      vi.fn(),
      { current: "" },
    );
    expect(typeof unregister).toBe("function");
    unregister();
  });

  it("double-unregister is a no-op", () => {
    const unregister = registerTickUpdater(
      () => "0s",
      vi.fn(),
      { current: "" },
    );
    unregister();
    unregister(); // should not throw or go negative
    expect(getBatchedTickDispatcherState().registrationCount).toBe(0);
  });
});

// ─── Auto-start / auto-stop (tick timer subscription) ────────────────────────

describe("auto-start and auto-stop", () => {
  it("subscribes to tick timer on first registration", () => {
    const setter = vi.fn();
    const unreg = registerTickUpdater(() => "1s", setter, { current: "" });

    // Tick should trigger computation
    vi.advanceTimersByTime(1000);
    // Value changed ("" → "1s"), so RAF should be pending
    expect(getBatchedTickDispatcherState().hasPendingRAF).toBe(true);

    flushRAF();
    expect(setter).toHaveBeenCalledWith("1s");

    unreg();
  });

  it("unsubscribes from tick timer when last registration removed", () => {
    const setter1 = vi.fn();
    const setter2 = vi.fn();
    const unreg1 = registerTickUpdater(() => "1s", setter1, { current: "" });
    const unreg2 = registerTickUpdater(() => "2s", setter2, { current: "" });

    unreg1();
    // Still one registration — tick should still work
    vi.advanceTimersByTime(1000);
    expect(getBatchedTickDispatcherState().hasPendingRAF).toBe(true);
    flushRAF();
    expect(setter2).toHaveBeenCalledWith("2s");

    unreg2();
    // All removed — tick should no longer trigger
    setter2.mockClear();
    vi.advanceTimersByTime(1000);
    expect(getBatchedTickDispatcherState().hasPendingRAF).toBe(false);
    expect(setter2).not.toHaveBeenCalled();
  });

  it("re-subscribes when a new registration joins after all left", () => {
    const setter1 = vi.fn();
    const unreg1 = registerTickUpdater(() => "1s", setter1, { current: "" });
    unreg1();

    const setter2 = vi.fn();
    const unreg2 = registerTickUpdater(() => "2s", setter2, { current: "" });

    vi.advanceTimersByTime(1000);
    flushRAF();
    expect(setter2).toHaveBeenCalledWith("2s");

    unreg2();
  });
});

// ─── RAF batching ────────────────────────────────────────────────────────────

describe("RAF batching", () => {
  it("does not call setters synchronously on tick — defers to RAF", () => {
    const setter = vi.fn();
    const unreg = registerTickUpdater(() => "1s", setter, { current: "" });

    vi.advanceTimersByTime(1000);

    // Setter NOT called yet — pending in RAF queue
    expect(setter).not.toHaveBeenCalled();
    expect(getBatchedTickDispatcherState().hasPendingRAF).toBe(true);

    flushRAF();
    expect(setter).toHaveBeenCalledTimes(1);

    unreg();
  });

  it("batches multiple registrations into a single RAF", () => {
    const rafSpy = vi.fn(mockRAF);
    vi.stubGlobal("requestAnimationFrame", rafSpy);

    const setters = Array.from({ length: 5 }, () => vi.fn());
    const unregs = setters.map((setter, i) =>
      registerTickUpdater(() => `${i}s`, setter, { current: "" }),
    );

    vi.advanceTimersByTime(1000);

    // Only one RAF requested despite 5 registrations
    expect(rafSpy).toHaveBeenCalledTimes(1);

    flushRAF();

    // All 5 setters called within the same RAF
    for (let i = 0; i < 5; i++) {
      expect(setters[i]).toHaveBeenCalledTimes(1);
      expect(setters[i]).toHaveBeenCalledWith(`${i}s`);
    }

    for (const unreg of unregs) unreg();
  });

  it("applies all setters synchronously within RAF callback", () => {
    // Verify ordering: all setters are called before RAF returns
    const callOrder: string[] = [];

    const setter1 = vi.fn(() => callOrder.push("setter1"));
    const setter2 = vi.fn(() => callOrder.push("setter2"));
    const setter3 = vi.fn(() => callOrder.push("setter3"));

    const unreg1 = registerTickUpdater(() => "a", setter1, { current: "" });
    const unreg2 = registerTickUpdater(() => "b", setter2, { current: "" });
    const unreg3 = registerTickUpdater(() => "c", setter3, { current: "" });

    vi.advanceTimersByTime(1000);
    flushRAF();

    // All called in registration order
    expect(callOrder).toEqual(["setter1", "setter2", "setter3"]);

    unreg1();
    unreg2();
    unreg3();
  });

  it("clears pending state after RAF fires", () => {
    const unreg = registerTickUpdater(() => "1s", vi.fn(), { current: "" });

    vi.advanceTimersByTime(1000);
    expect(getBatchedTickDispatcherState().hasPendingRAF).toBe(true);
    expect(getBatchedTickDispatcherState().pendingUpdateCount).toBe(1);

    flushRAF();
    expect(getBatchedTickDispatcherState().hasPendingRAF).toBe(false);
    expect(getBatchedTickDispatcherState().pendingUpdateCount).toBe(0);

    unreg();
  });
});

// ─── Equality skipping ──────────────────────────────────────────────────────

describe("equality skipping", () => {
  it("skips setter when computed value matches lastValueRef", () => {
    const setter = vi.fn();
    const unreg = registerTickUpdater(() => "5m 30s", setter, {
      current: "5m 30s",
    });

    vi.advanceTimersByTime(1000);

    // Value unchanged — no RAF should be scheduled
    expect(getBatchedTickDispatcherState().hasPendingRAF).toBe(false);
    expect(setter).not.toHaveBeenCalled();

    unreg();
  });

  it("calls setter only when value actually changes", () => {
    let counter = 0;
    const setter = vi.fn();
    const ref = { current: "" };

    const unreg = registerTickUpdater(() => `${counter++}s`, setter, ref);

    // Tick 1: "" → "0s" (changed)
    vi.advanceTimersByTime(1000);
    flushRAF();
    expect(setter).toHaveBeenCalledTimes(1);
    expect(setter).toHaveBeenCalledWith("0s");

    // Tick 2: "0s" → "1s" (changed)
    vi.advanceTimersByTime(1000);
    flushRAF();
    expect(setter).toHaveBeenCalledTimes(2);
    expect(setter).toHaveBeenCalledWith("1s");

    unreg();
  });

  it("updates lastValueRef immediately on tick (not on RAF)", () => {
    const ref = { current: "" };
    const unreg = registerTickUpdater(() => "1s", vi.fn(), ref);

    vi.advanceTimersByTime(1000);

    // lastValueRef should be updated even before RAF fires
    expect(ref.current).toBe("1s");

    flushRAF();

    unreg();
  });

  it("skips individual registrations with unchanged values while updating others", () => {
    const setter1 = vi.fn();
    const setter2 = vi.fn();

    let value1 = "constant";
    let value2Counter = 0;

    const unreg1 = registerTickUpdater(
      () => value1,
      setter1,
      { current: "constant" },
    );
    const unreg2 = registerTickUpdater(
      () => `${value2Counter++}s`,
      setter2,
      { current: "" },
    );

    vi.advanceTimersByTime(1000);
    flushRAF();

    // setter1 NOT called (value unchanged), setter2 called
    expect(setter1).not.toHaveBeenCalled();
    expect(setter2).toHaveBeenCalledTimes(1);

    unreg1();
    unreg2();
  });
});

// ─── Compute error resilience ────────────────────────────────────────────────

describe("compute error resilience", () => {
  it("continues processing if one compute function throws", () => {
    const goodSetter = vi.fn();
    const badSetter = vi.fn();

    const unreg1 = registerTickUpdater(
      () => {
        throw new Error("boom");
      },
      badSetter,
      { current: "" },
    );
    const unreg2 = registerTickUpdater(
      () => "good",
      goodSetter,
      { current: "" },
    );

    vi.advanceTimersByTime(1000);
    flushRAF();

    // Bad compute didn't break good one
    expect(badSetter).not.toHaveBeenCalled();
    expect(goodSetter).toHaveBeenCalledWith("good");

    unreg1();
    unreg2();
  });

  it("continues processing if one setter throws", () => {
    const callOrder: string[] = [];

    const unreg1 = registerTickUpdater(
      () => "a",
      () => {
        callOrder.push("setter1");
        throw new Error("setter boom");
      },
      { current: "" },
    );
    const unreg2 = registerTickUpdater(
      () => "b",
      () => callOrder.push("setter2"),
      { current: "" },
    );

    vi.advanceTimersByTime(1000);
    flushRAF();

    // Both setters called, setter1 error didn't prevent setter2
    expect(callOrder).toEqual(["setter1", "setter2"]);

    unreg1();
    unreg2();
  });
});

// ─── Single tick subscription ────────────────────────────────────────────────

describe("single tick subscription", () => {
  it("subscribes to onTick only once regardless of registration count", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const initialCallCount = setIntervalSpy.mock.calls.length;

    const unregs = Array.from({ length: 10 }, (_, i) =>
      registerTickUpdater(() => `${i}s`, vi.fn(), { current: "" }),
    );

    // Only one setInterval should have been created (by tick-timer via
    // the dispatcher's single onTick subscription)
    expect(setIntervalSpy.mock.calls.length - initialCallCount).toBe(1);

    for (const unreg of unregs) unreg();
    setIntervalSpy.mockRestore();
  });
});

// ─── Flush ───────────────────────────────────────────────────────────────────

describe("flushBatchedTicks", () => {
  it("applies pending updates synchronously", () => {
    const setter = vi.fn();
    const unreg = registerTickUpdater(() => "1s", setter, { current: "" });

    vi.advanceTimersByTime(1000);
    expect(setter).not.toHaveBeenCalled();

    flushBatchedTicks();

    expect(setter).toHaveBeenCalledTimes(1);
    expect(setter).toHaveBeenCalledWith("1s");
    expect(getBatchedTickDispatcherState().hasPendingRAF).toBe(false);

    unreg();
  });

  it("is a no-op when nothing is pending", () => {
    const setter = vi.fn();
    const unreg = registerTickUpdater(() => "1s", setter, {
      current: "1s",
    });

    flushBatchedTicks();
    expect(setter).not.toHaveBeenCalled();

    unreg();
  });

  it("prevents double-apply when RAF fires after manual flush", () => {
    const setter = vi.fn();
    const unreg = registerTickUpdater(() => "1s", setter, { current: "" });

    vi.advanceTimersByTime(1000);

    flushBatchedTicks();
    expect(setter).toHaveBeenCalledTimes(1);

    // RAF firing after flush should not re-apply
    flushRAF();
    expect(setter).toHaveBeenCalledTimes(1);

    unreg();
  });
});

// ─── Reset ───────────────────────────────────────────────────────────────────

describe("resetBatchedTickDispatcher", () => {
  it("clears all registrations and stops the dispatcher", () => {
    registerTickUpdater(() => "1s", vi.fn(), { current: "" });
    registerTickUpdater(() => "2s", vi.fn(), { current: "" });
    expect(getBatchedTickDispatcherState().registrationCount).toBe(2);

    resetBatchedTickDispatcher();

    expect(getBatchedTickDispatcherState().registrationCount).toBe(0);
    expect(getBatchedTickDispatcherState().hasPendingRAF).toBe(false);
  });

  it("prevents future ticks from triggering updates after reset", () => {
    const setter = vi.fn();
    registerTickUpdater(() => "1s", setter, { current: "" });

    vi.advanceTimersByTime(1000);
    flushRAF();
    expect(setter).toHaveBeenCalledTimes(1);

    resetBatchedTickDispatcher();
    // Also reset tick timer since dispatcher no longer holds unsub reference
    resetTickTimer();

    setter.mockClear();
    vi.advanceTimersByTime(5000);
    flushRAF();
    expect(setter).not.toHaveBeenCalled();
  });
});

// ─── High registration count (performance) ──────────────────────────────────

describe("high registration count", () => {
  it("batches 50 registrations into a single RAF frame", () => {
    const rafSpy = vi.fn(mockRAF);
    vi.stubGlobal("requestAnimationFrame", rafSpy);

    const setters = Array.from({ length: 50 }, () => vi.fn());
    const unregs = setters.map((setter, i) =>
      registerTickUpdater(() => `${i}s`, setter, { current: "" }),
    );

    vi.advanceTimersByTime(1000);

    // Single RAF for all 50
    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(getBatchedTickDispatcherState().pendingUpdateCount).toBe(50);

    flushRAF();

    // All 50 setters called
    for (let i = 0; i < 50; i++) {
      expect(setters[i]).toHaveBeenCalledTimes(1);
      expect(setters[i]).toHaveBeenCalledWith(`${i}s`);
    }

    for (const unreg of unregs) unreg();
  });

  it("only calls setters for registrations with changed values", () => {
    const setters = Array.from({ length: 20 }, () => vi.fn());
    const unregs = setters.map((setter, i) => {
      // Even indices: value matches lastValueRef (no update needed)
      // Odd indices: value differs (update needed)
      const initial = i % 2 === 0 ? `${i}s` : "";
      return registerTickUpdater(() => `${i}s`, setter, { current: initial });
    });

    vi.advanceTimersByTime(1000);
    flushRAF();

    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) {
        // Even: value unchanged, setter NOT called
        expect(setters[i]).not.toHaveBeenCalled();
      } else {
        // Odd: value changed, setter called
        expect(setters[i]).toHaveBeenCalledTimes(1);
      }
    }

    for (const unreg of unregs) unreg();
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles rapid register/unregister cycles", () => {
    for (let i = 0; i < 100; i++) {
      const unreg = registerTickUpdater(() => `${i}s`, vi.fn(), {
        current: "",
      });
      unreg();
    }
    expect(getBatchedTickDispatcherState().registrationCount).toBe(0);
  });

  it("handles unregister during tick computation", () => {
    // Registration that unregisters another during tick
    const setter2 = vi.fn();
    let unreg2: (() => void) | null = null;

    const unreg1 = registerTickUpdater(
      () => {
        if (unreg2) unreg2();
        return "a";
      },
      vi.fn(),
      { current: "" },
    );

    unreg2 = registerTickUpdater(() => "b", setter2, { current: "" });

    // Tick fires — reg1 unregisters reg2 during iteration
    // Due to snapshot, reg2 should still compute in this tick
    vi.advanceTimersByTime(1000);
    flushRAF();

    // setter2 should have been called because snapshot was taken before unregister
    expect(setter2).toHaveBeenCalledWith("b");

    unreg1();
  });

  it("consecutive ticks with same computed value only trigger setter once", () => {
    const setter = vi.fn();
    const unreg = registerTickUpdater(() => "constant", setter, {
      current: "",
    });

    // First tick: "" → "constant" (changed)
    vi.advanceTimersByTime(1000);
    flushRAF();
    expect(setter).toHaveBeenCalledTimes(1);

    // Second tick: "constant" → "constant" (unchanged — skipped)
    vi.advanceTimersByTime(1000);
    flushRAF();
    expect(setter).toHaveBeenCalledTimes(1);

    // Third tick: still "constant" (unchanged — skipped)
    vi.advanceTimersByTime(1000);
    flushRAF();
    expect(setter).toHaveBeenCalledTimes(1);

    unreg();
  });

  it("lastValueRef updates are shared with external consumers", () => {
    const ref = { current: "old" };
    const setter = vi.fn();
    const unreg = registerTickUpdater(() => "new", setter, ref);

    vi.advanceTimersByTime(1000);

    // Ref updated immediately on tick (before RAF)
    expect(ref.current).toBe("new");

    // External consumer updates ref between tick and RAF
    ref.current = "external";

    flushRAF();
    // Setter still called with "new" (the value at tick time)
    expect(setter).toHaveBeenCalledWith("new");

    // Next tick: compute still returns "new", ref says "external" → changed
    vi.advanceTimersByTime(1000);
    flushRAF();
    expect(setter).toHaveBeenCalledTimes(2);

    unreg();
  });
});
