/**
 * Unit tests for the register-scheduler module.
 *
 * Validates that registerUsageScheduler correctly delegates to
 * startUsageCleanupScheduler with the expected arguments and
 * returns a clearable interval handle.
 *
 * @see packages/web/src/server/task-usage/register-scheduler.ts
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { registerUsageScheduler } from "../../../src/server/task-usage/register-scheduler.js";
import type { RegisterSchedulerOptions } from "../../../src/server/task-usage/register-scheduler.js";

/** Create a minimal mock aggregator. */
function mockAggregator() {
  return {
    getTaskUsage: vi.fn(async () => ({})),
    pruneStaleEntries: vi.fn(),
    reset: vi.fn(),
    onFileChange: vi.fn(),
    close: vi.fn(),
  };
}

describe("registerUsageScheduler", () => {
  const activeTimers: ReturnType<typeof setInterval>[] = [];

  afterEach(() => {
    for (const timer of activeTimers) {
      clearInterval(timer);
    }
    activeTimers.length = 0;
    vi.useRealTimers();
  });

  it("returns a clearable interval handle", () => {
    const options: RegisterSchedulerOptions = {
      ctx: { rexDir: "/tmp/test/.rex", projectDir: "/tmp/test" },
      getAggregator: () => mockAggregator() as any,
      overrideIntervalMs: 60_000,
    };

    const handle = registerUsageScheduler(options);
    activeTimers.push(handle);

    expect(handle).toBeDefined();
    // Should not throw when cleared
    clearInterval(handle);
  });

  it("passes broadcast function through", () => {
    const broadcast = vi.fn();
    const options: RegisterSchedulerOptions = {
      ctx: { rexDir: "/tmp/test/.rex", projectDir: "/tmp/test" },
      getAggregator: () => mockAggregator() as any,
      broadcast,
      overrideIntervalMs: 60_000,
    };

    const handle = registerUsageScheduler(options);
    activeTimers.push(handle);

    expect(handle).toBeDefined();
    clearInterval(handle);
  });

  it("accepts collectAllIds injection", () => {
    const collectAllIds = vi.fn((items: unknown[]) => new Set<string>());
    const options: RegisterSchedulerOptions = {
      ctx: { rexDir: "/tmp/test/.rex", projectDir: "/tmp/test" },
      getAggregator: () => mockAggregator() as any,
      collectAllIds,
      overrideIntervalMs: 60_000,
    };

    const handle = registerUsageScheduler(options);
    activeTimers.push(handle);

    expect(handle).toBeDefined();
    clearInterval(handle);
  });

  it("accepts loadPRD injection", () => {
    const loadPRD = vi.fn(() => null);
    const options: RegisterSchedulerOptions = {
      ctx: { rexDir: "/tmp/test/.rex", projectDir: "/tmp/test" },
      getAggregator: () => mockAggregator() as any,
      loadPRD,
      overrideIntervalMs: 60_000,
    };

    const handle = registerUsageScheduler(options);
    activeTimers.push(handle);

    expect(handle).toBeDefined();
    clearInterval(handle);
  });

  it("an error in one tick does not prevent subsequent ticks from firing", async () => {
    // Use fake timers so the test is deterministic and not subject to event-loop
    // starvation when 150+ test files run in parallel.
    vi.useFakeTimers();
    let callCount = 0;

    const options: RegisterSchedulerOptions = {
      ctx: { rexDir: "/tmp/test/.rex", projectDir: "/tmp/test" },
      getAggregator: () => {
        callCount++;
        if (callCount === 1) throw new Error("transient failure");
        return mockAggregator() as any;
      },
      overrideIntervalMs: 20,
    };

    const handle = registerUsageScheduler(options);
    activeTimers.push(handle);

    // Advance fake clock by 100 ms (≥ 5 ticks at 20 ms interval); also flushes
    // any pending microtasks between each tick so async callbacks settle fully.
    await vi.advanceTimersByTimeAsync(100);
    clearInterval(handle);
    vi.useRealTimers();

    // The scheduler must have recovered and fired subsequent ticks despite the first error.
    expect(callCount).toBeGreaterThan(1);
  });

  it("a loadPRD callback that delays longer than the interval does not cause overlapping tick execution", async () => {
    // Fake timers plus an explicit gate. This used to start a 15 ms interval
    // against a 50 ms callback and read `maxConcurrent` after a real 150 ms
    // sleep: a starved event loop delivers no tick at all in that window, and
    // `maxConcurrent` comes back 0 — a failure produced by load, with the
    // guard working perfectly. Holding one tick open across ten firings states
    // the claim without a clock: while a cycle is in flight, no second cycle
    // starts, and when it finishes the next firing runs.
    vi.useFakeTimers();
    let activeCount = 0;
    let maxConcurrent = 0;
    let releaseTick!: () => void;
    const tickMayFinish = new Promise<void>((resolve) => { releaseTick = resolve; });

    const slowAggregator = {
      getTaskUsage: vi.fn(async () => {
        activeCount++;
        maxConcurrent = Math.max(maxConcurrent, activeCount);
        await tickMayFinish;
        activeCount--;
        return {} as Record<string, never>;
      }),
      pruneStaleEntries: vi.fn(),
      reset: vi.fn(),
      onFileChange: vi.fn(),
      close: vi.fn(),
    };

    const options: RegisterSchedulerOptions = {
      ctx: { rexDir: "/tmp/test/.rex", projectDir: "/tmp/test" },
      getAggregator: () => slowAggregator as any,
      overrideIntervalMs: 15, // fires faster than getTaskUsage resolves
    };

    const handle = registerUsageScheduler(options);
    activeTimers.push(handle);

    // Ten interval firings while the first cycle is still inside getTaskUsage.
    await vi.advanceTimersByTimeAsync(150);
    expect(slowAggregator.getTaskUsage).toHaveBeenCalledTimes(1);
    expect(maxConcurrent).toBe(1);

    // The guard must also let go: the cycle finishes, the next firing runs one.
    releaseTick();
    await vi.advanceTimersByTimeAsync(15);
    clearInterval(handle);

    expect(slowAggregator.getTaskUsage).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1);
  });

  it("uses overrideIntervalMs when provided", async () => {
    // Stated exactly rather than approximated: nothing fires before the
    // override elapses, and a tick lands on it. The real-clock version waited
    // 100 ms for a 30 ms interval and asserted "at least one", which passes
    // for any interval up to 100 ms and fails for a correct one whenever the
    // event loop is busy enough to swallow the window.
    vi.useFakeTimers();
    let callCount = 0;
    const options: RegisterSchedulerOptions = {
      ctx: { rexDir: "/tmp/nonexistent/.rex", projectDir: "/tmp/nonexistent" },
      getAggregator: () => {
        callCount++;
        return mockAggregator() as any;
      },
      overrideIntervalMs: 30,
    };

    const handle = registerUsageScheduler(options);
    activeTimers.push(handle);

    await vi.advanceTimersByTimeAsync(29);
    expect(callCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(callCount).toBe(1);

    clearInterval(handle);
  });
});
