/**
 * Tests for request deduplication module.
 *
 * Covers: in-flight promise sharing, cleanup on success/failure, dispose,
 * sequential calls after completion, and concurrent callers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createRequestDedup,
  type RequestDedup,
} from "../../../src/shared/request-dedup.js";

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
  return { fn, resolve: () => resolve(undefined as T), reject: (err: unknown) => reject(err) };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createRequestDedup", () => {
  it("returns an object with execute, isInFlight, and dispose methods", () => {
    const dedup = createRequestDedup(vi.fn(async () => {}));
    expect(typeof dedup.execute).toBe("function");
    expect(typeof dedup.isInFlight).toBe("function");
    expect(typeof dedup.dispose).toBe("function");
    dedup.dispose();
  });

  it("isInFlight returns false initially", () => {
    const dedup = createRequestDedup(vi.fn(async () => {}));
    expect(dedup.isInFlight()).toBe(false);
    dedup.dispose();
  });
});

describe("in-flight deduplication", () => {
  it("returns the same promise when called while in-flight", async () => {
    const { fn, resolve } = createControllable();
    const dedup = createRequestDedup(fn);

    const p1 = dedup.execute();
    const p2 = dedup.execute();

    // Same promise reference — only one underlying call
    expect(p1).toBe(p2);
    expect(fn).toHaveBeenCalledTimes(1);

    resolve();
    await p1;
    dedup.dispose();
  });

  it("calls the underlying function only once during in-flight window", async () => {
    const { fn, resolve } = createControllable();
    const dedup = createRequestDedup(fn);

    dedup.execute();
    dedup.execute();
    dedup.execute();

    expect(fn).toHaveBeenCalledTimes(1);

    resolve();
    await dedup.execute(); // This resolves immediately since we just resolved
    dedup.dispose();
  });

  it("marks isInFlight as true while request is pending", async () => {
    const { fn, resolve } = createControllable();
    const dedup = createRequestDedup(fn);

    const p = dedup.execute();
    expect(dedup.isInFlight()).toBe(true);

    resolve();
    await p;
    expect(dedup.isInFlight()).toBe(false);
    dedup.dispose();
  });
});

describe("cleanup on completion", () => {
  it("clears in-flight tracking after successful resolution", async () => {
    const { fn, resolve } = createControllable();
    const dedup = createRequestDedup(fn);

    const p = dedup.execute();
    resolve();
    await p;

    // Next call should start a new request
    const { fn: fn2 } = createControllable();
    const dedup2 = createRequestDedup(fn2);
    dedup2.execute();
    expect(fn2).toHaveBeenCalledTimes(1);
    dedup2.dispose();
    dedup.dispose();
  });

  it("allows a new request after the previous one completes", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
    });
    const dedup = createRequestDedup(fn);

    await dedup.execute();
    expect(callCount).toBe(1);

    await dedup.execute();
    expect(callCount).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
    dedup.dispose();
  });

  it("clears in-flight tracking after rejection", async () => {
    const { fn, reject } = createControllable();
    const dedup = createRequestDedup(fn);

    const p = dedup.execute();
    reject(new Error("network error"));

    await expect(p).rejects.toThrow("network error");
    expect(dedup.isInFlight()).toBe(false);

    // Next call should start a new request
    expect(fn).toHaveBeenCalledTimes(1);
    dedup.execute();
    expect(fn).toHaveBeenCalledTimes(2);
    dedup.dispose();
  });

  it("propagates rejection to all shared callers", async () => {
    const { fn, reject } = createControllable();
    const dedup = createRequestDedup(fn);

    const p1 = dedup.execute();
    const p2 = dedup.execute();

    reject(new Error("server down"));

    await expect(p1).rejects.toThrow("server down");
    await expect(p2).rejects.toThrow("server down");
    dedup.dispose();
  });
});

describe("sequential requests", () => {
  it("starts a fresh request after previous one resolves", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const dedup = createRequestDedup(fn);

    const r1 = await dedup.execute();
    expect(r1).toBe(1);

    const r2 = await dedup.execute();
    expect(r2).toBe(2);

    expect(fn).toHaveBeenCalledTimes(2);
    dedup.dispose();
  });

  it("starts a fresh request after previous one rejects", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("first fails");
      return callCount;
    });
    const dedup = createRequestDedup(fn);

    await expect(dedup.execute()).rejects.toThrow("first fails");
    const r2 = await dedup.execute();
    expect(r2).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
    dedup.dispose();
  });
});

describe("concurrent callers", () => {
  it("all concurrent callers receive the same resolved value", async () => {
    const fn = vi.fn(async () => 42);
    const dedup = createRequestDedup(fn);

    // Start multiple concurrent calls
    const promises = [dedup.execute(), dedup.execute(), dedup.execute()];
    const results = await Promise.all(promises);

    expect(results).toEqual([42, 42, 42]);
    expect(fn).toHaveBeenCalledTimes(1);
    dedup.dispose();
  });
});

describe("dispose", () => {
  it("clears in-flight state", () => {
    const { fn } = createControllable();
    const dedup = createRequestDedup(fn);

    dedup.execute();
    expect(dedup.isInFlight()).toBe(true);

    dedup.dispose();
    expect(dedup.isInFlight()).toBe(false);
  });

  it("starts a new request after dispose even if previous was in-flight", async () => {
    const { fn, resolve } = createControllable();
    const dedup = createRequestDedup(fn);

    dedup.execute();
    dedup.dispose();

    // New execute should start a fresh request
    const p = dedup.execute();
    expect(fn).toHaveBeenCalledTimes(2);

    resolve();
    await p;
    dedup.dispose();
  });
});
