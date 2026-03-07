/**
 * Tests for requestAnimationFrame-based update batching.
 *
 * Covers: RAF scheduling, multi-update composition, setter isolation,
 * final state consistency, flush behaviour, disposal, disabled mode,
 * and hasPending status.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createUpdateBatcher,
  type UpdateBatcher,
} from "../../../src/viewer/performance/update-batcher.js";

// ─── RAF mock ─────────────────────────────────────────────────────────────────

/** Collect RAF callbacks so tests can fire them on demand. */
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

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  rafCallbacks = [];
  rafIdCounter = 0;
  vi.stubGlobal("requestAnimationFrame", mockRAF);
  vi.stubGlobal("cancelAnimationFrame", mockCancelRAF);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createUpdateBatcher", () => {
  it("returns an object with schedule, flush, hasPending, and dispose methods", () => {
    const batcher = createUpdateBatcher();
    expect(typeof batcher.schedule).toBe("function");
    expect(typeof batcher.flush).toBe("function");
    expect(typeof batcher.hasPending).toBe("function");
    expect(typeof batcher.dispose).toBe("function");
    batcher.dispose();
  });

  it("hasPending returns false initially", () => {
    const batcher = createUpdateBatcher();
    expect(batcher.hasPending()).toBe(false);
    batcher.dispose();
  });
});

describe("RAF scheduling", () => {
  it("does not call setter synchronously when scheduling", () => {
    const batcher = createUpdateBatcher();
    const setter = vi.fn();

    batcher.schedule(setter, (prev: number) => prev + 1);

    expect(setter).not.toHaveBeenCalled();
    batcher.dispose();
  });

  it("calls setter once per animation frame", () => {
    const batcher = createUpdateBatcher();
    const setter = vi.fn();

    batcher.schedule(setter, (prev: number) => prev + 1);
    batcher.schedule(setter, (prev: number) => prev + 10);

    // Neither called yet
    expect(setter).not.toHaveBeenCalled();

    flushRAF();

    // Called exactly once with a composed updater
    expect(setter).toHaveBeenCalledTimes(1);
    batcher.dispose();
  });

  it("marks hasPending true after schedule, false after RAF", () => {
    const batcher = createUpdateBatcher();
    const setter = vi.fn();

    batcher.schedule(setter, (prev: number) => prev + 1);
    expect(batcher.hasPending()).toBe(true);

    flushRAF();
    expect(batcher.hasPending()).toBe(false);
    batcher.dispose();
  });

  it("requests only one RAF per batch window", () => {
    const rafSpy = vi.fn(mockRAF);
    vi.stubGlobal("requestAnimationFrame", rafSpy);

    const batcher = createUpdateBatcher();
    const setter = vi.fn();

    batcher.schedule(setter, (prev: number) => prev + 1);
    batcher.schedule(setter, (prev: number) => prev + 2);
    batcher.schedule(setter, (prev: number) => prev + 3);

    // Only one RAF requested despite 3 schedules
    expect(rafSpy).toHaveBeenCalledTimes(1);

    flushRAF();
    batcher.dispose();
  });
});

describe("update composition", () => {
  it("composes multiple updates for the same setter in order", () => {
    const batcher = createUpdateBatcher();
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    batcher.schedule(setter, (prev) => prev + 1);   // 0 → 1
    batcher.schedule(setter, (prev) => prev * 10);   // 1 → 10
    batcher.schedule(setter, (prev) => prev + 5);    // 10 → 15

    flushRAF();

    expect(setter).toHaveBeenCalledTimes(1);
    expect(state).toBe(15);
    batcher.dispose();
  });

  it("preserves final state with identity updates", () => {
    const batcher = createUpdateBatcher();
    let state = { count: 0, label: "init" };
    const setter = vi.fn((updater: (prev: typeof state) => typeof state) => {
      state = updater(state);
    });

    batcher.schedule(setter, (prev) => ({ ...prev, count: prev.count + 1 }));
    batcher.schedule(setter, (prev) => ({ ...prev, label: "updated" }));

    flushRAF();

    expect(state).toEqual({ count: 1, label: "updated" });
    expect(setter).toHaveBeenCalledTimes(1);
    batcher.dispose();
  });

  it("handles a single update correctly", () => {
    const batcher = createUpdateBatcher();
    let state = 42;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    batcher.schedule(setter, (prev) => prev * 2);

    flushRAF();

    expect(state).toBe(84);
    expect(setter).toHaveBeenCalledTimes(1);
    batcher.dispose();
  });
});

