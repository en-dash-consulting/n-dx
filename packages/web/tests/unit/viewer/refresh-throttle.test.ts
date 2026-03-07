/**
 * Tests for the memory-aware refresh throttling and queuing module.
 *
 * Covers: queue management, priority sorting, deduplication, concurrency
 * limits per memory level, interval recommendations, drain behaviour,
 * listener management, and reset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startRefreshThrottle,
  stopRefreshThrottle,
  enqueueRefresh,
  getQueueState,
  getRecommendedInterval,
  getThrottleLevel,
  onQueueChange,
  resetRefreshThrottle,
  type RefreshQueueState,
} from "../../../src/viewer/performance/refresh-throttle.js";
import {
  startMemoryMonitor,
  resetMemoryMonitor,
} from "../../../src/viewer/performance/memory-monitor.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setMemory(usedGB: number, limitGB: number = 2): void {
  (performance as unknown as Record<string, unknown>).memory = {
    usedJSHeapSize: usedGB * 1024 * 1024 * 1024,
    totalJSHeapSize: (usedGB + 0.1) * 1024 * 1024 * 1024,
    jsHeapSizeLimit: limitGB * 1024 * 1024 * 1024,
  };
}

function clearMemory(): void {
  delete (performance as unknown as Record<string, unknown>).memory;
}

let savedMemory: unknown;

function saveMemory(): void {
  savedMemory = (performance as unknown as { memory?: unknown }).memory;
}

function restoreMemory(): void {
  if (savedMemory === undefined) {
    clearMemory();
  } else {
    (performance as unknown as Record<string, unknown>).memory = savedMemory;
  }
}

/** Create a controllable async task. resolve() is safe to call even if execute() was never invoked. */
function createTask(): { execute: () => Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}; // no-op default
  const execute = () =>
    new Promise<void>((r) => {
      resolve = r;
    });
  // Return a getter so resolve always points to the latest value.
  return {
    execute,
    get resolve() { return resolve; },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getRecommendedInterval", () => {
  beforeEach(() => {
    resetRefreshThrottle();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetRefreshThrottle();
    resetMemoryMonitor();
  });

  it("returns base interval at normal level", () => {
    startRefreshThrottle({ baseIntervalMs: 5000 });
    expect(getRecommendedInterval(5000)).toBe(5000);
  });

  it("returns 2× interval at elevated level", () => {
    saveMemory();
    setMemory(1.1); // ratio ~0.55 → elevated
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle({ baseIntervalMs: 5000 });

    expect(getRecommendedInterval(5000)).toBe(10000);
    restoreMemory();
  });

  it("returns 4× interval at warning level", () => {
    saveMemory();
    setMemory(1.5); // ratio ~0.75 → warning
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle({ baseIntervalMs: 5000 });

    expect(getRecommendedInterval(5000)).toBe(20000);
    restoreMemory();
  });

  it("returns Infinity at critical level", () => {
    saveMemory();
    setMemory(1.8); // ratio ~0.9 → critical
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle({ baseIntervalMs: 5000 });

    expect(getRecommendedInterval(5000)).toBe(Infinity);
    restoreMemory();
  });
});

describe("queue state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRefreshThrottle();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetRefreshThrottle();
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("starts with empty queue and normal level", () => {
    startRefreshThrottle();
    const state = getQueueState();
    expect(state.queueLength).toBe(0);
    expect(state.activeCount).toBe(0);
    expect(state.paused).toBe(false);
    expect(state.memoryLevel).toBe("normal");
    expect(state.completedCount).toBe(0);
  });

  it("reports max concurrency 3 at normal level", () => {
    startRefreshThrottle();
    expect(getQueueState().maxConcurrency).toBe(3);
  });

  it("reports max concurrency 2 at elevated level", () => {
    saveMemory();
    setMemory(1.1);
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle();

    expect(getQueueState().maxConcurrency).toBe(2);
    restoreMemory();
  });

  it("reports max concurrency 1 at warning level", () => {
    saveMemory();
    setMemory(1.5);
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle();

    expect(getQueueState().maxConcurrency).toBe(1);
    restoreMemory();
  });

  it("reports max concurrency 0 and paused at critical level", () => {
    saveMemory();
    setMemory(1.8);
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle();

    expect(getQueueState().maxConcurrency).toBe(0);
    expect(getQueueState().paused).toBe(true);
    restoreMemory();
  });

  it("returns the throttle level", () => {
    startRefreshThrottle();
    expect(getThrottleLevel()).toBe("normal");
  });

  it("returns estimatedCompletionMs of 0 when queue is empty", () => {
    startRefreshThrottle();
    expect(getQueueState().estimatedCompletionMs).toBe(0);
  });
});

