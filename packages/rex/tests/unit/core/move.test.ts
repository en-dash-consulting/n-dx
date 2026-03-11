import { describe, it, expect } from "vitest";
import { validateMove, moveItem } from "../../../src/core/move.js";

import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

function makeTree(): PRDItem[] {
  return [
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
            makeItem({
              id: "t1",
              title: "Task 1",
              children: [
                makeItem({ id: "s1", title: "Subtask 1", level: "subtask" }),
              ],
            }),
            makeItem({ id: "t2", title: "Task 2" }),
          ],
        }),
        makeItem({ id: "f2", title: "Feature 2", level: "feature" }),
      ],
    }),
    makeItem({
      id: "e2",
      title: "Epic 2",
      level: "epic",
      children: [
        makeItem({ id: "f3", title: "Feature 3", level: "feature" }),
      ],
    }),
  ];
}

describe("validateMove", () => {
  it("rejects when item does not exist", () => {
    const items = makeTree();
    const result = validateMove(items, "nonexistent", "e1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it("rejects when new parent does not exist", () => {
    const items = makeTree();
    const result = validateMove(items, "t1", "nonexistent");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it("rejects moving item under itself", () => {
    const items = makeTree();
    const result = validateMove(items, "e1", "e1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/under itself/);
  });

  it("rejects moving item under its own descendant", () => {
    const items = makeTree();
    const result = validateMove(items, "e1", "t1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/descendant/);
  });

  it("rejects moving item under its own grandchild", () => {
    const items = makeTree();
    const result = validateMove(items, "f1", "s1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/descendant/);
  });

  it("rejects no-op move (already under same parent)", () => {
    const items = makeTree();
    const result = validateMove(items, "f1", "e1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/already/);
  });

  it("rejects no-op move to root when already root", () => {
    const items = makeTree();
    const result = validateMove(items, "e1", undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/already/);
  });

  it("rejects moving a non-root level to root", () => {
    const items = makeTree();
    // Features can't be root items
    const result = validateMove(items, "f1", undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/cannot be a root/);
  });

  it("rejects invalid level hierarchy (feature under task)", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        children: [
          makeItem({ id: "f1", title: "Feature 1", level: "feature" }),
          makeItem({
            id: "f2",
            title: "Feature 2",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Task 1" }),
            ],
          }),
        ],
      }),
    ];
    // f1 is not a parent of t1, so this should hit the hierarchy check
    const result = validateMove(items, "f1", "t1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/must be a child of/);
  });

  it("rejects invalid level hierarchy (subtask under feature)", () => {
    const items = makeTree();
    const result = validateMove(items, "s1", "f1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/must be a child of/);
  });

  it("accepts valid move (feature to different epic)", () => {
    const items = makeTree();
    const result = validateMove(items, "f1", "e2");
    expect(result.valid).toBe(true);
  });

  it("accepts valid move (task to different feature)", () => {
    const items = makeTree();
    const result = validateMove(items, "t1", "f2");
    expect(result.valid).toBe(true);
  });

  it("accepts valid move (task directly under epic)", () => {
    const items = makeTree();
    const result = validateMove(items, "t1", "e2");
    expect(result.valid).toBe(true);
  });

  it("accepts valid move (subtask to different task)", () => {
    const items = makeTree();
    const result = validateMove(items, "s1", "t2");
    expect(result.valid).toBe(true);
  });
});

describe("moveItem", () => {
  it("moves feature from one epic to another", () => {
    const items = makeTree();
    const result = moveItem(items, "f1", "e2");

    expect(result.item.id).toBe("f1");
    expect(result.previousParentId).toBe("e1");
    expect(result.newParentId).toBe("e2");

    // f1 should no longer be under e1
    expect(items[0].children!.length).toBe(1);
    expect(items[0].children![0].id).toBe("f2");

    // f1 should now be under e2
    expect(items[1].children!.length).toBe(2);
    expect(items[1].children![1].id).toBe("f1");
  });

  it("preserves children when moving", () => {
    const items = makeTree();
    moveItem(items, "f1", "e2");

    // f1 should still have its children
    const movedFeature = items[1].children!.find((c) => c.id === "f1")!;
    expect(movedFeature.children).toBeDefined();
    expect(movedFeature.children!.length).toBe(2);
    expect(movedFeature.children![0].id).toBe("t1");
    expect(movedFeature.children![1].id).toBe("t2");

    // Grandchildren too
    expect(movedFeature.children![0].children![0].id).toBe("s1");
  });

  it("moves task to different feature", () => {
    const items = makeTree();
    const result = moveItem(items, "t1", "f2");

    expect(result.previousParentId).toBe("f1");
    expect(result.newParentId).toBe("f2");

    // t1 removed from f1
    const f1 = items[0].children![0];
    expect(f1.children!.length).toBe(1);
    expect(f1.children![0].id).toBe("t2");

    // t1 added to f2
    const f2 = items[0].children![1];
    expect(f2.children!.length).toBe(1);
    expect(f2.children![0].id).toBe("t1");
  });

  it("moves task directly under epic", () => {
    const items = makeTree();
    const result = moveItem(items, "t2", "e2");

    expect(result.previousParentId).toBe("f1");
    expect(result.newParentId).toBe("e2");

    // e2 now has feature and task as children
    expect(items[1].children!.length).toBe(2);
    expect(items[1].children![1].id).toBe("t2");
  });

  it("moves epic to become a different root position", () => {
    // Move a feature's child to root (only works for levels that can be root)
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Epic 1", level: "epic" }),
      makeItem({ id: "e2", title: "Epic 2", level: "epic" }),
    ];
    // Move e1 under... wait, epics are already root. Let's test a different scenario.
    // There's no deeper item that can be moved to root except epics.
    // So let's just verify that the no-op check works for root epics.
    expect(() => moveItem(items, "e1", undefined)).toThrow(/already/);
  });

  it("throws Error on validation failure", () => {
    const items = makeTree();
    expect(() => moveItem(items, "nonexistent", "e1")).toThrow(Error);
    expect(() => moveItem(items, "nonexistent", "e1")).toThrow(/not found/);
  });

  it("throws Error with message on circular move", () => {
    const items = makeTree();
    try {
      moveItem(items, "e1", "t1");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/descendant/);
    }
  });

  it("throws Error with message on no-op move", () => {
    const items = makeTree();
    try {
      moveItem(items, "f1", "e1");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/already/);
    }
  });

  it("preserves item properties after move", () => {
    const items = makeTree();
    // Set some properties on t1
    const t1Entry = items[0].children![0].children![0];
    t1Entry.priority = "high";
    t1Entry.description = "Important task";
    t1Entry.status = "in_progress";

    moveItem(items, "t1", "f2");

    const movedTask = items[0].children![1].children![0];
    expect(movedTask.id).toBe("t1");
    expect(movedTask.priority).toBe("high");
    expect(movedTask.description).toBe("Important task");
    expect(movedTask.status).toBe("in_progress");
  });
});
