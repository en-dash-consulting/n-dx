import { describe, it, expect } from "vitest";
import { getTaskDuration } from "../../../src/core/durations.js";
import type { PRDItem } from "../../../src/schema/v1.js";

/**
 * Build a partial PRDItem for duration calculations. Only the fields read by
 * `getTaskDuration` need to be present.
 */
function makeItem(fields: Partial<PRDItem> & { status: PRDItem["status"] }): PRDItem {
  return {
    id: "test",
    title: "test",
    level: "task",
    ...fields,
  } as PRDItem;
}

const NOW = Date.parse("2026-01-01T00:10:00.000Z"); // 10 minutes past midnight

describe("getTaskDuration", () => {
  it("returns zero for a never-started pending task", () => {
    const item = makeItem({ status: "pending" });
    expect(getTaskDuration(item, NOW)).toEqual({ elapsedMs: 0, isRunning: false });
  });

  it("returns zero for a pending task with no intervals and no startedAt", () => {
    const item = makeItem({ status: "pending", activeIntervals: [] });
    expect(getTaskDuration(item, NOW)).toEqual({ elapsedMs: 0, isRunning: false });
  });

  it("reports elapsed time for a running task with one open interval", () => {
    const item = makeItem({
      status: "in_progress",
      startedAt: "2026-01-01T00:05:00.000Z",
      activeIntervals: [{ start: "2026-01-01T00:05:00.000Z" }],
    });
    // Open interval runs from 00:05 to NOW (00:10) = 5 minutes
    expect(getTaskDuration(item, NOW)).toEqual({
      elapsedMs: 5 * 60 * 1000,
      isRunning: true,
    });
  });

  it("reports total elapsed time for a completed task", () => {
    const item = makeItem({
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:03:00.000Z",
      endedAt: "2026-01-01T00:03:00.000Z",
      activeIntervals: [
        { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:03:00.000Z" },
      ],
    });
    expect(getTaskDuration(item, NOW)).toEqual({
      elapsedMs: 3 * 60 * 1000,
      isRunning: false,
    });
  });

  it("sums all intervals for a re-opened task currently running", () => {
    const item = makeItem({
      status: "in_progress",
      startedAt: "2026-01-01T00:00:00.000Z",
      activeIntervals: [
        { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:02:00.000Z" }, // 2 min
        { start: "2026-01-01T00:07:00.000Z" }, // open, 3 min until NOW (00:10)
      ],
    });
    expect(getTaskDuration(item, NOW)).toEqual({
      elapsedMs: 5 * 60 * 1000,
      isRunning: true,
    });
  });

  it("sums all intervals for a re-opened task that completed again", () => {
    const item = makeItem({
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:08:00.000Z",
      endedAt: "2026-01-01T00:08:00.000Z",
      activeIntervals: [
        { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:02:00.000Z" }, // 2 min
        { start: "2026-01-01T00:05:00.000Z", end: "2026-01-01T00:08:00.000Z" }, // 3 min
      ],
    });
    expect(getTaskDuration(item, NOW)).toEqual({
      elapsedMs: 5 * 60 * 1000,
      isRunning: false,
    });
  });

  it("accepts now as a Date object", () => {
    const item = makeItem({
      status: "in_progress",
      activeIntervals: [{ start: "2026-01-01T00:05:00.000Z" }],
    });
    const nowDate = new Date(NOW);
    expect(getTaskDuration(item, nowDate)).toEqual({
      elapsedMs: 5 * 60 * 1000,
      isRunning: true,
    });
  });

  it("defaults now to Date.now() when omitted", () => {
    const item = makeItem({ status: "pending" });
    // Just verify the default path doesn't crash; value is irrelevant for a
    // never-started task.
    expect(getTaskDuration(item)).toEqual({ elapsedMs: 0, isRunning: false });
  });

  it("falls back to startedAt + endedAt for legacy items missing intervals", () => {
    const item = makeItem({
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:04:00.000Z",
    });
    expect(getTaskDuration(item, NOW)).toEqual({
      elapsedMs: 4 * 60 * 1000,
      isRunning: false,
    });
  });

  it("falls back to startedAt + completedAt when endedAt is absent", () => {
    const item = makeItem({
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:06:00.000Z",
    });
    expect(getTaskDuration(item, NOW)).toEqual({
      elapsedMs: 6 * 60 * 1000,
      isRunning: false,
    });
  });

  it("fallback reports elapsed from startedAt to now for legacy running items", () => {
    const item = makeItem({
      status: "in_progress",
      startedAt: "2026-01-01T00:02:00.000Z",
    });
    expect(getTaskDuration(item, NOW)).toEqual({
      elapsedMs: 8 * 60 * 1000,
      isRunning: true,
    });
  });

  it("skips malformed interval timestamps rather than throwing", () => {
    const item = makeItem({
      status: "completed",
      activeIntervals: [
        { start: "not-a-date", end: "also-not" },
        { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:02:00.000Z" },
      ],
    });
    expect(getTaskDuration(item, NOW)).toEqual({
      elapsedMs: 2 * 60 * 1000,
      isRunning: false,
    });
  });

  it("ignores intervals where end precedes start", () => {
    const item = makeItem({
      status: "completed",
      activeIntervals: [
        { start: "2026-01-01T00:05:00.000Z", end: "2026-01-01T00:04:00.000Z" }, // invalid
        { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:01:00.000Z" }, // 1 min
      ],
    });
    expect(getTaskDuration(item, NOW)).toEqual({
      elapsedMs: 1 * 60 * 1000,
      isRunning: false,
    });
  });

  it("returns isRunning=false for a pending item even if there is an open interval (inconsistent data)", () => {
    // Defensive: isRunning is derived from status, not interval shape. If the
    // status is not in_progress, we never claim the task is running.
    const item = makeItem({
      status: "pending",
      activeIntervals: [{ start: "2026-01-01T00:05:00.000Z" }],
    });
    const result = getTaskDuration(item, NOW);
    expect(result.isRunning).toBe(false);
    // Open interval still sums against now since we have no end.
    expect(result.elapsedMs).toBe(5 * 60 * 1000);
  });
});
