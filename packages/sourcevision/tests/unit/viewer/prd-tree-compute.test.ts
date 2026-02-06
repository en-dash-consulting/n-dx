import { describe, it, expect } from "vitest";
import {
  computeBranchStats,
  completionRatio,
  countChildStatuses,
  formatTimestamp,
} from "../../../src/viewer/components/prd-tree/compute.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

function makeItem(
  overrides: Partial<PRDItemData> & { id: string; level: PRDItemData["level"]; status: PRDItemData["status"] },
): PRDItemData {
  return {
    title: overrides.id,
    ...overrides,
  };
}

describe("computeBranchStats", () => {
  it("returns zeros for empty items", () => {
    const stats = computeBranchStats([]);
    expect(stats.total).toBe(0);
    expect(stats.completed).toBe(0);
  });

  it("counts only tasks and subtasks, not epics or features", () => {
    const items: PRDItemData[] = [
      makeItem({ id: "e1", level: "epic", status: "completed" }),
      makeItem({ id: "f1", level: "feature", status: "completed" }),
      makeItem({ id: "t1", level: "task", status: "completed" }),
      makeItem({ id: "s1", level: "subtask", status: "pending" }),
    ];
    const stats = computeBranchStats(items);
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.pending).toBe(1);
  });

  it("walks nested children", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "e1",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "f1",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t1", level: "task", status: "completed" }),
              makeItem({ id: "t2", level: "task", status: "in_progress" }),
              makeItem({
                id: "t3",
                level: "task",
                status: "pending",
                children: [
                  makeItem({ id: "s1", level: "subtask", status: "blocked" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const stats = computeBranchStats(items);
    expect(stats.total).toBe(4);
    expect(stats.completed).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.blocked).toBe(1);
  });

  it("counts deferred status", () => {
    const items: PRDItemData[] = [
      makeItem({ id: "t1", level: "task", status: "deferred" }),
    ];
    const stats = computeBranchStats(items);
    expect(stats.deferred).toBe(1);
    expect(stats.total).toBe(1);
  });
});

describe("completionRatio", () => {
  it("returns 0 for empty stats", () => {
    expect(completionRatio({ total: 0, completed: 0, inProgress: 0, pending: 0, deferred: 0, blocked: 0 })).toBe(0);
  });

  it("returns correct ratio", () => {
    expect(completionRatio({ total: 10, completed: 3, inProgress: 2, pending: 5, deferred: 0, blocked: 0 })).toBeCloseTo(0.3);
  });

  it("returns 1 when all completed", () => {
    expect(completionRatio({ total: 5, completed: 5, inProgress: 0, pending: 0, deferred: 0, blocked: 0 })).toBe(1);
  });
});

describe("countChildStatuses", () => {
  it("counts status distribution of direct children", () => {
    const children: PRDItemData[] = [
      makeItem({ id: "a", level: "task", status: "completed" }),
      makeItem({ id: "b", level: "task", status: "completed" }),
      makeItem({ id: "c", level: "task", status: "pending" }),
      makeItem({ id: "d", level: "task", status: "blocked" }),
    ];
    const counts = countChildStatuses(children);
    expect(counts.completed).toBe(2);
    expect(counts.pending).toBe(1);
    expect(counts.blocked).toBe(1);
    expect(counts.in_progress).toBe(0);
    expect(counts.deferred).toBe(0);
  });

  it("returns all zeros for empty children", () => {
    const counts = countChildStatuses([]);
    expect(counts.completed).toBe(0);
    expect(counts.pending).toBe(0);
  });
});

describe("formatTimestamp", () => {
  it("formats valid ISO timestamp", () => {
    // Using UTC to avoid timezone issues in tests
    const ts = formatTimestamp("2026-01-15T14:30:00.000Z");
    // The exact output depends on local timezone, so just check format
    expect(ts).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("returns empty string for invalid date", () => {
    expect(formatTimestamp("invalid")).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatTimestamp("")).toBe("");
  });
});