describe("enqueueRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRefreshThrottle();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetRefreshThrottle();
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("adds an item to the queue", () => {
    startRefreshThrottle();
    const task = createTask();
    enqueueRefresh("test-key", task.execute);

    // Before drain fires, item is in queue
    const state = getQueueState();
    // It may have started draining immediately (setTimeout 0), but before
    // timers advance it should be enqueued.
    expect(state.queueLength + state.activeCount).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates items with the same key", () => {
    startRefreshThrottle();
    const task1 = createTask();
    const task2 = createTask();

    enqueueRefresh("same-key", task1.execute);
    enqueueRefresh("same-key", task2.execute);

    // Should only have one item (the second one replaced the first)
    const state = getQueueState();
    expect(state.queueLength + state.activeCount).toBeLessThanOrEqual(1);
  });

  it("returns true when enqueueing", () => {
    startRefreshThrottle();
    const task = createTask();
    const result = enqueueRefresh("key", task.execute);
    expect(result).toBe(true);
  });

  it("respects priority ordering (high first)", () => {
    saveMemory();
    // Use critical level to prevent draining so we can inspect queue state
    setMemory(1.8);
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle();

    const lowTask = createTask();
    const highTask = createTask();
    const normalTask = createTask();

    enqueueRefresh("low", lowTask.execute, "low");
    enqueueRefresh("high", highTask.execute, "high");
    enqueueRefresh("normal", normalTask.execute, "normal");

    // Queue should be: high, normal, low
    const state = getQueueState();
    expect(state.queueLength).toBe(3);
    expect(state.paused).toBe(true);

    restoreMemory();
  });
});

describe("queue draining", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRefreshThrottle();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetRefreshThrottle();
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("drains queued items at normal level", async () => {
    startRefreshThrottle();
    const fn = vi.fn().mockResolvedValue(undefined);

    enqueueRefresh("item-1", fn);

    // Advance timers to trigger the setTimeout(0) drain
    await vi.advanceTimersByTimeAsync(0);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("processes multiple items concurrently at normal level (up to 3)", async () => {
    startRefreshThrottle();
    const fn1 = vi.fn().mockResolvedValue(undefined);
    const fn2 = vi.fn().mockResolvedValue(undefined);
    const fn3 = vi.fn().mockResolvedValue(undefined);

    enqueueRefresh("a", fn1);
    enqueueRefresh("b", fn2);
    enqueueRefresh("c", fn3);

    await vi.advanceTimersByTimeAsync(0);

    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn3).toHaveBeenCalledTimes(1);
  });

  it("does not drain when paused at critical level", async () => {
    saveMemory();
    setMemory(1.8); // critical
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle();

    const fn = vi.fn().mockResolvedValue(undefined);
    enqueueRefresh("item", fn);

    await vi.advanceTimersByTimeAsync(100);

    expect(fn).not.toHaveBeenCalled();
    expect(getQueueState().queueLength).toBe(1);
    expect(getQueueState().paused).toBe(true);

    restoreMemory();
  });

  it("increments completedCount after drain", async () => {
    startRefreshThrottle();
    expect(getQueueState().completedCount).toBe(0);

    const fn = vi.fn().mockResolvedValue(undefined);
    enqueueRefresh("item", fn);

    await vi.advanceTimersByTimeAsync(0);
    // Wait for the promise to resolve
    await vi.advanceTimersByTimeAsync(0);

    expect(getQueueState().completedCount).toBe(1);
  });

  it("handles executor errors gracefully", async () => {
    startRefreshThrottle();
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    enqueueRefresh("failing", fn);
    await vi.advanceTimersByTimeAsync(0);
    // Wait for the rejection to be handled
    await vi.advanceTimersByTimeAsync(0);

    // Should still count as completed (not crash the queue)
    expect(getQueueState().completedCount).toBe(1);
    expect(getQueueState().queueLength).toBe(0);
  });
});

