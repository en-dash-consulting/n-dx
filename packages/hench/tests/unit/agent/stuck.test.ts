import { describe, it, expect } from "vitest";
import type { RunRecord } from "../../../src/schema/v1.js";

/**
 * Tests for stuck task detection.
 *
 * A task is "stuck" when it has accumulated too many consecutive failed
 * attempts (default: 3). The loop should skip stuck tasks and move to
 * the next available one.
 */

function makeRun(
  taskId: string,
  status: "completed" | "failed" | "timeout" | "budget_exceeded" | "error_transient",
  startedAt: string,
): RunRecord {
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    taskTitle: `Task ${taskId}`,
    startedAt,
    finishedAt: startedAt,
    status,
    turns: 1,
    tokenUsage: { input: 100, output: 50 },
    toolCalls: [],
    model: "test",
  };
}

describe("countRecentFailures", () => {
  it("counts consecutive failed runs for a task", async () => {
    const { countRecentFailures } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "failed", "2024-01-01T03:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T02:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T01:00:00Z"),
    ];

    expect(countRecentFailures("task-a", runs)).toBe(3);
  });

  it("stops counting at first non-failure", async () => {
    const { countRecentFailures } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "failed", "2024-01-01T03:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T02:00:00Z"),
      makeRun("task-a", "completed", "2024-01-01T01:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T00:00:00Z"),
    ];

    expect(countRecentFailures("task-a", runs)).toBe(2);
  });

  it("returns 0 when no runs for the task", async () => {
    const { countRecentFailures } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-b", "failed", "2024-01-01T01:00:00Z"),
    ];

    expect(countRecentFailures("task-a", runs)).toBe(0);
  });

  it("filters to the correct taskId only", async () => {
    const { countRecentFailures } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "failed", "2024-01-01T03:00:00Z"),
      makeRun("task-b", "failed", "2024-01-01T02:30:00Z"),
      makeRun("task-a", "completed", "2024-01-01T02:00:00Z"),
    ];

    expect(countRecentFailures("task-a", runs)).toBe(1);
    expect(countRecentFailures("task-b", runs)).toBe(1);
  });

  it("counts timeout as a failure", async () => {
    const { countRecentFailures } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "timeout", "2024-01-01T03:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T02:00:00Z"),
    ];

    expect(countRecentFailures("task-a", runs)).toBe(2);
  });

  it("counts budget_exceeded as a failure", async () => {
    const { countRecentFailures } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "budget_exceeded", "2024-01-01T03:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T02:00:00Z"),
    ];

    expect(countRecentFailures("task-a", runs)).toBe(2);
  });

  it("does not count error_transient as a failure for stuck detection", async () => {
    const { countRecentFailures } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "error_transient", "2024-01-01T03:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T02:00:00Z"),
    ];

    // error_transient breaks the consecutive failure streak
    expect(countRecentFailures("task-a", runs)).toBe(0);
  });
});

describe("getStuckTaskIds", () => {
  it("returns task IDs with 3+ consecutive failures", async () => {
    const { getStuckTaskIds } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "failed", "2024-01-01T03:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T02:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T01:00:00Z"),
      makeRun("task-b", "failed", "2024-01-01T02:00:00Z"),
      makeRun("task-b", "completed", "2024-01-01T01:00:00Z"),
    ];

    const stuck = getStuckTaskIds(runs, 3);
    expect(stuck).toContain("task-a");
    expect(stuck).not.toContain("task-b");
  });

  it("returns empty set when no tasks are stuck", async () => {
    const { getStuckTaskIds } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "failed", "2024-01-01T02:00:00Z"),
      makeRun("task-a", "completed", "2024-01-01T01:00:00Z"),
    ];

    const stuck = getStuckTaskIds(runs, 3);
    expect(stuck.size).toBe(0);
  });

  it("respects custom threshold", async () => {
    const { getStuckTaskIds } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "failed", "2024-01-01T02:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T01:00:00Z"),
    ];

    expect(getStuckTaskIds(runs, 2).has("task-a")).toBe(true);
    expect(getStuckTaskIds(runs, 3).has("task-a")).toBe(false);
  });

  it("handles empty runs array", async () => {
    const { getStuckTaskIds } = await import("../../../src/agent/analysis/stuck.js");
    expect(getStuckTaskIds([], 3).size).toBe(0);
  });

  it("detects multiple stuck tasks", async () => {
    const { getStuckTaskIds } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "failed", "2024-01-01T03:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T02:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T01:00:00Z"),
      makeRun("task-b", "timeout", "2024-01-01T03:00:00Z"),
      makeRun("task-b", "failed", "2024-01-01T02:00:00Z"),
      makeRun("task-b", "timeout", "2024-01-01T01:00:00Z"),
    ];

    const stuck = getStuckTaskIds(runs, 3);
    expect(stuck.has("task-a")).toBe(true);
    expect(stuck.has("task-b")).toBe(true);
    expect(stuck.size).toBe(2);
  });
});

describe("isStuckTask", () => {
  it("returns true when task has enough failures", async () => {
    const { isStuckTask } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "failed", "2024-01-01T03:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T02:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T01:00:00Z"),
    ];

    expect(isStuckTask("task-a", runs, 3)).toBe(true);
  });

  it("returns false when task has fewer failures than threshold", async () => {
    const { isStuckTask } = await import("../../../src/agent/analysis/stuck.js");

    const runs: RunRecord[] = [
      makeRun("task-a", "failed", "2024-01-01T02:00:00Z"),
      makeRun("task-a", "failed", "2024-01-01T01:00:00Z"),
    ];

    expect(isStuckTask("task-a", runs, 3)).toBe(false);
  });
});
