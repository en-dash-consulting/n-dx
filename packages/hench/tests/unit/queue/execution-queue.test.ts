import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ExecutionQueue,
  normalizePriority,
} from "../../../src/queue/execution-queue.js";
import type { TaskPriority, QueueStatus } from "../../../src/queue/execution-queue.js";

describe("normalizePriority", () => {
  it("returns known priorities unchanged", () => {
    expect(normalizePriority("critical")).toBe("critical");
    expect(normalizePriority("high")).toBe("high");
    expect(normalizePriority("medium")).toBe("medium");
    expect(normalizePriority("low")).toBe("low");
  });

  it("defaults to medium for unknown strings", () => {
    expect(normalizePriority("urgent")).toBe("medium");
    expect(normalizePriority("")).toBe("medium");
  });

  it("defaults to medium for undefined", () => {
    expect(normalizePriority()).toBe("medium");
    expect(normalizePriority(undefined)).toBe("medium");
  });
});

describe("ExecutionQueue", () => {
  describe("constructor", () => {
    it("creates a queue with the given concurrency limit", () => {
      const q = new ExecutionQueue(3);
      expect(q.maxConcurrent).toBe(3);
      expect(q.active).toBe(0);
      expect(q.pending).toBe(0);
      expect(q.accepting).toBe(true);
    });

    it("throws RangeError for limit < 1", () => {
      expect(() => new ExecutionQueue(0)).toThrow(RangeError);
      expect(() => new ExecutionQueue(-1)).toThrow(RangeError);
    });

    it("accepts limit of 1", () => {
      const q = new ExecutionQueue(1);
      expect(q.maxConcurrent).toBe(1);
    });
  });

  describe("acquire / release basics", () => {
    it("grants a slot immediately when under limit", async () => {
      const q = new ExecutionQueue(2);
      await q.acquire("task-1");
      expect(q.active).toBe(1);
      expect(q.pending).toBe(0);
    });

    it("grants multiple slots up to the limit", async () => {
      const q = new ExecutionQueue(3);
      await q.acquire("task-1");
      await q.acquire("task-2");
      await q.acquire("task-3");
      expect(q.active).toBe(3);
      expect(q.pending).toBe(0);
    });

    it("release decrements active count", async () => {
      const q = new ExecutionQueue(2);
      await q.acquire("task-1");
      await q.acquire("task-2");
      expect(q.active).toBe(2);

      q.release();
      expect(q.active).toBe(1);

      q.release();
      expect(q.active).toBe(0);
    });

    it("throws on release with no active slots", () => {
      const q = new ExecutionQueue(2);
      expect(() => q.release()).toThrow("no active slots");
    });
  });

  describe("queuing when at limit", () => {
    it("queues a task when concurrency limit is reached", async () => {
      const q = new ExecutionQueue(1);
      await q.acquire("task-1"); // immediate

      // This will not resolve until a slot is released
      let resolved = false;
      const pending = q.acquire("task-2").then(() => { resolved = true; });

      // Let microtasks settle
      await Promise.resolve();
      expect(resolved).toBe(false);
      expect(q.active).toBe(1);
      expect(q.pending).toBe(1);

      // Release slot → task-2 should acquire
      q.release();
      await pending;
      expect(resolved).toBe(true);
      expect(q.active).toBe(1);
      expect(q.pending).toBe(0);
    });

    it("processes queued tasks in FIFO order (same priority)", async () => {
      const q = new ExecutionQueue(1);
      await q.acquire("task-1");

      const order: string[] = [];
      const p2 = q.acquire("task-2", "medium").then(() => { order.push("task-2"); });
      const p3 = q.acquire("task-3", "medium").then(() => { order.push("task-3"); });
      const p4 = q.acquire("task-4", "medium").then(() => { order.push("task-4"); });

      expect(q.pending).toBe(3);

      // Release slots one at a time
      q.release(); // → task-2
      await p2;
      q.release(); // → task-3
      await p3;
      q.release(); // → task-4
      await p4;

      expect(order).toEqual(["task-2", "task-3", "task-4"]);
    });

    it("handles slot transfer correctly (active count stays same)", async () => {
      const q = new ExecutionQueue(1);
      await q.acquire("task-1");

      const p2 = q.acquire("task-2");
      expect(q.active).toBe(1);
      expect(q.pending).toBe(1);

      // Release transfers the slot to task-2
      q.release();
      await p2;

      // Active count should still be 1 (slot transferred, not freed)
      expect(q.active).toBe(1);
      expect(q.pending).toBe(0);
    });
  });

  describe("priority override", () => {
    it("inserts higher-priority tasks before lower-priority ones", async () => {
      const q = new ExecutionQueue(1);
      await q.acquire("task-1");

      const order: string[] = [];
      const pLow = q.acquire("low-task", "low").then(() => { order.push("low-task"); });
      const pHigh = q.acquire("high-task", "high").then(() => { order.push("high-task"); });

      expect(q.pending).toBe(2);

      // Check status shows correct order
      const s = q.status();
      expect(s.queued[0].taskId).toBe("high-task");
      expect(s.queued[1].taskId).toBe("low-task");

      // Release both
      q.release();
      await Promise.resolve(); // let microtask settle
      q.release();
      await Promise.all([pLow, pHigh]);

      expect(order).toEqual(["high-task", "low-task"]);
    });

    it("critical jumps ahead of all others", async () => {
      const q = new ExecutionQueue(1);
      await q.acquire("task-1");

      const order: string[] = [];
      q.acquire("medium-1", "medium").then(() => { order.push("medium-1"); });
      q.acquire("low-1", "low").then(() => { order.push("low-1"); });
      q.acquire("critical-1", "critical").then(() => { order.push("critical-1"); });
      q.acquire("high-1", "high").then(() => { order.push("high-1"); });

      const s = q.status();
      // Priority insertion: critical > high > medium > low
      // high-1 is inserted before medium-1 because it has higher priority
      expect(s.queued.map((e) => e.taskId)).toEqual([
        "critical-1",
        "high-1",
        "medium-1",
        "low-1",
      ]);
    });

    it("maintains FIFO within the same priority level", async () => {
      const q = new ExecutionQueue(1);
      await q.acquire("task-1");

      const order: string[] = [];
      q.acquire("high-1", "high").then(() => { order.push("high-1"); });
      q.acquire("high-2", "high").then(() => { order.push("high-2"); });
      q.acquire("high-3", "high").then(() => { order.push("high-3"); });

      // Release all
      q.release();
      await Promise.resolve();
      q.release();
      await Promise.resolve();
      q.release();
      await Promise.resolve();

      // Allow all microtasks to settle
      await new Promise((r) => setTimeout(r, 10));

      expect(order).toEqual(["high-1", "high-2", "high-3"]);
    });
  });

  describe("status()", () => {
    it("returns correct status when empty", () => {
      const q = new ExecutionQueue(4);
      const s = q.status();
      expect(s).toEqual({
        maxConcurrent: 4,
        activeCount: 0,
        queuedCount: 0,
        accepting: true,
        queued: [],
      });
    });

    it("returns correct status with active and queued tasks", async () => {
      const q = new ExecutionQueue(1);
      await q.acquire("task-1");
      q.acquire("task-2", "high");

      const s = q.status();
      expect(s.maxConcurrent).toBe(1);
      expect(s.activeCount).toBe(1);
      expect(s.queuedCount).toBe(1);
      expect(s.accepting).toBe(true);
      expect(s.queued).toHaveLength(1);
      expect(s.queued[0].taskId).toBe("task-2");
      expect(s.queued[0].priority).toBe("high");
      expect(s.queued[0].position).toBe(1);
      expect(s.queued[0].enqueuedAt).toBeTruthy();
    });

    it("is serializable as JSON", async () => {
      const q = new ExecutionQueue(1);
      await q.acquire("task-1");
      q.acquire("task-2", "medium"); // queued (limit=1)

      const s = q.status();
      const json = JSON.stringify(s);
      const parsed = JSON.parse(json);
      expect(parsed.maxConcurrent).toBe(1);
      expect(parsed.activeCount).toBe(1);
      expect(parsed.queued).toHaveLength(1);
    });
  });

  describe("drain (graceful shutdown)", () => {
    it("rejects all pending tasks", async () => {
      const q = new ExecutionQueue(1);
      await q.acquire("task-1");

      const errors: Error[] = [];
      const p2 = q.acquire("task-2").catch((e) => { errors.push(e); });
      const p3 = q.acquire("task-3").catch((e) => { errors.push(e); });

      expect(q.pending).toBe(2);

      q.drain();

      await Promise.all([p2, p3]);
      expect(errors).toHaveLength(2);
      expect(errors[0].message).toContain("drained");
      expect(errors[1].message).toContain("drained");
      expect(q.pending).toBe(0);
    });

    it("prevents new tasks from being enqueued", async () => {
      const q = new ExecutionQueue(1);
      q.drain();

      await expect(q.acquire("task-1")).rejects.toThrow("draining");
    });

    it("sets accepting to false", () => {
      const q = new ExecutionQueue(2);
      expect(q.accepting).toBe(true);
      q.drain();
      expect(q.accepting).toBe(false);
    });

    it("does not interrupt active tasks", async () => {
      const q = new ExecutionQueue(1);
      await q.acquire("task-1");
      expect(q.active).toBe(1);

      q.drain();

      // Active task is still counted
      expect(q.active).toBe(1);

      // Can still release the active slot
      q.release();
      expect(q.active).toBe(0);
    });

    it("status reflects draining state", async () => {
      const q = new ExecutionQueue(1);
      await q.acquire("task-1");
      const p2 = q.acquire("task-2").catch(() => {}); // queued (limit=1)

      q.drain();
      await p2; // ensure rejection is handled

      const s = q.status();
      expect(s.accepting).toBe(false);
      expect(s.activeCount).toBe(1); // task-1 still active
      expect(s.queuedCount).toBe(0); // task-2 was rejected by drain
    });
  });

  describe("concurrent acquire/release stress", () => {
    it("handles rapid acquire/release cycles correctly", async () => {
      const q = new ExecutionQueue(3);
      const results: string[] = [];

      // Simulate 10 tasks competing for 3 slots
      const tasks = Array.from({ length: 10 }, (_, i) => `task-${i}`);

      const promises = tasks.map(async (id) => {
        await q.acquire(id);
        results.push(`start:${id}`);
        // Simulate brief async work
        await new Promise((r) => setTimeout(r, 1));
        results.push(`end:${id}`);
        q.release();
      });

      await Promise.all(promises);

      // All tasks should have started and ended
      expect(results.filter((r) => r.startsWith("start:"))).toHaveLength(10);
      expect(results.filter((r) => r.startsWith("end:"))).toHaveLength(10);
      expect(q.active).toBe(0);
      expect(q.pending).toBe(0);
    });

    it("never exceeds max concurrent active slots", async () => {
      const q = new ExecutionQueue(2);
      let maxObserved = 0;

      const tasks = Array.from({ length: 8 }, (_, i) => `task-${i}`);

      const promises = tasks.map(async (id) => {
        await q.acquire(id);
        if (q.active > maxObserved) maxObserved = q.active;
        // Simulate async work
        await new Promise((r) => setTimeout(r, Math.random() * 5));
        q.release();
      });

      await Promise.all(promises);
      expect(maxObserved).toBeLessThanOrEqual(2);
    });
  });

  describe("edge cases", () => {
    it("works with maxConcurrent=1 (serial queue)", async () => {
      const q = new ExecutionQueue(1);
      const order: number[] = [];

      const promises = Array.from({ length: 5 }, async (_, i) => {
        await q.acquire(`task-${i}`);
        order.push(i);
        await new Promise((r) => setTimeout(r, 1));
        q.release();
      });

      await Promise.all(promises);
      // First task (0) gets slot immediately, rest queue in FIFO
      expect(order[0]).toBe(0);
      expect(order).toHaveLength(5);
    });

    it("works with very large maxConcurrent (all immediate)", async () => {
      const q = new ExecutionQueue(100);

      await Promise.all(
        Array.from({ length: 50 }, (_, i) => q.acquire(`task-${i}`))
      );

      expect(q.active).toBe(50);
      expect(q.pending).toBe(0);

      // Release all
      for (let i = 0; i < 50; i++) q.release();
      expect(q.active).toBe(0);
    });

    it("drain is idempotent", () => {
      const q = new ExecutionQueue(2);
      q.drain();
      q.drain(); // should not throw
      expect(q.accepting).toBe(false);
    });
  });
});