describe("setter isolation", () => {
  it("calls different setters independently within the same frame", () => {
    const batcher = createUpdateBatcher();

    let stateA = 0;
    const setterA = vi.fn((updater: (prev: number) => number) => {
      stateA = updater(stateA);
    });

    let stateB = "hello";
    const setterB = vi.fn((updater: (prev: string) => string) => {
      stateB = updater(stateB);
    });

    batcher.schedule(setterA, (prev) => prev + 1);
    batcher.schedule(setterB, (prev) => prev + " world");
    batcher.schedule(setterA, (prev) => prev + 10);

    flushRAF();

    expect(setterA).toHaveBeenCalledTimes(1);
    expect(stateA).toBe(11);

    expect(setterB).toHaveBeenCalledTimes(1);
    expect(stateB).toBe("hello world");
    batcher.dispose();
  });

  it("does not mix updaters across setters", () => {
    const batcher = createUpdateBatcher();

    let count = 0;
    const setCount = vi.fn((updater: (prev: number) => number) => {
      count = updater(count);
    });

    let label = "";
    const setLabel = vi.fn((updater: (prev: string) => string) => {
      label = updater(label);
    });

    batcher.schedule(setCount, (prev) => prev + 5);
    batcher.schedule(setLabel, (prev) => prev + "a");
    batcher.schedule(setCount, (prev) => prev + 3);
    batcher.schedule(setLabel, (prev) => prev + "b");

    flushRAF();

    expect(count).toBe(8);
    expect(label).toBe("ab");
    batcher.dispose();
  });
});

describe("sequential batches", () => {
  it("creates independent batches across frames", () => {
    const batcher = createUpdateBatcher();
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    // Frame 1
    batcher.schedule(setter, (prev) => prev + 1);
    flushRAF();
    expect(state).toBe(1);
    expect(setter).toHaveBeenCalledTimes(1);

    // Frame 2
    batcher.schedule(setter, (prev) => prev + 100);
    flushRAF();
    expect(state).toBe(101);
    expect(setter).toHaveBeenCalledTimes(2);
    batcher.dispose();
  });

  it("allows scheduling after a frame completes", () => {
    const batcher = createUpdateBatcher();
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    batcher.schedule(setter, (prev) => prev + 1);
    flushRAF();
    expect(batcher.hasPending()).toBe(false);

    batcher.schedule(setter, (prev) => prev + 2);
    expect(batcher.hasPending()).toBe(true);

    flushRAF();
    expect(state).toBe(3);
    batcher.dispose();
  });
});

describe("manual flush", () => {
  it("applies all pending updates synchronously", () => {
    const batcher = createUpdateBatcher();
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    batcher.schedule(setter, (prev) => prev + 1);
    batcher.schedule(setter, (prev) => prev + 2);

    batcher.flush();

    expect(state).toBe(3);
    expect(setter).toHaveBeenCalledTimes(1);
    batcher.dispose();
  });

  it("does nothing when no updates are pending", () => {
    const batcher = createUpdateBatcher();
    const setter = vi.fn();

    batcher.flush();

    expect(setter).not.toHaveBeenCalled();
    batcher.dispose();
  });

  it("cancels the pending RAF after manual flush", () => {
    const cancelSpy = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelSpy);

    const batcher = createUpdateBatcher();
    const setter = vi.fn();

    batcher.schedule(setter, (prev: number) => prev + 1);
    batcher.flush();

    expect(cancelSpy).toHaveBeenCalled();
    expect(batcher.hasPending()).toBe(false);

    // RAF firing after flush should not double-apply
    flushRAF();
    expect(setter).toHaveBeenCalledTimes(1);
    batcher.dispose();
  });
});

describe("dispose", () => {
  it("cancels pending RAF", () => {
    const cancelSpy = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelSpy);

    const batcher = createUpdateBatcher();
    const setter = vi.fn();

    batcher.schedule(setter, (prev: number) => prev + 1);
    batcher.dispose();

    expect(cancelSpy).toHaveBeenCalled();
  });

  it("clears pending updates without applying them", () => {
    const batcher = createUpdateBatcher();
    const setter = vi.fn();

    batcher.schedule(setter, (prev: number) => prev + 1);
    batcher.dispose();

    flushRAF();
    expect(setter).not.toHaveBeenCalled();
  });

  it("ignores schedules after disposal", () => {
    const batcher = createUpdateBatcher();
    const setter = vi.fn();

    batcher.dispose();
    batcher.schedule(setter, (prev: number) => prev + 1);

    expect(batcher.hasPending()).toBe(false);
    flushRAF();
    expect(setter).not.toHaveBeenCalled();
  });

  it("flush is a no-op after disposal", () => {
    const batcher = createUpdateBatcher();
    const setter = vi.fn();

    batcher.schedule(setter, (prev: number) => prev + 1);
    batcher.dispose();
    batcher.flush();

    expect(setter).not.toHaveBeenCalled();
  });
});

