/**
 * Tests for the composed fetch pipeline (rate limiter + request dedup).
 *
 * Verifies that createFetchPipeline correctly composes rate limiting with
 * request deduplication, provides lifecycle methods, and handles errors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createFetchPipeline,
  type FetchPipeline,
} from "../../../src/viewer/messaging/index.js";

describe("createFetchPipeline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes the function on first call", async () => {
    const fn = vi.fn().mockResolvedValue("result");
    const pipeline = createFetchPipeline(fn, { minIntervalMs: 500 });

    const result = await pipeline.execute();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe("result");

    pipeline.dispose();
  });

  it("deduplicates concurrent in-flight requests", async () => {
    vi.useRealTimers();

    let callCount = 0;
    let resolvePromise!: (value: string) => void;
    const fn = vi.fn().mockImplementation(
      () => {
        callCount++;
        return new Promise<string>((resolve) => { resolvePromise = resolve; });
      },
    );
    // Use a very short interval so both calls fire immediately
    const pipeline = createFetchPipeline(fn, { minIntervalMs: 0 });

    // Both calls fire immediately (minIntervalMs=0), but dedup ensures
    // the second call shares the first's in-flight promise
    const p1 = pipeline.execute();
    const p2 = pipeline.execute();

    expect(pipeline.isInFlight()).toBe(true);

    resolvePromise("shared");

    const [r1, r2] = await Promise.all([p1, p2]);

    // Dedup: only one actual fn invocation
    expect(callCount).toBe(1);
    expect(r1).toBe("shared");
    expect(r2).toBe("shared");

    pipeline.dispose();
  });

  it("rate-limits calls within the interval", async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(
      () => Promise.resolve(++callCount),
    );
    const pipeline = createFetchPipeline(fn, { minIntervalMs: 500 });

    // First call executes immediately
    await pipeline.execute();
    expect(fn).toHaveBeenCalledTimes(1);

    // Second call within interval — queued
    const p2 = pipeline.execute();
    expect(fn).toHaveBeenCalledTimes(1); // Still 1

    // Advance past rate limit
    vi.advanceTimersByTime(500);
    const r2 = await p2;

    expect(fn).toHaveBeenCalledTimes(2);
    expect(r2).toBe(2);

    pipeline.dispose();
  });

  it("reports execution and pending state", async () => {
    let resolvePromise!: () => void;
    const fn = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolvePromise = resolve; }),
    );
    const pipeline = createFetchPipeline(fn, { minIntervalMs: 500 });

    expect(pipeline.isInFlight()).toBe(false);

    const p = pipeline.execute();
    expect(pipeline.isInFlight()).toBe(true);

    resolvePromise();
    await p;

    expect(pipeline.isInFlight()).toBe(false);

    pipeline.dispose();
  });

  it("propagates errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const pipeline = createFetchPipeline(fn, { minIntervalMs: 500 });

    await expect(pipeline.execute()).rejects.toThrow("fetch failed");

    pipeline.dispose();
  });

  it("dispose() is safe to call multiple times", () => {
    const pipeline = createFetchPipeline(
      () => Promise.resolve(),
      { minIntervalMs: 500 },
    );

    expect(() => {
      pipeline.dispose();
      pipeline.dispose();
    }).not.toThrow();
  });
});
