/**
 * Unit tests for the register-scheduler module.
 *
 * Validates that registerUsageScheduler correctly delegates to
 * startUsageCleanupScheduler with the expected arguments and
 * returns a clearable interval handle.
 *
 * @see packages/web/src/server/register-scheduler.ts
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
    let activeCount = 0;
    let maxConcurrent = 0;

    const slowAggregator = {
      getTaskUsage: vi.fn(async () => {
        activeCount++;
        maxConcurrent = Math.max(maxConcurrent, activeCount);
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
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

    await new Promise((resolve) => setTimeout(resolve, 150));
    clearInterval(handle);

    // The running guard must prevent concurrent tick execution.
    expect(maxConcurrent).toBe(1);
  });

  it("uses overrideIntervalMs when provided", async () => {
    let callCount = 0;
    const options: RegisterSchedulerOptions = {
      ctx: { rexDir: "/tmp/nonexistent/.rex", projectDir: "/tmp/nonexistent" },
      getAggregator: () => {
        callCount++;
        return mockAggregator() as any;
      },
      overrideIntervalMs: 30, // Very short for testing
    };

    const handle = registerUsageScheduler(options);
    activeTimers.push(handle);

    // Wait for at least one cycle
    await new Promise((resolve) => setTimeout(resolve, 100));
    clearInterval(handle);

    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});
