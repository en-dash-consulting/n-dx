import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatQueueStatus, formatQueueStatusJson } from "../../../src/queue/format.js";
import type { QueueStatus } from "../../../src/queue/execution-queue.js";

describe("formatQueueStatus", () => {
  it("returns empty array when queue is idle", () => {
    const status: QueueStatus = {
      maxConcurrent: 4,
      activeCount: 0,
      queuedCount: 0,
      accepting: true,
      queued: [],
    };
    expect(formatQueueStatus(status)).toEqual([]);
  });

  it("shows active count when tasks are running", () => {
    const status: QueueStatus = {
      maxConcurrent: 4,
      activeCount: 2,
      queuedCount: 0,
      accepting: true,
      queued: [],
    };
    const lines = formatQueueStatus(status);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("2/4 slots active");
    expect(lines[0]).toContain("0 queued");
  });

  it("shows queued tasks with position and priority", () => {
    const now = new Date().toISOString();
    const status: QueueStatus = {
      maxConcurrent: 2,
      activeCount: 2,
      queuedCount: 2,
      accepting: true,
      queued: [
        { taskId: "task-1", priority: "high", enqueuedAt: now, position: 1 },
        { taskId: "task-2", priority: "low", enqueuedAt: now, position: 2 },
      ],
    };
    const lines = formatQueueStatus(status);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toContain("2/2 slots active");
    expect(lines[0]).toContain("2 queued");
    expect(lines.some((l) => l.includes("task-1"))).toBe(true);
    expect(lines.some((l) => l.includes("[high]"))).toBe(true);
    expect(lines.some((l) => l.includes("task-2"))).toBe(true);
    expect(lines.some((l) => l.includes("[low]"))).toBe(true);
  });

  it("shows draining warning when not accepting", () => {
    const status: QueueStatus = {
      maxConcurrent: 2,
      activeCount: 1,
      queuedCount: 0,
      accepting: false,
      queued: [],
    };
    const lines = formatQueueStatus(status);
    expect(lines.some((l) => l.includes("draining"))).toBe(true);
  });
});

describe("formatQueueStatusJson", () => {
  it("returns the status object unchanged", () => {
    const status: QueueStatus = {
      maxConcurrent: 4,
      activeCount: 1,
      queuedCount: 0,
      accepting: true,
      queued: [],
    };
    expect(formatQueueStatusJson(status)).toEqual(status);
  });
});
