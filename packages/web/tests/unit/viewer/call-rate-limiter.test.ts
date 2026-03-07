/**
 * Tests for call-level rate limiter with queue deduplication.
 *
 * Covers: immediate execution, cooldown queuing, queue deduplication,
 * sequential calls after cooldown, error propagation, dispose cleanup,
 * and configurable intervals.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createCallRateLimiter,
  type CallRateLimiter,
} from "../../../src/viewer/messaging/call-rate-limiter.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a controllable async function with resolve/reject handles. */
function createControllable<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const fn = vi.fn(
    () =>
      new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return {
    fn,
    resolve: (value?: T) => resolve((value ?? undefined) as T),
    reject: (err: unknown) => reject(err),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createCallRateLimiter", () => {
  it("returns an object with execute, isExecuting, isPending, and dispose methods", () => {
    const limiter = createCallRateLimiter(vi.fn(async () => {}));
    expect(typeof limiter.execute).toBe("function");
    expect(typeof limiter.isExecuting).toBe("function");
    expect(typeof limiter.isPending).toBe("function");
    expect(typeof limiter.dispose).toBe("function");
    limiter.dispose();
  });

  it("isExecuting and isPending return false initially", () => {
    const limiter = createCallRateLimiter(vi.fn(async () => {}));
    expect(limiter.isExecuting()).toBe(false);
    expect(limiter.isPending()).toBe(false);
    limiter.dispose();
  });

  it("uses default minIntervalMs of 500 when not configured", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const limiter = createCallRateLimiter(fn);

    // First call — immediate
    await limiter.execute();
    expect(fn).toHaveBeenCalledTimes(1);

    // Second call within 500ms — should be queued
    const p = limiter.execute();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(limiter.isPending()).toBe(true);

    // Advance past 500ms cooldown
    vi.advanceTimersByTime(500);
    await p;
    expect(fn).toHaveBeenCalledTimes(2);
    limiter.dispose();
  });

  it("respects custom minIntervalMs", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 1000 });

    await limiter.execute();
    expect(fn).toHaveBeenCalledTimes(1);

    // Within 1000ms — queued
    const p = limiter.execute();
    expect(fn).toHaveBeenCalledTimes(1);

    // 500ms is not enough
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);

    // 1000ms total — fires
    vi.advanceTimersByTime(500);
    await p;
    expect(fn).toHaveBeenCalledTimes(2);
    limiter.dispose();
  });
});

describe("immediate execution", () => {
  it("executes immediately on first call", async () => {
    const fn = vi.fn(async () => 42);
    const limiter = createCallRateLimiter(fn);

    const result = await limiter.execute();
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    limiter.dispose();
  });

  it("marks isExecuting as true while function is running", async () => {
    const { fn, resolve } = createControllable();
    const limiter = createCallRateLimiter(fn);

    const p = limiter.execute();
    expect(limiter.isExecuting()).toBe(true);

    resolve();
    await p;
    expect(limiter.isExecuting()).toBe(false);
    limiter.dispose();
  });

  it("executes immediately after cooldown has elapsed", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 100 });

    await limiter.execute();
    expect(fn).toHaveBeenCalledTimes(1);

    // Wait for cooldown to elapse
    vi.advanceTimersByTime(100);

    // Should execute immediately — no queueing
    const result = await limiter.execute();
    expect(result).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(limiter.isPending()).toBe(false);
    limiter.dispose();
  });
});

describe("rate limit cooldown", () => {
  it("queues call during cooldown window", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 200 });

    // First call — immediate
    await limiter.execute();
    expect(fn).toHaveBeenCalledTimes(1);

    // Second call within 200ms — queued
    const p = limiter.execute();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(limiter.isPending()).toBe(true);

    // Advance timer past cooldown
    vi.advanceTimersByTime(200);
    const result = await p;

    expect(result).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(limiter.isPending()).toBe(false);
    limiter.dispose();
  });

  it("fires queued call at the correct delay", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 300 });

    await limiter.execute();

    // Advance 100ms, then queue a call — should fire after remaining 200ms
    vi.advanceTimersByTime(100);
    const p = limiter.execute();
    expect(fn).toHaveBeenCalledTimes(1);

    // 190ms more — not yet (total only 290ms from start)
    vi.advanceTimersByTime(190);
    expect(fn).toHaveBeenCalledTimes(1);

    // 10ms more — now (total 300ms from start)
    vi.advanceTimersByTime(10);
    await p;
    expect(fn).toHaveBeenCalledTimes(2);
    limiter.dispose();
  });
});