describe("disabled mode", () => {
  it("applies updates synchronously when disabled", () => {
    const batcher = createUpdateBatcher({ disabled: true });
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    batcher.schedule(setter, (prev) => prev + 1);

    // Applied immediately — no RAF needed
    expect(setter).toHaveBeenCalledTimes(1);
    expect(state).toBe(1);
    batcher.dispose();
  });

  it("does not request RAF when disabled", () => {
    const rafSpy = vi.fn(mockRAF);
    vi.stubGlobal("requestAnimationFrame", rafSpy);

    const batcher = createUpdateBatcher({ disabled: true });
    const setter = vi.fn();

    batcher.schedule(setter, (prev: number) => prev + 1);

    expect(rafSpy).not.toHaveBeenCalled();
    batcher.dispose();
  });

  it("hasPending is always false when disabled", () => {
    const batcher = createUpdateBatcher({ disabled: true });
    const setter = vi.fn();

    batcher.schedule(setter, (prev: number) => prev + 1);
    expect(batcher.hasPending()).toBe(false);
    batcher.dispose();
  });

  it("each schedule calls setter independently when disabled", () => {
    const batcher = createUpdateBatcher({ disabled: true });
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
    });

    batcher.schedule(setter, (prev) => prev + 1);
    batcher.schedule(setter, (prev) => prev * 10);
    batcher.schedule(setter, (prev) => prev + 5);

    // Each applied immediately — 3 calls
    expect(setter).toHaveBeenCalledTimes(3);
    expect(state).toBe(15);
    batcher.dispose();
  });
});

describe("final state consistency", () => {
  it("composed updates match sequential application", () => {
    const batcher = createUpdateBatcher();

    // Sequential (reference) application
    let sequential = 0;
    sequential = sequential + 1;   // 1
    sequential = sequential * 3;   // 3
    sequential = sequential - 1;   // 2
    sequential = sequential * 2;   // 4

    // Batched application
    let batched = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      batched = updater(batched);
    });

    batcher.schedule(setter, (prev) => prev + 1);
    batcher.schedule(setter, (prev) => prev * 3);
    batcher.schedule(setter, (prev) => prev - 1);
    batcher.schedule(setter, (prev) => prev * 2);

    flushRAF();

    expect(batched).toBe(sequential);
    expect(batched).toBe(4);
    batcher.dispose();
  });

  it("only the final state is visible after a batched frame", () => {
    const batcher = createUpdateBatcher();
    const states: number[] = [];
    let state = 0;
    const setter = vi.fn((updater: (prev: number) => number) => {
      state = updater(state);
      states.push(state);
    });

    batcher.schedule(setter, (prev) => prev + 1);
    batcher.schedule(setter, (prev) => prev + 2);
    batcher.schedule(setter, (prev) => prev + 3);

    flushRAF();

    // Setter called once — only final state recorded
    expect(states).toEqual([6]);
    batcher.dispose();
  });
});

describe("edge cases", () => {
  it("handles updaters that return the same reference (identity)", () => {
    const batcher = createUpdateBatcher();
    const obj = { x: 1 };
    let state = obj;
    const setter = vi.fn((updater: (prev: typeof obj) => typeof obj) => {
      state = updater(state);
    });

    // Identity updater — returns the same reference
    batcher.schedule(setter, (prev) => prev);

    flushRAF();

    expect(state).toBe(obj);
    expect(setter).toHaveBeenCalledTimes(1);
    batcher.dispose();
  });

  it("handles null/undefined state values", () => {
    const batcher = createUpdateBatcher();
    let state: string | null = null;
    const setter = vi.fn((updater: (prev: string | null) => string | null) => {
      state = updater(state);
    });

    batcher.schedule(setter, (prev) => prev ?? "default");

    flushRAF();

    expect(state).toBe("default");
    batcher.dispose();
  });

  it("handles rapid alternating setters", () => {
    const batcher = createUpdateBatcher();

    let a = 0;
    let b = 0;
    const setA = vi.fn((updater: (prev: number) => number) => { a = updater(a); });
    const setB = vi.fn((updater: (prev: number) => number) => { b = updater(b); });

    // Alternate between setters rapidly
    for (let i = 0; i < 20; i++) {
      batcher.schedule(i % 2 === 0 ? setA : setB, (prev) => prev + 1);
    }

    flushRAF();

    expect(a).toBe(10); // 20/2 = 10 increments
    expect(b).toBe(10);
    expect(setA).toHaveBeenCalledTimes(1);
    expect(setB).toHaveBeenCalledTimes(1);
    batcher.dispose();
  });
});