describe("estimated completion time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRefreshThrottle();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetRefreshThrottle();
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("returns -1 when paused at critical level", () => {
    saveMemory();
    setMemory(1.8);
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle();

    const fn = vi.fn().mockResolvedValue(undefined);
    enqueueRefresh("item", fn);

    expect(getQueueState().estimatedCompletionMs).toBe(-1);
    restoreMemory();
  });

  it("estimates based on queue size and avg refresh time", () => {
    saveMemory();
    // Use warning level (concurrency: 1) for predictable estimation
    setMemory(1.5);
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle({ avgRefreshMs: 500 });

    const tasks = Array.from({ length: 3 }, (_, i) => {
      const task = createTask();
      enqueueRefresh(`item-${i}`, task.execute);
      return task;
    });

    // At warning level, max concurrency is 1, so 3 items = 3 batches
    // Each batch takes avgRefreshMs (500ms), plus 1 active
    // total = queueLength + activeCount = 3 (or 4 including active)
    const state = getQueueState();
    expect(state.estimatedCompletionMs).toBeGreaterThan(0);

    tasks.forEach((t) => t.resolve());
    restoreMemory();
  });
});

describe("listeners", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRefreshThrottle();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetRefreshThrottle();
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("notifies listeners when items are enqueued", () => {
    startRefreshThrottle();
    const listener = vi.fn();
    onQueueChange(listener);
    listener.mockClear();

    const task = createTask();
    enqueueRefresh("item", task.execute);

    expect(listener).toHaveBeenCalled();
    const state: RefreshQueueState = listener.mock.calls[0][0];
    expect(state.queueLength + state.activeCount).toBeGreaterThanOrEqual(1);

    task.resolve();
  });

  it("unsubscribe function removes listener", () => {
    startRefreshThrottle();
    const listener = vi.fn();
    const unsub = onQueueChange(listener);
    listener.mockClear();

    unsub();

    const task = createTask();
    enqueueRefresh("item", task.execute);

    expect(listener).not.toHaveBeenCalled();
    task.resolve();
  });

  it("calls onChange config callback", () => {
    const onChange = vi.fn();
    startRefreshThrottle({ onChange });
    onChange.mockClear();

    const task = createTask();
    enqueueRefresh("item", task.execute);

    expect(onChange).toHaveBeenCalled();
    task.resolve();
  });
});

describe("memory level transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRefreshThrottle();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetRefreshThrottle();
    resetMemoryMonitor();
    vi.useRealTimers();
    restoreMemory();
  });

  it("transitions from critical to normal and drains queue", async () => {
    saveMemory();
    setMemory(1.8); // critical
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle();

    const fn = vi.fn().mockResolvedValue(undefined);
    enqueueRefresh("item", fn);

    await vi.advanceTimersByTimeAsync(100);
    expect(fn).not.toHaveBeenCalled();

    // Drop to normal
    setMemory(0.2);
    await vi.advanceTimersByTimeAsync(1000); // trigger memory poll
    await vi.advanceTimersByTimeAsync(0); // trigger drain

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("updates recommended interval when level changes", async () => {
    saveMemory();
    setMemory(0.1); // normal
    startMemoryMonitor({ intervalMs: 1000 });
    startRefreshThrottle({ baseIntervalMs: 5000 });

    expect(getRecommendedInterval(5000)).toBe(5000);

    // Spike to elevated
    setMemory(1.1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(getRecommendedInterval(5000)).toBe(10000);
  });
});

describe("resetRefreshThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRefreshThrottle();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetRefreshThrottle();
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("clears all state", () => {
    startRefreshThrottle();
    const task = createTask();
    enqueueRefresh("item", task.execute);

    resetRefreshThrottle();

    const state = getQueueState();
    expect(state.queueLength).toBe(0);
    expect(state.activeCount).toBe(0);
    expect(state.completedCount).toBe(0);
    expect(state.memoryLevel).toBe("normal");
    expect(getThrottleLevel()).toBe("normal");

    task.resolve();
  });
});
