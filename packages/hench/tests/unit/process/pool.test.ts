import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RuntimePool,
  PoolExhaustedError,
  DEFAULT_RUNTIME_POOL_CONFIG,
} from "../../../src/process/pool.js";
import type {
  WorkerHandle,
  WorkerFactory,
  PooledRuntime,
  RuntimePoolConfig,
  RuntimePoolStatus,
} from "../../../src/process/pool.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let nextPid = 1000;

/** Create a mock WorkerHandle with configurable behavior. */
function createMockHandle(overrides?: Partial<WorkerHandle>): WorkerHandle {
  const pid = nextPid++;
  return {
    pid,
    connected: true,
    kill: vi.fn(() => true),
    ...overrides,
  };
}

/** Create a WorkerFactory that returns mock handles. */
function createMockFactory(): WorkerFactory & { handles: WorkerHandle[] } {
  const handles: WorkerHandle[] = [];
  const factory = (() => {
    const handle = createMockHandle();
    handles.push(handle);
    return handle;
  }) as WorkerFactory & { handles: WorkerHandle[] };
  factory.handles = handles;
  return factory;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RuntimePool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    nextPid = 1000;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe("constructor", () => {
    it("creates a pool with default config", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory);

      expect(pool.config.maxWorkers).toBe(DEFAULT_RUNTIME_POOL_CONFIG.maxWorkers);
      expect(pool.config.idleTimeoutMs).toBe(DEFAULT_RUNTIME_POOL_CONFIG.idleTimeoutMs);
      expect(pool.config.maxTasksPerWorker).toBe(DEFAULT_RUNTIME_POOL_CONFIG.maxTasksPerWorker);
      expect(pool.size).toBe(0);
      expect(pool.accepting).toBe(true);
    });

    it("accepts custom config overrides", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 5,
        idleTimeoutMs: 60_000,
        maxTasksPerWorker: 20,
      });

      expect(pool.config.maxWorkers).toBe(5);
      expect(pool.config.idleTimeoutMs).toBe(60_000);
      expect(pool.config.maxTasksPerWorker).toBe(20);
    });

    it("throws RangeError for maxWorkers < 1", () => {
      const factory = createMockFactory();
      expect(() => new RuntimePool(factory, { maxWorkers: 0 })).toThrow(RangeError);
      expect(() => new RuntimePool(factory, { maxWorkers: -1 })).toThrow(RangeError);
    });

    it("throws RangeError for negative idleTimeoutMs", () => {
      const factory = createMockFactory();
      expect(() => new RuntimePool(factory, { idleTimeoutMs: -1 })).toThrow(RangeError);
    });

    it("accepts idleTimeoutMs of 0 (no timeout)", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { idleTimeoutMs: 0 });
      expect(pool.config.idleTimeoutMs).toBe(0);
    });

    it("throws RangeError for maxTasksPerWorker < 1", () => {
      const factory = createMockFactory();
      expect(() => new RuntimePool(factory, { maxTasksPerWorker: 0 })).toThrow(RangeError);
      expect(() => new RuntimePool(factory, { maxTasksPerWorker: -1 })).toThrow(RangeError);
    });

    it("accepts maxWorkers of 1", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 1 });
      expect(pool.config.maxWorkers).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // acquire
  // -----------------------------------------------------------------------

  describe("acquire", () => {
    it("creates a new worker when pool is empty", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const runtime = pool.acquire();

      expect(runtime).toBeDefined();
      expect(runtime.id).toMatch(/^worker-\d+$/);
      expect(runtime.handle).toBeDefined();
      expect(runtime.handle.pid).toBe(1000);
      expect(runtime.tasksCompleted).toBe(0);
      expect(runtime.createdAt).toBeDefined();
      expect(pool.size).toBe(1);
      expect(pool.busyCount).toBe(1);
      expect(pool.idleCount).toBe(0);
    });

    it("creates multiple workers up to maxWorkers", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const r1 = pool.acquire();
      const r2 = pool.acquire();
      const r3 = pool.acquire();

      expect(pool.size).toBe(3);
      expect(pool.busyCount).toBe(3);
      expect(factory.handles).toHaveLength(3);
      expect(r1.id).not.toBe(r2.id);
      expect(r2.id).not.toBe(r3.id);
    });

    it("reuses idle workers instead of creating new ones", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      // Create and release a worker
      const r1 = pool.acquire();
      const r1Id = r1.id;
      pool.release(r1);

      expect(pool.idleCount).toBe(1);
      expect(pool.busyCount).toBe(0);

      // Acquire again — should get the same worker back
      const r2 = pool.acquire();
      expect(r2.id).toBe(r1Id);
      expect(factory.handles).toHaveLength(1); // no new process created
      expect(pool.busyCount).toBe(1);
      expect(pool.idleCount).toBe(0);
    });

    it("throws PoolExhaustedError when all workers are busy", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 2 });

      pool.acquire();
      pool.acquire();

      expect(() => pool.acquire()).toThrow(PoolExhaustedError);

      try {
        pool.acquire();
      } catch (err) {
        const error = err as PoolExhaustedError;
        expect(error.maxWorkers).toBe(2);
        expect(error.busyCount).toBe(2);
        expect(error.message).toContain("all 2 worker(s) are busy");
      }
    });

    it("throws when pool is shutting down", async () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 2 });

      await pool.shutdown();

      expect(() => pool.acquire()).toThrow("shutting down");
    });

    it("assigns unique IDs to each worker", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 5 });

      const ids = new Set<string>();
      for (let i = 0; i < 5; i++) {
        ids.add(pool.acquire().id);
      }

      expect(ids.size).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // release
  // -----------------------------------------------------------------------

  describe("release", () => {
    it("returns worker to idle pool", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const runtime = pool.acquire();
      expect(pool.busyCount).toBe(1);

      pool.release(runtime);
      expect(pool.busyCount).toBe(0);
      expect(pool.idleCount).toBe(1);
      expect(pool.size).toBe(1);
    });

    it("increments tasksCompleted on release", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const runtime = pool.acquire();
      expect(runtime.tasksCompleted).toBe(0);

      pool.release(runtime);

      // Re-acquire the same worker
      const reused = pool.acquire();
      expect(reused.tasksCompleted).toBe(1);
    });

    it("throws when releasing a runtime that is not busy", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const runtime = pool.acquire();
      pool.release(runtime);

      // Double release
      expect(() => pool.release(runtime)).toThrow("not busy");
    });

    it("throws when releasing an unknown runtime", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const fakeRuntime: PooledRuntime = {
        id: "fake-worker",
        handle: createMockHandle(),
        tasksCompleted: 0,
        createdAt: new Date().toISOString(),
      };

      expect(() => pool.release(fakeRuntime)).toThrow("not busy");
    });

    it("tracks totalTasksCompleted across all workers", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 2 });

      // Worker 1: 2 tasks
      let r = pool.acquire();
      pool.release(r);
      r = pool.acquire();
      pool.release(r);

      // Worker 2: 1 task
      r = pool.acquire();
      const r2 = pool.acquire();
      pool.release(r);
      pool.release(r2);

      const status = pool.status();
      expect(status.totalTasksCompleted).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // Worker recycling (maxTasksPerWorker)
  // -----------------------------------------------------------------------

  describe("worker recycling", () => {
    it("recycles a worker after maxTasksPerWorker", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 2,
        maxTasksPerWorker: 3,
      });

      // Use the same worker for 3 tasks
      let runtime = pool.acquire();
      const firstId = runtime.id;
      pool.release(runtime); // task 1

      runtime = pool.acquire();
      expect(runtime.id).toBe(firstId);
      pool.release(runtime); // task 2

      runtime = pool.acquire();
      expect(runtime.id).toBe(firstId);
      pool.release(runtime); // task 3 → recycled

      // Worker should be terminated (kill called) and pool empty
      expect(pool.size).toBe(0);
      expect(pool.idleCount).toBe(0);
      expect(factory.handles[0].kill).toHaveBeenCalled();
    });

    it("creates a fresh worker after recycling", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 2,
        maxTasksPerWorker: 1,
      });

      // First acquire+release: worker is recycled after 1 task
      const r1 = pool.acquire();
      const firstId = r1.id;
      pool.release(r1);

      expect(pool.size).toBe(0);

      // Second acquire: new worker created
      const r2 = pool.acquire();
      expect(r2.id).not.toBe(firstId);
      expect(factory.handles).toHaveLength(2);
    });

    it("tracks totalWorkersRecycled", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 2,
        maxTasksPerWorker: 1,
      });

      const r1 = pool.acquire();
      pool.release(r1); // recycled

      const r2 = pool.acquire();
      pool.release(r2); // recycled

      const status = pool.status();
      expect(status.totalWorkersRecycled).toBe(2);
      expect(status.totalWorkersCreated).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Idle timeout
  // -----------------------------------------------------------------------

  describe("idle timeout", () => {
    it("terminates idle workers after timeout", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 3,
        idleTimeoutMs: 60_000,
      });

      const runtime = pool.acquire();
      pool.release(runtime);

      expect(pool.idleCount).toBe(1);
      expect(pool.size).toBe(1);

      // Advance past idle timeout
      vi.advanceTimersByTime(60_001);

      expect(pool.idleCount).toBe(0);
      expect(pool.size).toBe(0);
      expect(factory.handles[0].kill).toHaveBeenCalled();
    });

    it("does not terminate workers before timeout", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 3,
        idleTimeoutMs: 60_000,
      });

      const runtime = pool.acquire();
      pool.release(runtime);

      // Advance less than timeout
      vi.advanceTimersByTime(30_000);

      expect(pool.idleCount).toBe(1);
      expect(pool.size).toBe(1);
      expect(factory.handles[0].kill).not.toHaveBeenCalled();
    });

    it("cancels idle timer when worker is reacquired", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 3,
        idleTimeoutMs: 60_000,
      });

      const runtime = pool.acquire();
      pool.release(runtime);

      // Reacquire before timeout fires
      vi.advanceTimersByTime(30_000);
      const reacquired = pool.acquire();
      expect(reacquired.id).toBe(runtime.id);

      // Advance past original timeout — should NOT terminate
      vi.advanceTimersByTime(60_000);

      expect(pool.busyCount).toBe(1);
      expect(factory.handles[0].kill).not.toHaveBeenCalled();
    });

    it("does not set idle timer when idleTimeoutMs is 0", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 3,
        idleTimeoutMs: 0,
      });

      const runtime = pool.acquire();
      pool.release(runtime);

      // Advance a long time — worker should still be idle
      vi.advanceTimersByTime(999_999);

      expect(pool.idleCount).toBe(1);
      expect(factory.handles[0].kill).not.toHaveBeenCalled();
    });

    it("counts idle timeout terminations as recycled", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 3,
        idleTimeoutMs: 10_000,
      });

      const r1 = pool.acquire();
      const r2 = pool.acquire();
      pool.release(r1);
      pool.release(r2);

      vi.advanceTimersByTime(10_001);

      const status = pool.status();
      expect(status.totalWorkersRecycled).toBe(2);
      expect(status.totalWorkers).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Shutdown
  // -----------------------------------------------------------------------

  describe("shutdown", () => {
    it("terminates all idle workers", async () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const r1 = pool.acquire();
      const r2 = pool.acquire();
      pool.release(r1);
      pool.release(r2);

      expect(pool.idleCount).toBe(2);

      await pool.shutdown();

      expect(pool.idleCount).toBe(0);
      expect(pool.accepting).toBe(false);
      expect(factory.handles[0].kill).toHaveBeenCalled();
      expect(factory.handles[1].kill).toHaveBeenCalled();
    });

    it("marks busy workers for draining", async () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const r1 = pool.acquire();
      const _r2 = pool.acquire();

      await pool.shutdown();

      // Busy workers are still tracked (not terminated yet)
      expect(pool.busyCount).toBe(2);

      const status = pool.status();
      const busyWorkers = status.workers.filter((w) => w.state === "draining");
      expect(busyWorkers).toHaveLength(2);

      // Releasing after shutdown terminates the worker
      pool.release(r1);
      expect(pool.busyCount).toBe(1);
      expect(pool.idleCount).toBe(0); // not returned to idle
    });

    it("prevents new acquisitions", async () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      await pool.shutdown();

      expect(() => pool.acquire()).toThrow("shutting down");
    });

    it("is safe to call multiple times", async () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      await pool.shutdown();
      await pool.shutdown(); // should not throw
    });

    it("clears idle timers", async () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 3,
        idleTimeoutMs: 60_000,
      });

      const r = pool.acquire();
      pool.release(r);

      await pool.shutdown();

      // Advance past timeout — no double-kill
      vi.advanceTimersByTime(120_000);
      // kill should be called once (by shutdown), not again by timer
      expect(factory.handles[0].kill).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // status
  // -----------------------------------------------------------------------

  describe("status", () => {
    it("returns correct initial state", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const status = pool.status();

      expect(status.maxWorkers).toBe(3);
      expect(status.totalWorkers).toBe(0);
      expect(status.idleCount).toBe(0);
      expect(status.busyCount).toBe(0);
      expect(status.totalTasksCompleted).toBe(0);
      expect(status.totalWorkersCreated).toBe(0);
      expect(status.totalWorkersRecycled).toBe(0);
      expect(status.accepting).toBe(true);
      expect(status.workers).toEqual([]);
    });

    it("reflects active and idle workers", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const r1 = pool.acquire();
      const _r2 = pool.acquire();
      pool.release(r1);

      const status = pool.status();

      expect(status.totalWorkers).toBe(2);
      expect(status.idleCount).toBe(1);
      expect(status.busyCount).toBe(1);
      expect(status.workers).toHaveLength(2);

      const idle = status.workers.find((w) => w.state === "idle");
      const busy = status.workers.find((w) => w.state === "busy");
      expect(idle).toBeDefined();
      expect(busy).toBeDefined();
      expect(idle!.tasksCompleted).toBe(1);
      expect(busy!.tasksCompleted).toBe(0);
    });

    it("returns serializable data (no functions)", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 2 });

      pool.acquire();

      const status = pool.status();
      const json = JSON.stringify(status);
      const parsed = JSON.parse(json) as RuntimePoolStatus;

      expect(parsed.maxWorkers).toBe(2);
      expect(parsed.workers).toHaveLength(1);
    });

    it("tracks cumulative metrics", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 2,
        maxTasksPerWorker: 2,
      });

      // 4 tasks across 2 workers (each recycled after 2 tasks)
      let r = pool.acquire();
      pool.release(r); // worker-1 task 1
      r = pool.acquire();
      pool.release(r); // worker-1 task 2 → recycled

      r = pool.acquire();
      pool.release(r); // worker-2 task 1
      r = pool.acquire();
      pool.release(r); // worker-2 task 2 → recycled

      const status = pool.status();
      expect(status.totalTasksCompleted).toBe(4);
      expect(status.totalWorkersCreated).toBe(2);
      expect(status.totalWorkersRecycled).toBe(2);
      expect(status.totalWorkers).toBe(0); // all recycled
    });
  });

  // -----------------------------------------------------------------------
  // Worker reuse (memory savings validation)
  // -----------------------------------------------------------------------

  describe("worker reuse for memory reduction", () => {
    it("reuses workers for sequential tasks (no factory calls)", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 2,
        maxTasksPerWorker: 100,
      });

      // 10 sequential tasks on a single worker
      for (let i = 0; i < 10; i++) {
        const r = pool.acquire();
        pool.release(r);
      }

      // Only 1 worker process created despite 10 tasks
      expect(factory.handles).toHaveLength(1);
      expect(pool.status().totalTasksCompleted).toBe(10);
      expect(pool.status().totalWorkersCreated).toBe(1);
    });

    it("maintains task isolation via recycling boundary", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 2,
        maxTasksPerWorker: 3,
      });

      // 6 sequential tasks → 2 workers (recycled every 3 tasks)
      for (let i = 0; i < 6; i++) {
        const r = pool.acquire();
        pool.release(r);
      }

      expect(factory.handles).toHaveLength(2);
      expect(pool.status().totalWorkersRecycled).toBe(2);
    });

    it("avoids process creation for concurrent reuse", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      // Acquire all 3 workers
      const runtimes = [pool.acquire(), pool.acquire(), pool.acquire()];
      expect(factory.handles).toHaveLength(3);

      // Release all
      runtimes.forEach((r) => pool.release(r));

      // Re-acquire all — should reuse, not create new
      const reused = [pool.acquire(), pool.acquire(), pool.acquire()];
      expect(factory.handles).toHaveLength(3); // still 3, no new creates

      reused.forEach((r) => pool.release(r));
    });
  });

  // -----------------------------------------------------------------------
  // Task isolation
  // -----------------------------------------------------------------------

  describe("task isolation", () => {
    it("each acquire returns a distinct handle reference", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const r1 = pool.acquire();
      const r2 = pool.acquire();

      expect(r1.handle).not.toBe(r2.handle);
      expect(r1.handle.pid).not.toBe(r2.handle.pid);
    });

    it("recycled workers get fresh handles", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 2,
        maxTasksPerWorker: 1,
      });

      const r1 = pool.acquire();
      const firstPid = r1.handle.pid;
      pool.release(r1); // recycled

      const r2 = pool.acquire();
      expect(r2.handle.pid).not.toBe(firstPid);
    });

    it("worker handles are independent (kill one doesn't affect others)", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 3 });

      const r1 = pool.acquire();
      const r2 = pool.acquire();

      // Terminate r1's handle directly
      r1.handle.kill();

      // r2's handle should be unaffected
      expect(r2.handle.kill).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("works with maxWorkers of 1 (serial pool)", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, { maxWorkers: 1 });

      const r = pool.acquire();
      expect(() => pool.acquire()).toThrow(PoolExhaustedError);

      pool.release(r);
      const r2 = pool.acquire(); // should succeed now
      expect(r2.id).toBe(r.id); // same worker reused
    });

    it("handles factory that returns handle with undefined pid", () => {
      const factory = () => createMockHandle({ pid: undefined });
      const pool = new RuntimePool(factory, { maxWorkers: 2 });

      const runtime = pool.acquire();
      expect(runtime.handle.pid).toBeUndefined();

      // Release should still work
      pool.release(runtime);
      expect(pool.idleCount).toBe(1);
    });

    it("handles kill() that throws", async () => {
      const factory = () =>
        createMockHandle({
          kill: vi.fn(() => {
            throw new Error("already terminated");
          }),
        });
      const pool = new RuntimePool(factory, { maxWorkers: 2 });

      const r = pool.acquire();
      // Shutdown should not throw even if kill fails
      await pool.shutdown();
      // Release after shutdown should not throw
      pool.release(r);
    });

    it("handles disconnected worker on terminate", async () => {
      const factory = () =>
        createMockHandle({
          connected: false,
          pid: undefined,
        });
      const pool = new RuntimePool(factory, { maxWorkers: 2 });

      const r = pool.acquire();
      pool.release(r);

      // Shutdown with disconnected worker should not throw
      await pool.shutdown();
    });

    it("large pool with many sequential tasks", () => {
      const factory = createMockFactory();
      const pool = new RuntimePool(factory, {
        maxWorkers: 10,
        maxTasksPerWorker: 100,
      });

      // 1000 sequential tasks on a single worker
      for (let i = 0; i < 1000; i++) {
        const r = pool.acquire();
        pool.release(r);
      }

      // 10 workers created (recycled every 100 tasks)
      expect(factory.handles).toHaveLength(10);
      expect(pool.status().totalTasksCompleted).toBe(1000);
      expect(pool.status().totalWorkersRecycled).toBe(10);
    });
  });
});

