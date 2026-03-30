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

const sampleTree: PRDItem[] = [
  makeItem({
    id: "e1",
    title: "Epic 1",
    level: "epic",
    children: [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        children: [
          makeItem({ id: "t1", title: "Task 1" }),
          makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        ],
      }),
      makeItem({ id: "f2", title: "Feature 2", level: "feature" }),
    ],
  }),
  makeItem({ id: "e2", title: "Epic 2", level: "epic" }),
];

describe("walkTree", () => {
  it("visits all items depth-first", () => {
    const ids = [...walkTree(sampleTree)].map((e) => e.item.id);
    expect(ids).toEqual(["e1", "f1", "t1", "t2", "f2", "e2"]);
  });

  it("provides correct parent chains", () => {
    const entries = [...walkTree(sampleTree)];
    const t1 = entries.find((e) => e.item.id === "t1")!;
    expect(t1.parents.map((p) => p.id)).toEqual(["e1", "f1"]);
  });

  it("returns empty parent chain for root items", () => {
    const entries = [...walkTree(sampleTree)];
    const e1 = entries.find((e) => e.item.id === "e1")!;
    expect(e1.parents).toEqual([]);
  });
});

describe("findItem", () => {
  it("finds root item", () => {
    const result = findItem(sampleTree, "e1");
    expect(result).not.toBeNull();
    expect(result!.item.title).toBe("Epic 1");
  });

  it("finds nested item with parent chain", () => {
    const result = findItem(sampleTree, "t1");
    expect(result).not.toBeNull();
    expect(result!.item.title).toBe("Task 1");
    expect(result!.parents.map((p) => p.id)).toEqual(["e1", "f1"]);
  });

  it("returns null for unknown id", () => {
    expect(findItem(sampleTree, "nonexistent")).toBeNull();
  });
});

describe("insertChild", () => {
  it("adds child to existing parent", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Epic", level: "epic", children: [] }),
    ];
    const child = makeItem({ id: "f1", title: "Feature", level: "feature" });
    const inserted = insertChild(items, "e1", child);
    expect(inserted).toBe(true);
    expect(items[0].children!.length).toBe(1);
    expect(items[0].children![0].id).toBe("f1");
  });

  it("creates children array if needed", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Epic", level: "epic" }),
    ];
    const child = makeItem({ id: "f1", title: "Feature", level: "feature" });
    insertChild(items, "e1", child);
    expect(items[0].children).toBeDefined();
    expect(items[0].children!.length).toBe(1);
  });

  it("returns false for nonexistent parent", () => {
    const items: PRDItem[] = [];
    const child = makeItem({ id: "f1", title: "Feature", level: "feature" });
    expect(insertChild(items, "nope", child)).toBe(false);
  });
});

describe("updateInTree", () => {
  it("updates item fields", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "pending" }),
    ];
    const updated = updateInTree(items, "t1", { status: "completed" });
    expect(updated).toBe(true);
    expect(items[0].status).toBe("completed");
  });

  it("updates nested item", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [makeItem({ id: "t1", title: "Task" })],
      }),
    ];
    updateInTree(items, "t1", { title: "Updated Task", priority: "high" });
    expect(items[0].children![0].title).toBe("Updated Task");
    expect(items[0].children![0].priority).toBe("high");
  });

  it("returns false for unknown id", () => {
    expect(updateInTree([], "nope", { status: "completed" })).toBe(false);
  });
});

describe("removeFromTree", () => {
  it("removes root item", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Epic 1", level: "epic" }),
      makeItem({ id: "e2", title: "Epic 2", level: "epic" }),
    ];
    const removed = removeFromTree(items, "e1");
    expect(removed).not.toBeNull();
    expect(removed!.id).toBe("e1");
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("e2");
  });

  it("removes nested item", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "t1", title: "Task 1" }),
          makeItem({ id: "t2", title: "Task 2" }),
        ],
      }),
    ];
    const removed = removeFromTree(items, "t1");
    expect(removed).not.toBeNull();
    expect(items[0].children!.length).toBe(1);
    expect(items[0].children![0].id).toBe("t2");
  });

  it("returns null for unknown id", () => {
    expect(removeFromTree([], "nope")).toBeNull();
  });
});

describe("computeStats", () => {
  it("counts all statuses", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "A", status: "pending" }),
      makeItem({ id: "2", title: "B", status: "in_progress" }),
      makeItem({ id: "3", title: "C", status: "completed" }),
      makeItem({ id: "4", title: "D", status: "deferred" }),
      makeItem({ id: "5", title: "E", status: "blocked" }),
      makeItem({ id: "6", title: "F", status: "failing" }),
    ];
    const stats = computeStats(items);
    expect(stats).toEqual({
      total: 6,
      pending: 1,
      inProgress: 1,
      completed: 1,
      failing: 1,
      deferred: 1,
      blocked: 1,
      deleted: 0,
    });
  });

  it("counts nested items", () => {
    const stats = computeStats(sampleTree);
    // Counts tasks, subtasks, and childless features (f2 has no children)
    expect(stats.total).toBe(3); // t1, t2, f2 (childless)
    expect(stats.completed).toBe(1); // t2
    expect(stats.pending).toBe(2); // t1, f2
  });

  it("returns zeros for empty tree", () => {
    const stats = computeStats([]);
    expect(stats.total).toBe(0);
  });
});

describe("getParentChain", () => {
  it("returns parent chain for nested item", () => {
    const parents = getParentChain(sampleTree, "t1");
    expect(parents.map((p) => p.id)).toEqual(["e1", "f1"]);
  });

  it("returns empty for root item", () => {
    expect(getParentChain(sampleTree, "e1")).toEqual([]);
  });

  it("returns empty for unknown id", () => {
    expect(getParentChain(sampleTree, "nope")).toEqual([]);
  });
});

describe("collectAllIds", () => {
  it("collects all ids from tree", () => {
    const ids = collectAllIds(sampleTree);
    expect(ids).toEqual(new Set(["e1", "f1", "t1", "t2", "f2", "e2"]));
  });

  it("returns empty set for empty tree", () => {
    expect(collectAllIds([])).toEqual(new Set());
  });
});
