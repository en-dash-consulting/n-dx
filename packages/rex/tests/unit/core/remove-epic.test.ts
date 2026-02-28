import { describe, it, expect } from "vitest";
import { removeEpic } from "../../../src/core/remove-epic.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

function buildTree(): PRDItem[] {
  return [
    makeItem({
      id: "e1",
      title: "Epic One",
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
    makeItem({
      id: "e2",
      title: "Epic Two",
      level: "epic",
      children: [
        makeItem({
          id: "f3",
          title: "Feature 3",
          level: "feature",
          children: [
            makeItem({ id: "t3", title: "Task 3", blockedBy: ["t1"] }),
          ],
        }),
      ],
    }),
  ];
}

describe("removeEpic", () => {
  it("removes an epic and all its descendants", () => {
    const items = buildTree();
    const result = removeEpic(items, "e1");

    expect(result.ok).toBe(true);
    expect(result.deletedIds).toEqual(["e1", "f1", "t1", "t2", "f2"]);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("e2");
  });

  it("cleans blockedBy references pointing to deleted items", () => {
    const items = buildTree();
    removeEpic(items, "e1");

    // t3 was blocked by t1 (which was under e1) — reference should be cleaned
    const t3 = items[0].children![0].children![0];
    expect(t3.id).toBe("t3");
    expect(t3.blockedBy).toBeUndefined();
  });

  it("returns failure when epic id does not exist", () => {
    const items = buildTree();
    const result = removeEpic(items, "nonexistent");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(result.deletedIds).toEqual([]);
    // Tree should be unchanged
    expect(items.length).toBe(2);
  });

  it("returns failure when target item is not an epic", () => {
    const items = buildTree();
    const result = removeEpic(items, "f1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not an epic/i);
    expect(result.deletedIds).toEqual([]);
    // Tree should be unchanged
    expect(items.length).toBe(2);
  });

  it("handles an epic with no children", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Empty Epic", level: "epic" }),
      makeItem({ id: "e2", title: "Other Epic", level: "epic" }),
    ];
    const result = removeEpic(items, "e1");

    expect(result.ok).toBe(true);
    expect(result.deletedIds).toEqual(["e1"]);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("e2");
  });

  it("handles removing the only epic in the tree", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Solo Epic", level: "epic" }),
    ];
    const result = removeEpic(items, "e1");

    expect(result.ok).toBe(true);
    expect(result.deletedIds).toEqual(["e1"]);
    expect(items.length).toBe(0);
  });

  it("preserves blockedBy references that point to non-deleted items", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        children: [
          makeItem({ id: "t1", title: "Task 1" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Epic 2",
        level: "epic",
        children: [
          makeItem({ id: "t2", title: "Task 2", blockedBy: ["t1", "t3"] }),
          makeItem({ id: "t3", title: "Task 3" }),
        ],
      }),
    ];
    removeEpic(items, "e1");

    // t2 was blocked by t1 (deleted) and t3 (kept) — only t3 should remain
    const t2 = items[0].children![0];
    expect(t2.blockedBy).toEqual(["t3"]);
  });

  it("includes descriptive detail in success result", () => {
    const items = buildTree();
    const result = removeEpic(items, "e1");

    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/Epic One/);
    expect(result.detail).toMatch(/5/); // 5 items removed
  });

  it("does not mutate tree on failure", () => {
    const items = buildTree();
    const originalJson = JSON.stringify(items);

    removeEpic(items, "nonexistent");
    expect(JSON.stringify(items)).toBe(originalJson);

    removeEpic(items, "f1"); // not an epic
    expect(JSON.stringify(items)).toBe(originalJson);
  });
});
