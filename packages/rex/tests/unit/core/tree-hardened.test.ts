import { describe, it, expect } from "vitest";
import {
  walkTree,
  findItem,
  insertChild,
  updateInTree,
  removeFromTree,
  getParentChain,
  collectAllIds,
} from "../../../src/core/tree.js";
import { computeStats } from "../../../src/core/stats.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// walkTree — edge cases
// ---------------------------------------------------------------------------

describe("walkTree — hardened", () => {
  it("handles items with empty children array", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Epic", level: "epic", children: [] }),
    ];
    const entries = [...walkTree(items)];
    expect(entries).toHaveLength(1);
    expect(entries[0].item.id).toBe("e1");
    expect(entries[0].parents).toEqual([]);
  });

  it("handles deeply nested tree (4 levels)", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({
                id: "t1",
                title: "Task",
                level: "task",
                children: [
                  makeItem({ id: "s1", title: "Subtask", level: "subtask" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const entries = [...walkTree(items)];
    expect(entries).toHaveLength(4);

    const subtask = entries.find((e) => e.item.id === "s1")!;
    expect(subtask.parents.map((p) => p.id)).toEqual(["e1", "f1", "t1"]);
  });

  it("handles mixed children: some with children, some without", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "f1", title: "Feature 1", level: "feature", children: [] }),
          makeItem({
            id: "f2",
            title: "Feature 2",
            level: "feature",
            children: [makeItem({ id: "t1", title: "Task", level: "task" })],
          }),
          makeItem({ id: "f3", title: "Feature 3", level: "feature" }),
        ],
      }),
    ];
    const ids = [...walkTree(items)].map((e) => e.item.id);
    expect(ids).toEqual(["e1", "f1", "f2", "t1", "f3"]);
  });

  it("handles multiple root items with children", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        children: [makeItem({ id: "t1", title: "Task 1" })],
      }),
      makeItem({
        id: "e2",
        title: "Epic 2",
        level: "epic",
        children: [makeItem({ id: "t2", title: "Task 2" })],
      }),
    ];
    const entries = [...walkTree(items)];
    // t1's parent should be e1, t2's parent should be e2
    const t1 = entries.find((e) => e.item.id === "t1")!;
    const t2 = entries.find((e) => e.item.id === "t2")!;
    expect(t1.parents.map((p) => p.id)).toEqual(["e1"]);
    expect(t2.parents.map((p) => p.id)).toEqual(["e2"]);
  });

  it("parent chain items are the actual tree items (referential identity)", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [makeItem({ id: "t1", title: "Task" })],
      }),
    ];
    const entries = [...walkTree(items)];
    const t1 = entries.find((e) => e.item.id === "t1")!;
    expect(t1.parents[0]).toBe(items[0]); // same reference
  });
});

// ---------------------------------------------------------------------------
// findItem — edge cases
// ---------------------------------------------------------------------------

describe("findItem — hardened", () => {
  it("returns null for empty array", () => {
    expect(findItem([], "anything")).toBeNull();
  });

  it("finds item in empty-children parent", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [makeItem({ id: "t1", title: "Task" })],
      }),
    ];
    const result = findItem(items, "t1");
    expect(result).not.toBeNull();
    expect(result!.item.title).toBe("Task");
  });

  it("finds first occurrence when duplicate ids exist (degenerate case)", () => {
    const items: PRDItem[] = [
      makeItem({ id: "dup", title: "First" }),
      makeItem({ id: "dup", title: "Second" }),
    ];
    const result = findItem(items, "dup");
    expect(result!.item.title).toBe("First");
  });
});

// ---------------------------------------------------------------------------
// insertChild — hardened
// ---------------------------------------------------------------------------

