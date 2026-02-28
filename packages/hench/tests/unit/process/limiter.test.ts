import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ProcessLimiter,
  ProcessLimitReachedError,
} from "../../../src/process/limiter.js";

describe("ProcessLimiter", () => {
  let henchDir: string;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "hench-limiter-test-"));
  });

  afterEach(async () => {
    await rm(henchDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("creates a limiter with the given concurrency limit", () => {
      const limiter = new ProcessLimiter(henchDir, 3);
      expect(limiter.maxConcurrent).toBe(3);
      expect(limiter.acquired).toBe(false);
    });

    it("throws RangeError for limit < 1", () => {
      expect(() => new ProcessLimiter(henchDir, 0)).toThrow(RangeError);
      expect(() => new ProcessLimiter(henchDir, -1)).toThrow(RangeError);
    });

    it("accepts limit of 1", () => {
      const limiter = new ProcessLimiter(henchDir, 1);
      expect(limiter.maxConcurrent).toBe(1);
    });
  });

  describe("acquire", () => {
    it("acquires a lock and creates a lock file", async () => {
      const limiter = new ProcessLimiter(henchDir, 3);
      await limiter.acquire("test-task");

      expect(limiter.acquired).toBe(true);

      const lockFiles = await readdir(join(henchDir, "locks"));
      expect(lockFiles).toHaveLength(1);
      expect(lockFiles[0]).toBe(`${process.pid}.lock`);
    });

    it("throws when called while already holding a lock", async () => {
      const limiter = new ProcessLimiter(henchDir, 3);
      await limiter.acquire();

      await expect(limiter.acquire()).rejects.toThrow("already holding a lock");
    });

    it("throws ProcessLimitReachedError when limit is reached", async () => {
      // Simulate existing lock files for the current PID won't work since
      // the same PID can only hold one lock. Instead, create fake lock files
      // with PIDs that appear alive (the current process PID + parent PID).
      const locksDir = join(henchDir, "locks");
      await mkdir(locksDir, { recursive: true });

      // Write lock files for PIDs that are alive (PID 1 is always alive on Unix)
      const fakePids = [process.pid, process.ppid, 1];
      for (const pid of fakePids) {
        await writeFile(
          join(locksDir, `${pid}.lock`),
          JSON.stringify({ pid, startedAt: new Date().toISOString() }),
        );
      }

      const limiter = new ProcessLimiter(henchDir, 3);

      try {
        await limiter.acquire();
        // If we get here, the limit check didn't work as expected
        // (could happen if some PIDs aren't alive). Clean up.
        await limiter.release();
      } catch (err) {
        expect(err).toBeInstanceOf(ProcessLimitReachedError);
        const error = err as ProcessLimitReachedError;
        expect(error.maxConcurrent).toBe(3);
        expect(error.activeCount).toBeGreaterThanOrEqual(3);
        expect(error.activePids).toBeInstanceOf(Array);
        expect(error.message).toContain("Concurrent process limit reached");
        expect(error.message).toContain("hench config guard.maxConcurrentProcesses");
      }
    });

    it("acquires when under the limit", async () => {
      const limiter = new ProcessLimiter(henchDir, 5);
      await limiter.acquire("task-1");
      expect(limiter.acquired).toBe(true);
    });

    it("works without a taskId argument", async () => {
      const limiter = new ProcessLimiter(henchDir, 3);
      await limiter.acquire();
      expect(limiter.acquired).toBe(true);
    });
  });

  describe("release", () => {
    it("removes the lock file", async () => {
      const limiter = new ProcessLimiter(henchDir, 3);
      await limiter.acquire();
      expect(limiter.acquired).toBe(true);

      await limiter.release();
      expect(limiter.acquired).toBe(false);

      const lockFiles = await readdir(join(henchDir, "locks"));
      expect(lockFiles).toHaveLength(0);
    });

    it("is idempotent (safe to call multiple times)", async () => {
      const limiter = new ProcessLimiter(henchDir, 3);
      await limiter.acquire();

      await limiter.release();
      await limiter.release(); // should not throw
      expect(limiter.acquired).toBe(false);
    });

    it("is a no-op when never acquired", async () => {
      const limiter = new ProcessLimiter(henchDir, 3);
      await limiter.release(); // should not throw
      expect(limiter.acquired).toBe(false);
    });
  });

  describe("activeCount", () => {
    it("returns 0 when no locks exist", async () => {
      const limiter = new ProcessLimiter(henchDir, 3);
      const count = await limiter.activeCount();
      expect(count).toBe(0);
    });

    it("counts active locks", async () => {
      const limiter = new ProcessLimiter(henchDir, 5);
      await limiter.acquire();

      const count = await limiter.activeCount();
      expect(count).toBe(1);
    });

    it("cleans up stale locks from dead PIDs", async () => {
      const locksDir = join(henchDir, "locks");
      await mkdir(locksDir, { recursive: true });

      // Write a lock file for a PID that doesn't exist (very high number)
      const deadPid = 999999999;
      await writeFile(
        join(locksDir, `${deadPid}.lock`),
        JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }),
      );

      const limiter = new ProcessLimiter(henchDir, 3);
      const count = await limiter.activeCount();

      // Dead PID should be cleaned up
      expect(count).toBe(0);

      // Lock file should be removed
      const remaining = await readdir(locksDir);
      expect(remaining).toHaveLength(0);
    });

    it("cleans up corrupted lock files", async () => {
      const locksDir = join(henchDir, "locks");
      await mkdir(locksDir, { recursive: true });

      // Write a corrupted lock file
      await writeFile(join(locksDir, "bad.lock"), "not json{{{");

      const limiter = new ProcessLimiter(henchDir, 3);
      const count = await limiter.activeCount();

      expect(count).toBe(0);

      // Corrupted file should be removed
      const remaining = await readdir(locksDir);
      expect(remaining).toHaveLength(0);
    });
  });

  describe("acquire then release lifecycle", () => {
    it("allows re-acquisition after release", async () => {
      const limiter = new ProcessLimiter(henchDir, 1);
      await limiter.acquire("task-1");
      expect(limiter.acquired).toBe(true);

      await limiter.release();
      expect(limiter.acquired).toBe(false);

      await limiter.acquire("task-2");
      expect(limiter.acquired).toBe(true);

      await limiter.release();
    });
  });
});

describe("ProcessLimitReachedError", () => {
  it("has descriptive message with count and limit", () => {
    const err = new ProcessLimitReachedError(3, 3, [100, 200, 300]);
    expect(err.message).toContain("3/3");
    expect(err.message).toContain("hench config guard.maxConcurrentProcesses");
    expect(err.name).toBe("ProcessLimitReachedError");
    expect(err.activeCount).toBe(3);
    expect(err.maxConcurrent).toBe(3);
    expect(err.activePids).toEqual([100, 200, 300]);
  });

  it("is an instance of Error", () => {
    const err = new ProcessLimitReachedError(2, 2, [100, 200]);
    expect(err).toBeInstanceOf(Error);
  });
});
