import { describe, it, expect } from "vitest";
import {
  collectSubtreeIds,
  removeItemById,
} from "../../../src/viewer/components/prd-tree/tree-utils.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

function makeItem(
  overrides: Partial<PRDItemData> & { id: string; level: PRDItemData["level"]; status: PRDItemData["status"] },
): PRDItemData {
  return {
    title: overrides.id,
    ...overrides,
  };
}

// ── collectSubtreeIds ──────────────────────────────────────────────

describe("collectSubtreeIds", () => {
  it("returns only the item ID for a leaf node", () => {
    const leaf = makeItem({ id: "leaf", level: "subtask", status: "pending" });
    const ids = collectSubtreeIds(leaf);
    expect(ids).toEqual(new Set(["leaf"]));
  });

  it("returns the item ID and all descendant IDs", () => {
    const epic = makeItem({
      id: "epic-1",
      level: "epic",
      status: "in_progress",
      children: [
        makeItem({
          id: "feature-1",
          level: "feature",
          status: "pending",
          children: [
            makeItem({ id: "task-1", level: "task", status: "pending" }),
            makeItem({ id: "task-2", level: "task", status: "completed" }),
          ],
        }),
        makeItem({ id: "feature-2", level: "feature", status: "pending" }),
      ],
    });
    const ids = collectSubtreeIds(epic);
    expect(ids).toEqual(new Set(["epic-1", "feature-1", "task-1", "task-2", "feature-2"]));
  });

  it("handles items with empty children array", () => {
    const item = makeItem({ id: "x", level: "task", status: "pending", children: [] });
    expect(collectSubtreeIds(item)).toEqual(new Set(["x"]));
  });
});

// ── removeItemById ─────────────────────────────────────────────────

describe("removeItemById", () => {
  const tree: PRDItemData[] = [
    makeItem({
      id: "epic-1",
      level: "epic",
      status: "in_progress",
      children: [
        makeItem({
          id: "feature-1",
          level: "feature",
          status: "pending",
          children: [
            makeItem({ id: "task-1", level: "task", status: "completed" }),
            makeItem({ id: "task-2", level: "task", status: "pending" }),
          ],
        }),
      ],
    }),
    makeItem({ id: "epic-2", level: "epic", status: "pending" }),
  ];

  it("removes a root-level item", () => {
    const result = removeItemById(tree, "epic-2");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("epic-1");
  });

  it("removes a nested item and its descendants", () => {
    const result = removeItemById(tree, "feature-1");
    expect(result).toHaveLength(2);
    // epic-1 should no longer have feature-1 as a child
    expect(result[0].children).toHaveLength(0);
  });

  it("removes a leaf item from deep in the tree", () => {
    const result = removeItemById(tree, "task-1");
    expect(result).toHaveLength(2);
    const feature = result[0].children![0];
    expect(feature.children).toHaveLength(1);
    expect(feature.children![0].id).toBe("task-2");
  });

  it("returns the same array when ID is not found", () => {
    const result = removeItemById(tree, "nonexistent");
    expect(result).toHaveLength(2);
    // Items should be reference-equal when unchanged
    expect(result[0]).toBe(tree[0]);
    expect(result[1]).toBe(tree[1]);
  });

  it("returns empty array when removing the only item", () => {
    const single = [makeItem({ id: "only", level: "task", status: "pending" })];
    const result = removeItemById(single, "only");
    expect(result).toHaveLength(0);
  });

  it("is immutable — does not modify the original tree", () => {
    const original = JSON.parse(JSON.stringify(tree));
    removeItemById(tree, "task-1");
    // Original tree should be unchanged
    expect(JSON.parse(JSON.stringify(tree))).toEqual(original);
  });

  it("only shallow-copies items along the path to the removed item", () => {
    const result = removeItemById(tree, "task-1");
    // epic-2 is untouched — should be the same reference
    expect(result[1]).toBe(tree[1]);
    // epic-1 should be a new object (its children array changed)
    expect(result[0]).not.toBe(tree[0]);
    // feature-1 should be a new object (its children array changed)
    expect(result[0].children![0]).not.toBe(tree[0].children![0]);
  });
});