describe("insertChild — hardened", () => {
  it("inserts into deeply nested parent", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [makeItem({ id: "t1", title: "Task" })],
          }),
        ],
      }),
    ];
    const subtask = makeItem({ id: "s1", title: "Subtask", level: "subtask" });
    const inserted = insertChild(items, "t1", subtask);
    expect(inserted).toBe(true);
    expect(items[0].children![0].children![0].children).toHaveLength(1);
    expect(items[0].children![0].children![0].children![0].id).toBe("s1");
  });

  it("appends to existing children without disturbing them", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "f1", title: "Feature 1", level: "feature" }),
        ],
      }),
    ];
    const child = makeItem({ id: "f2", title: "Feature 2", level: "feature" });
    insertChild(items, "e1", child);
    expect(items[0].children).toHaveLength(2);
    expect(items[0].children![0].id).toBe("f1");
    expect(items[0].children![1].id).toBe("f2");
  });

  it("validates hierarchy: rejects subtask under epic", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Epic", level: "epic" }),
    ];
    const subtask = makeItem({ id: "s1", title: "Subtask", level: "subtask" });
    const result = insertChild(items, "e1", subtask);
    expect(result).toBe(false);
  });

  it("validates hierarchy: allows task under feature", () => {
    const items: PRDItem[] = [
      makeItem({ id: "f1", title: "Feature", level: "feature" }),
    ];
    const task = makeItem({ id: "t1", title: "Task", level: "task" });
    const result = insertChild(items, "f1", task);
    expect(result).toBe(true);
  });

  it("validates hierarchy: allows task under epic", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Epic", level: "epic" }),
    ];
    const task = makeItem({ id: "t1", title: "Task", level: "task" });
    const result = insertChild(items, "e1", task);
    expect(result).toBe(true);
  });

  it("validates hierarchy: rejects feature under task", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task", level: "task" }),
    ];
    const feature = makeItem({ id: "f1", title: "Feature", level: "feature" });
    const result = insertChild(items, "t1", feature);
    expect(result).toBe(false);
  });

  it("validates hierarchy: rejects epic under feature", () => {
    const items: PRDItem[] = [
      makeItem({ id: "f1", title: "Feature", level: "feature" }),
    ];
    const epic = makeItem({ id: "e1", title: "Epic", level: "epic" });
    const result = insertChild(items, "f1", epic);
    expect(result).toBe(false);
  });

  it("validates hierarchy: allows subtask under task", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task", level: "task" }),
    ];
    const subtask = makeItem({ id: "s1", title: "Subtask", level: "subtask" });
    const result = insertChild(items, "t1", subtask);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateInTree — hardened
// ---------------------------------------------------------------------------

