import { describe, it, expect } from "vitest";
import {
  computeBranchStats,
  completionRatio,
  countChildStatuses,
  formatTimestamp,
  itemMatchesFilter,
  filterTree,
} from "../../../src/viewer/components/prd-tree/compute.js";
import type { PRDItemData, ItemStatus } from "../../../src/viewer/components/prd-tree/types.js";

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
    expect(completionRatio({ total: 0, completed: 0, inProgress: 0, pending: 0, deferred: 0, blocked: 0, deleted: 0 })).toBe(0);
  });

  it("returns correct ratio", () => {
    expect(completionRatio({ total: 10, completed: 3, inProgress: 2, pending: 5, deferred: 0, blocked: 0, deleted: 0 })).toBeCloseTo(0.3);
  });

  it("returns 1 when all completed", () => {
    expect(completionRatio({ total: 5, completed: 5, inProgress: 0, pending: 0, deferred: 0, blocked: 0, deleted: 0 })).toBe(1);
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

// ── itemMatchesFilter ─────────────────────────────────────────────

describe("itemMatchesFilter", () => {
  it("returns true when item status is in the filter set", () => {
    const item = makeItem({ id: "t1", level: "task", status: "completed" });
    expect(itemMatchesFilter(item, new Set<ItemStatus>(["completed"]))).toBe(true);
  });

  it("returns false when item status is not in the filter set", () => {
    const item = makeItem({ id: "t1", level: "task", status: "deferred" });
    expect(itemMatchesFilter(item, new Set<ItemStatus>(["completed", "pending"]))).toBe(false);
  });

  it("returns true for a parent whose own status does not match but has a matching child", () => {
    const item = makeItem({
      id: "e1",
      level: "epic",
      status: "deferred",
      children: [
        makeItem({ id: "t1", level: "task", status: "completed" }),
      ],
    });
    expect(itemMatchesFilter(item, new Set<ItemStatus>(["completed"]))).toBe(true);
  });

  it("returns true for a parent with a matching grandchild", () => {
    const item = makeItem({
      id: "e1",
      level: "epic",
      status: "deferred",
      children: [
        makeItem({
          id: "f1",
          level: "feature",
          status: "deferred",
          children: [
            makeItem({ id: "t1", level: "task", status: "in_progress" }),
          ],
        }),
      ],
    });
    expect(itemMatchesFilter(item, new Set<ItemStatus>(["in_progress"]))).toBe(true);
  });

  it("returns false for a parent when no descendants match", () => {
    const item = makeItem({
      id: "e1",
      level: "epic",
      status: "deferred",
      children: [
        makeItem({ id: "t1", level: "task", status: "deferred" }),
        makeItem({ id: "t2", level: "task", status: "blocked" }),
      ],
    });
    expect(itemMatchesFilter(item, new Set<ItemStatus>(["completed", "pending"]))).toBe(false);
  });

  it("returns false for leaf node with no children and non-matching status", () => {
    const item = makeItem({ id: "s1", level: "subtask", status: "pending" });
    expect(itemMatchesFilter(item, new Set<ItemStatus>(["completed"]))).toBe(false);
  });

  it("handles item with empty children array", () => {
    const item = makeItem({ id: "t1", level: "task", status: "blocked", children: [] });
    expect(itemMatchesFilter(item, new Set<ItemStatus>(["completed"]))).toBe(false);
    expect(itemMatchesFilter(item, new Set<ItemStatus>(["blocked"]))).toBe(true);
  });

  it("handles item with undefined children", () => {
    const item = makeItem({ id: "t1", level: "task", status: "pending" });
    // No children property at all
    expect(itemMatchesFilter(item, new Set<ItemStatus>(["pending"]))).toBe(true);
    expect(itemMatchesFilter(item, new Set<ItemStatus>(["completed"]))).toBe(false);
  });

  it("matches against all six statuses", () => {
    const allStatuses: ItemStatus[] = ["pending", "in_progress", "completed", "blocked", "deferred", "deleted"];
    for (const status of allStatuses) {
      const item = makeItem({ id: `t-${status}`, level: "task", status });
      expect(itemMatchesFilter(item, new Set<ItemStatus>([status]))).toBe(true);
      // And not match a different status
      const otherStatus = allStatuses.find((s) => s !== status)!;
      expect(itemMatchesFilter(item, new Set<ItemStatus>([otherStatus]))).toBe(false);
    }
  });
});

// ── filterTree ────────────────────────────────────────────────────

describe("filterTree", () => {
  it("returns empty array for empty input", () => {
    expect(filterTree([], new Set<ItemStatus>(["pending"]))).toEqual([]);
  });

  it("keeps items whose status matches the filter", () => {
    const items: PRDItemData[] = [
      makeItem({ id: "t1", level: "task", status: "completed" }),
      makeItem({ id: "t2", level: "task", status: "pending" }),
      makeItem({ id: "t3", level: "task", status: "blocked" }),
    ];
    const result = filterTree(items, new Set<ItemStatus>(["completed", "blocked"]));
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(["t1", "t3"]);
  });

  it("removes items that do not match", () => {
    const items: PRDItemData[] = [
      makeItem({ id: "t1", level: "task", status: "deferred" }),
    ];
    const result = filterTree(items, new Set<ItemStatus>(["completed"]));
    expect(result).toHaveLength(0);
  });

  it("keeps parent node when it has a matching descendant even if parent does not match", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "e1",
        level: "epic",
        status: "deferred",
        children: [
          makeItem({ id: "t1", level: "task", status: "completed" }),
          makeItem({ id: "t2", level: "task", status: "deferred" }),
        ],
      }),
    ];
    const result = filterTree(items, new Set<ItemStatus>(["completed"]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e1");
    // Only the matching child should remain
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].id).toBe("t1");
  });

  it("removes parent when all children are filtered out and parent does not match", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "e1",
        level: "epic",
        status: "deferred",
        children: [
          makeItem({ id: "t1", level: "task", status: "deferred" }),
          makeItem({ id: "t2", level: "task", status: "blocked" }),
        ],
      }),
    ];
    const result = filterTree(items, new Set<ItemStatus>(["completed"]));
    expect(result).toHaveLength(0);
  });

  it("preserves deeply nested hierarchy when a deep descendant matches", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "e1",
        level: "epic",
        status: "deferred",
        children: [
          makeItem({
            id: "f1",
            level: "feature",
            status: "deferred",
            children: [
              makeItem({
                id: "t1",
                level: "task",
                status: "deferred",
                children: [
                  makeItem({ id: "s1", level: "subtask", status: "in_progress" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const result = filterTree(items, new Set<ItemStatus>(["in_progress"]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e1");
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].id).toBe("f1");
    expect(result[0].children![0].children).toHaveLength(1);
    expect(result[0].children![0].children![0].id).toBe("t1");
    expect(result[0].children![0].children![0].children).toHaveLength(1);
    expect(result[0].children![0].children![0].children![0].id).toBe("s1");
  });

  it("preserves indentation-relevant structure by maintaining depth", () => {
    // Verifies that filtered results keep items at the same nesting level
    const items: PRDItemData[] = [
      makeItem({
        id: "e1",
        level: "epic",
        status: "pending",
        children: [
          makeItem({ id: "t1", level: "task", status: "completed" }),
          makeItem({ id: "t2", level: "task", status: "pending" }),
        ],
      }),
      makeItem({
        id: "e2",
        level: "epic",
        status: "completed",
        children: [
          makeItem({ id: "t3", level: "task", status: "completed" }),
        ],
      }),
    ];
    const result = filterTree(items, new Set<ItemStatus>(["completed"]));
    // Both epics should survive (e1 has a completed child, e2 is itself completed)
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("e1");
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].id).toBe("t1");
    expect(result[1].id).toBe("e2");
    expect(result[1].children).toHaveLength(1);
  });

  it("does not mutate the original items array", () => {
    const child1 = makeItem({ id: "t1", level: "task", status: "completed" });
    const child2 = makeItem({ id: "t2", level: "task", status: "pending" });
    const epic = makeItem({
      id: "e1",
      level: "epic",
      status: "pending",
      children: [child1, child2],
    });
    const items: PRDItemData[] = [epic];
    const result = filterTree(items, new Set<ItemStatus>(["completed"]));
    // Original should still have both children
    expect(items[0].children).toHaveLength(2);
    // Filtered result only has the completed child
    expect(result[0].children).toHaveLength(1);
  });

  it("handles multiple top-level items with mixed filtering", () => {
    const items: PRDItemData[] = [
      makeItem({ id: "t1", level: "task", status: "completed" }),
      makeItem({ id: "t2", level: "task", status: "pending" }),
      makeItem({ id: "t3", level: "task", status: "in_progress" }),
      makeItem({ id: "t4", level: "task", status: "blocked" }),
      makeItem({ id: "t5", level: "task", status: "deferred" }),
      makeItem({ id: "t6", level: "task", status: "deleted" }),
    ];
    const result = filterTree(items, new Set<ItemStatus>(["pending", "in_progress", "blocked"]));
    expect(result).toHaveLength(3);
    expect(result.map((i) => i.id)).toEqual(["t2", "t3", "t4"]);
  });

  it("keeps parent with matching status even if all children are filtered out", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "e1",
        level: "epic",
        status: "completed",
        children: [
          makeItem({ id: "t1", level: "task", status: "pending" }),
        ],
      }),
    ];
    const result = filterTree(items, new Set<ItemStatus>(["completed"]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e1");
    // Children should be empty since no child matched
    expect(result[0].children).toHaveLength(0);
  });

  it("handles items with undefined children gracefully", () => {
    const items: PRDItemData[] = [
      makeItem({ id: "t1", level: "task", status: "completed" }),
    ];
    // No children property at all
    const result = filterTree(items, new Set<ItemStatus>(["completed"]));
    expect(result).toHaveLength(1);
    expect(result[0].children).toBeUndefined();
  });

  it("returns all items when all statuses are active", () => {
    const allStatuses = new Set<ItemStatus>(["pending", "in_progress", "completed", "blocked", "deferred", "deleted"]);
    const items: PRDItemData[] = [
      makeItem({
        id: "e1",
        level: "epic",
        status: "pending",
        children: [
          makeItem({ id: "t1", level: "task", status: "completed" }),
          makeItem({ id: "t2", level: "task", status: "deleted" }),
        ],
      }),
    ];
    const result = filterTree(items, allStatuses);
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(2);
  });
});