// ---------------------------------------------------------------------------
// PoolExhaustedError
// ---------------------------------------------------------------------------

describe("PoolExhaustedError", () => {
  it("has descriptive message", () => {
    const err = new PoolExhaustedError(3, 3);
    expect(err.message).toContain("all 3 worker(s) are busy");
    expect(err.message).toContain("pool.maxWorkers");
    expect(err.name).toBe("PoolExhaustedError");
    expect(err.maxWorkers).toBe(3);
    expect(err.busyCount).toBe(3);
  });

  it("is an instance of Error", () => {
    const err = new PoolExhaustedError(2, 2);
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_RUNTIME_POOL_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_RUNTIME_POOL_CONFIG", () => {
  it("has expected defaults", () => {
    expect(DEFAULT_RUNTIME_POOL_CONFIG.enabled).toBe(true);
    expect(DEFAULT_RUNTIME_POOL_CONFIG.maxWorkers).toBe(2);
    expect(DEFAULT_RUNTIME_POOL_CONFIG.idleTimeoutMs).toBe(300_000);
    expect(DEFAULT_RUNTIME_POOL_CONFIG.maxTasksPerWorker).toBe(10);
  });

  it("is frozen (immutable)", () => {
    expect(Object.isFrozen(DEFAULT_RUNTIME_POOL_CONFIG)).toBe(true);
  });
});