describe("updateInTree — hardened", () => {
  it("merges partial updates without removing existing fields", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "Task",
        priority: "high",
        description: "Important task",
      }),
    ];
    updateInTree(items, "t1", { status: "completed" });
    expect(items[0].status).toBe("completed");
    expect(items[0].priority).toBe("high");
    expect(items[0].description).toBe("Important task");
  });

  it("can update deeply nested item", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({
                id: "t1",
                title: "Task",
                children: [
                  makeItem({ id: "s1", title: "Subtask", level: "subtask" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const updated = updateInTree(items, "s1", { status: "completed", completedAt: "2024-01-01" });
    expect(updated).toBe(true);
    expect(items[0].children![0].children![0].children![0].status).toBe("completed");
  });

  it("does not modify tree on unknown id", () => {
    const items: PRDItem[] = [makeItem({ id: "t1", title: "Task" })];
    const before = JSON.stringify(items);
    updateInTree(items, "nonexistent", { status: "completed" });
    expect(JSON.stringify(items)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// removeFromTree — hardened
// ---------------------------------------------------------------------------

describe("removeFromTree — hardened", () => {
  it("preserves children of removed item", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [makeItem({ id: "t1", title: "Task" })],
          }),
        ],
      }),
    ];
    const removed = removeFromTree(items, "f1");
    expect(removed).not.toBeNull();
    expect(removed!.children).toHaveLength(1);
    expect(removed!.children![0].id).toBe("t1");
  });

  it("removes deeply nested item", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Task 1" }),
              makeItem({ id: "t2", title: "Task 2" }),
            ],
          }),
        ],
      }),
    ];
    const removed = removeFromTree(items, "t1");
    expect(removed!.id).toBe("t1");
    expect(items[0].children![0].children).toHaveLength(1);
    expect(items[0].children![0].children![0].id).toBe("t2");
  });

  it("handles removal of only child", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [makeItem({ id: "f1", title: "Feature", level: "feature" })],
      }),
    ];
    const removed = removeFromTree(items, "f1");
    expect(removed!.id).toBe("f1");
    expect(items[0].children).toHaveLength(0);
  });

  it("does not mutate tree when item not found", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [makeItem({ id: "t1", title: "Task" })],
      }),
    ];
    const before = JSON.stringify(items);
    const removed = removeFromTree(items, "nonexistent");
    expect(removed).toBeNull();
    expect(JSON.stringify(items)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// computeStats — hardened
// ---------------------------------------------------------------------------

describe("computeStats — hardened", () => {
  it("total equals sum of all active status counts (excludes deleted)", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "A", status: "pending" }),
      makeItem({ id: "2", title: "B", status: "in_progress" }),
      makeItem({ id: "3", title: "C", status: "completed" }),
      makeItem({ id: "4", title: "D", status: "deferred" }),
      makeItem({ id: "5", title: "E", status: "blocked" }),
    ];
    const stats = computeStats(items);
    expect(stats.total).toBe(
      stats.pending + stats.inProgress + stats.completed + stats.deferred + stats.blocked,
    );
    expect(stats.deleted).toBe(0);
  });

  it("counts deeply nested subtasks", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({
                id: "t1",
                title: "Task",
                status: "in_progress",
                children: [
                  makeItem({ id: "s1", title: "Subtask 1", level: "subtask", status: "completed" }),
                  makeItem({ id: "s2", title: "Subtask 2", level: "subtask", status: "pending" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const stats = computeStats(items);
    expect(stats.total).toBe(3); // t1 + s1 + s2
    expect(stats.inProgress).toBe(1); // t1
    expect(stats.completed).toBe(1); // s1
    expect(stats.pending).toBe(1); // s2
  });

  it("excludes epics from count; childless features count as work items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Epic", level: "epic", status: "in_progress" }),
      makeItem({ id: "f1", title: "Feature", level: "feature", status: "pending" }),
      makeItem({ id: "t1", title: "Task", level: "task", status: "completed" }),
      makeItem({ id: "s1", title: "Subtask", level: "subtask", status: "blocked" }),
    ];
    const stats = computeStats(items);
    expect(stats.total).toBe(3); // f1 (childless) + t1 + s1
    expect(stats.completed).toBe(1);
    expect(stats.blocked).toBe(1);
    expect(stats.inProgress).toBe(0); // epic doesn't count
    expect(stats.pending).toBe(1); // childless feature counts
  });

  it("features with children are still excluded from count", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1", title: "Feature", level: "feature", status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task", level: "task", status: "completed" }),
        ],
      }),
    ];
    const stats = computeStats(items);
    expect(stats.total).toBe(1); // only t1, not f1
    expect(stats.completed).toBe(1);
  });

  it("handles items with empty children array", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [],
      }),
    ];
    const stats = computeStats(items);
    expect(stats.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getParentChain — hardened
// ---------------------------------------------------------------------------

describe("getParentChain — hardened", () => {
  it("returns full chain for deeply nested item", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({
                id: "t1",
                title: "Task",
                children: [
                  makeItem({ id: "s1", title: "Subtask", level: "subtask" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const chain = getParentChain(items, "s1");
    expect(chain.map((p) => p.id)).toEqual(["e1", "f1", "t1"]);
  });

  it("returns empty chain for root item in multi-root tree", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Epic 1", level: "epic" }),
      makeItem({ id: "e2", title: "Epic 2", level: "epic" }),
    ];
    expect(getParentChain(items, "e1")).toEqual([]);
    expect(getParentChain(items, "e2")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// collectAllIds — hardened
// ---------------------------------------------------------------------------

describe("collectAllIds — hardened", () => {
  it("collects from deeply nested tree", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({
                id: "t1",
                title: "Task",
                children: [
                  makeItem({ id: "s1", title: "Subtask", level: "subtask" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const ids = collectAllIds(items);
    expect(ids).toEqual(new Set(["e1", "f1", "t1", "s1"]));
  });

  it("handles items with empty children array", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Epic", level: "epic", children: [] }),
    ];
    const ids = collectAllIds(items);
    expect(ids).toEqual(new Set(["e1"]));
  });
});

// ---------------------------------------------------------------------------
// Performance: large tree
// ---------------------------------------------------------------------------

describe("tree operations — performance", () => {
  function buildLargeTree(epicCount: number, featuresPerEpic: number, tasksPerFeature: number): PRDItem[] {
    const items: PRDItem[] = [];
    let id = 0;
    for (let e = 0; e < epicCount; e++) {
      const epic: PRDItem = {
        id: `e${id++}`,
        title: `Epic ${e}`,
        level: "epic",
        status: "pending",
        children: [],
      };
      for (let f = 0; f < featuresPerEpic; f++) {
        const feature: PRDItem = {
          id: `f${id++}`,
          title: `Feature ${e}-${f}`,
          level: "feature",
          status: "pending",
          children: [],
        };
        for (let t = 0; t < tasksPerFeature; t++) {
          feature.children!.push({
            id: `t${id++}`,
            title: `Task ${e}-${f}-${t}`,
            level: "task",
            status: t % 3 === 0 ? "completed" : "pending",
          });
        }
        epic.children!.push(feature);
      }
      items.push(epic);
    }
    return items;
  }

  it("walkTree handles 1000+ items efficiently", () => {
    const items = buildLargeTree(10, 10, 10); // 10 epics * 10 features * 10 tasks = 1100+ items
    const start = performance.now();
    let count = 0;
    for (const _entry of walkTree(items)) {
      count++;
    }
    const elapsed = performance.now() - start;
    expect(count).toBe(1110); // 10 epics + 100 features + 1000 tasks
    expect(elapsed).toBeLessThan(100); // should be under 100ms
  });

  it("findItem searches 1000+ items quickly", () => {
    const items = buildLargeTree(10, 10, 10);
    const start = performance.now();
    // Find a deeply nested item (last task in last feature in last epic)
    const result = findItem(items, "t1109");
    const elapsed = performance.now() - start;
    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(50);
  });

  it("computeStats handles 1000+ items", () => {
    const items = buildLargeTree(10, 10, 10);
    const start = performance.now();
    const stats = computeStats(items);
    const elapsed = performance.now() - start;
    expect(stats.total).toBe(1000); // only tasks counted
    expect(elapsed).toBeLessThan(50);
  });

  it("collectAllIds handles 1000+ items", () => {
    const items = buildLargeTree(10, 10, 10);
    const start = performance.now();
    const ids = collectAllIds(items);
    const elapsed = performance.now() - start;
    expect(ids.size).toBe(1110);
    expect(elapsed).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// computeStats — deleted item exclusion
// ---------------------------------------------------------------------------

describe("computeStats — deleted items excluded from total", () => {
  it("excludes deleted tasks from total count", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "Active", status: "pending" }),
      makeItem({ id: "2", title: "Done", status: "completed" }),
      makeItem({ id: "3", title: "Deleted", status: "deleted" }),
    ];
    const stats = computeStats(items);
    expect(stats.total).toBe(2); // only pending + completed
    expect(stats.deleted).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.completed).toBe(1);
  });

  it("deleted items don't deflate completion percentage", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "Done", status: "completed" }),
      makeItem({ id: "2", title: "Deleted", status: "deleted" }),
    ];
    const stats = computeStats(items);
    // Without the fix, total would be 2, giving 50%
    // With the fix, total is 1, giving 100%
    expect(stats.total).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.deleted).toBe(1);
    const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    expect(pct).toBe(100);
  });

  it("handles all deleted items gracefully (total = 0)", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "Del 1", status: "deleted" }),
      makeItem({ id: "2", title: "Del 2", status: "deleted" }),
    ];
    const stats = computeStats(items);
    expect(stats.total).toBe(0);
    expect(stats.deleted).toBe(2);
    const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    expect(pct).toBe(0);
  });

  it("excludes deleted subtasks nested in tree", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Active Task", status: "completed" }),
              makeItem({ id: "t2", title: "Deleted Task", status: "deleted" }),
              makeItem({
                id: "t3",
                title: "Task with deleted subtask",
                status: "in_progress",
                children: [
                  makeItem({ id: "s1", title: "Deleted subtask", level: "subtask", status: "deleted" }),
                  makeItem({ id: "s2", title: "Active subtask", level: "subtask", status: "pending" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const stats = computeStats(items);
    expect(stats.total).toBe(3); // t1, t3, s2
    expect(stats.deleted).toBe(2); // t2, s1
    expect(stats.completed).toBe(1); // t1
    expect(stats.inProgress).toBe(1); // t3
    expect(stats.pending).toBe(1); // s2
  });

  it("deleted epics are not counted; deleted childless features and tasks are", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Deleted Epic", level: "epic", status: "deleted" }),
      makeItem({ id: "f1", title: "Deleted Feature", level: "feature", status: "deleted" }),
      makeItem({ id: "t1", title: "Deleted Task", level: "task", status: "deleted" }),
    ];
    const stats = computeStats(items);
    expect(stats.total).toBe(0);
    expect(stats.deleted).toBe(2); // f1 (childless) + t1
  });
});
