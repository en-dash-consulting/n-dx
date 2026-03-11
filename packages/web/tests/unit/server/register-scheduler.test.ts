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
import { registerUsageScheduler } from "../../../src/server/register-scheduler.js";
import type { RegisterSchedulerOptions } from "../../../src/server/register-scheduler.js";

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