describe("queue deduplication", () => {
  it("deduplicates multiple calls during cooldown into one execution", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 200 });

    await limiter.execute();

    // Multiple calls during cooldown — all share one queued promise
    const p1 = limiter.execute();
    const p2 = limiter.execute();
    const p3 = limiter.execute();

    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    const results = await Promise.all([p1, p2, p3]);

    expect(results).toEqual([2, 2, 2]);
    expect(fn).toHaveBeenCalledTimes(2); // Only 2 total: initial + 1 queued
    limiter.dispose();
  });

  it("returns the same promise reference for deduplicated calls", async () => {
    const fn = vi.fn(async () => {});
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 200 });

    await limiter.execute();

    const p1 = limiter.execute();
    const p2 = limiter.execute();

    // Same promise reference — truly deduplicated
    expect(p1).toBe(p2);

    vi.advanceTimersByTime(200);
    await p1;
    limiter.dispose();
  });
});

describe("error propagation", () => {
  it("propagates errors from immediate execution", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const limiter = createCallRateLimiter(fn);

    await expect(limiter.execute()).rejects.toThrow("fetch failed");
    expect(limiter.isExecuting()).toBe(false);
    limiter.dispose();
  });

  it("propagates errors from queued execution to all shared callers", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 2) throw new Error("queued failed");
      return callCount;
    });
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 200 });

    await limiter.execute(); // succeeds

    const p1 = limiter.execute();
    const p2 = limiter.execute();

    vi.advanceTimersByTime(200);

    await expect(p1).rejects.toThrow("queued failed");
    await expect(p2).rejects.toThrow("queued failed");
    limiter.dispose();
  });

  it("allows new execution after error clears isExecuting", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("first fails");
      return callCount;
    });
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 100 });

    await expect(limiter.execute()).rejects.toThrow("first fails");
    expect(limiter.isExecuting()).toBe(false);

    // After cooldown, next call succeeds
    vi.advanceTimersByTime(100);
    const result = await limiter.execute();
    expect(result).toBe(2);
    limiter.dispose();
  });
});

describe("sequential calls", () => {
  it("allows multiple sequential calls with proper cooldown spacing", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 100 });

    const r1 = await limiter.execute();
    expect(r1).toBe(1);

    vi.advanceTimersByTime(100);
    const r2 = await limiter.execute();
    expect(r2).toBe(2);

    vi.advanceTimersByTime(100);
    const r3 = await limiter.execute();
    expect(r3).toBe(3);

    expect(fn).toHaveBeenCalledTimes(3);
    limiter.dispose();
  });

  it("queued call followed by another after cooldown works correctly", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 200 });

    // First call — immediate
    await limiter.execute();
    expect(callCount).toBe(1);

    // Second call — queued
    const p2 = limiter.execute();
    vi.advanceTimersByTime(200);
    await p2;
    expect(callCount).toBe(2);

    // Third call after cooldown — immediate
    vi.advanceTimersByTime(200);
    await limiter.execute();
    expect(callCount).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
    limiter.dispose();
  });
});

describe("dispose", () => {
  it("clears pending timer and state", async () => {
    const fn = vi.fn(async () => 42);
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 200 });

    await limiter.execute();

    // Queue a call
    limiter.execute();
    expect(limiter.isPending()).toBe(true);

    limiter.dispose();
    expect(limiter.isPending()).toBe(false);
    expect(limiter.isExecuting()).toBe(false);

    // Timer should be cleared — advancing time doesn't trigger fn
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rejects execute calls after dispose", async () => {
    const fn = vi.fn(async () => {});
    const limiter = createCallRateLimiter(fn);

    limiter.dispose();
    await expect(limiter.execute()).rejects.toThrow("disposed");
  });

  it("is safe to call multiple times", () => {
    const fn = vi.fn(async () => {});
    const limiter = createCallRateLimiter(fn);

    expect(() => {
      limiter.dispose();
      limiter.dispose();
      limiter.dispose();
    }).not.toThrow();
  });
});

describe("integration: rapid burst scenario", () => {
  it("collapses a burst of calls into at most 2 executions per second", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const limiter = createCallRateLimiter(fn, { minIntervalMs: 500 });

    // Simulate a burst: 10 rapid calls
    const first = limiter.execute(); // immediate
    const promises: Promise<number>[] = [];
    for (let i = 0; i < 9; i++) {
      promises.push(limiter.execute()); // all dedupe to one queued
    }

    await first;
    expect(fn).toHaveBeenCalledTimes(1);

    // All queued promises are the same reference
    const uniquePromises = new Set(promises);
    expect(uniquePromises.size).toBe(1);

    // Fire the single queued call
    vi.advanceTimersByTime(500);
    await promises[0];
    expect(fn).toHaveBeenCalledTimes(2);

    limiter.dispose();
  });
});
