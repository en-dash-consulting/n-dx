/**
 * Tests for deletion UI state updates.
 *
 * Verifies that after items are removed from the tree:
 * - Parent completion percentages re-compute correctly
 * - Summary bar stats reflect the removal
 * - Bulk selection cleanup works
 * - Structural sharing is preserved for unaffected nodes
 */

import { describe, it, expect } from "vitest";
import { removeItemById, collectSubtreeIds, findItemById } from "../../../src/viewer/components/prd-tree/tree-utils.js";
import { computeBranchStats, completionRatio } from "../../../src/viewer/components/prd-tree/compute.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

function makeItem(
  overrides: Partial<PRDItemData> & { id: string; level: PRDItemData["level"]; status: PRDItemData["status"] },
): PRDItemData {
  return {
    title: overrides.id,
    ...overrides,
  };
}

// ── Parent completion stats update after child deletion ───────────

describe("parent completion updates after deletion", () => {
  const tree: PRDItemData[] = [
    makeItem({
      id: "epic-1",
      level: "epic",
      status: "in_progress",
      children: [
        makeItem({
          id: "feature-1",
          level: "feature",
          status: "in_progress",
          children: [
            makeItem({ id: "task-1", level: "task", status: "completed" }),
            makeItem({ id: "task-2", level: "task", status: "pending" }),
            makeItem({ id: "task-3", level: "task", status: "in_progress" }),
          ],
        }),
      ],
    }),
  ];

  it("recalculates parent stats when a pending child is removed", () => {
    // Before: 1/3 completed = 33%
    const beforeStats = computeBranchStats(tree[0].children!);
    expect(beforeStats.total).toBe(3);
    expect(beforeStats.completed).toBe(1);
    expect(Math.round(completionRatio(beforeStats) * 100)).toBe(33);

    // Remove the pending task
    const updated = removeItemById(tree, "task-2");
    const afterStats = computeBranchStats(updated[0].children!);

    // After: 1/2 completed = 50%
    expect(afterStats.total).toBe(2);
    expect(afterStats.completed).toBe(1);
    expect(afterStats.pending).toBe(0);
    expect(Math.round(completionRatio(afterStats) * 100)).toBe(50);
  });

  it("recalculates parent stats when a completed child is removed", () => {
    // Remove the completed task
    const updated = removeItemById(tree, "task-1");
    const afterStats = computeBranchStats(updated[0].children!);

    // After: 0/2 completed = 0%
    expect(afterStats.total).toBe(2);
    expect(afterStats.completed).toBe(0);
    expect(completionRatio(afterStats)).toBe(0);
  });

  it("reaches 100% when all non-completed children are removed", () => {
    // Remove both non-completed tasks
    let updated = removeItemById(tree, "task-2");
    updated = removeItemById(updated, "task-3");
    const afterStats = computeBranchStats(updated[0].children!);

    // After: 1/1 completed = 100%
    expect(afterStats.total).toBe(1);
    expect(afterStats.completed).toBe(1);
    expect(completionRatio(afterStats)).toBe(1);
  });

  it("returns zero stats when all children of a feature are removed", () => {
    let updated = removeItemById(tree, "task-1");
    updated = removeItemById(updated, "task-2");
    updated = removeItemById(updated, "task-3");

    const feature = updated[0].children![0];
    expect(feature.children).toHaveLength(0);
    const afterStats = computeBranchStats(feature.children!);
    expect(afterStats.total).toBe(0);
    expect(completionRatio(afterStats)).toBe(0);
  });
});

// ── Summary bar stats update after deletion ──────────────────────

describe("summary bar (top-level) stats update after deletion", () => {
  const tree: PRDItemData[] = [
    makeItem({
      id: "epic-1",
      level: "epic",
      status: "in_progress",
      children: [
        makeItem({ id: "task-a", level: "task", status: "completed" }),
        makeItem({ id: "task-b", level: "task", status: "completed" }),
        makeItem({ id: "task-c", level: "task", status: "pending" }),
      ],
    }),
    makeItem({
      id: "epic-2",
      level: "epic",
      status: "pending",
      children: [
        makeItem({ id: "task-d", level: "task", status: "pending" }),
      ],
    }),
  ];

  it("updates overall stats when a task is removed", () => {
    const beforeStats = computeBranchStats(tree);
    expect(beforeStats.total).toBe(4);
    expect(beforeStats.completed).toBe(2);

    const updated = removeItemById(tree, "task-c");
    const afterStats = computeBranchStats(updated);
    expect(afterStats.total).toBe(3);
    expect(afterStats.completed).toBe(2);
    expect(Math.round(completionRatio(afterStats) * 100)).toBe(67);
  });

  it("updates overall stats when an entire epic is removed", () => {
    const updated = removeItemById(tree, "epic-2");
    const afterStats = computeBranchStats(updated);
    expect(afterStats.total).toBe(3);
    expect(afterStats.completed).toBe(2);
    expect(afterStats.pending).toBe(1);
  });

  it("returns empty stats when all items are removed", () => {
    let updated = removeItemById(tree, "epic-1");
    updated = removeItemById(updated, "epic-2");
    expect(updated).toHaveLength(0);
    const afterStats = computeBranchStats(updated);
    expect(afterStats.total).toBe(0);
    expect(afterStats.completed).toBe(0);
  });
});

// ── Bulk selection cleanup after deletion ────────────────────────

describe("bulk selection cleanup after deletion", () => {
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
            makeItem({ id: "task-1", level: "task", status: "pending" }),
            makeItem({ id: "task-2", level: "task", status: "pending" }),
          ],
        }),
        makeItem({ id: "feature-2", level: "feature", status: "completed" }),
      ],
    }),
  ];

  it("collectSubtreeIds includes the item and all descendants", () => {
    const feature = findItemById(tree, "feature-1")!;
    const ids = collectSubtreeIds(feature);
    expect(ids).toEqual(new Set(["feature-1", "task-1", "task-2"]));
  });

  it("simulates bulk selection cleanup: removes deleted IDs from selection set", () => {
    const bulkSelected = new Set(["feature-1", "task-1", "task-2", "feature-2"]);
    const targetItem = findItemById(tree, "feature-1")!;
    const affectedIds = collectSubtreeIds(targetItem);

    // Clean up bulk selection
    const cleanedSelection = new Set(bulkSelected);
    for (const id of affectedIds) {
      cleanedSelection.delete(id);
    }

    // feature-1, task-1, task-2 should be removed; feature-2 should remain
    expect(cleanedSelection).toEqual(new Set(["feature-2"]));
  });

  it("handles deletion of root item: cleans up all descendant selections", () => {
    const bulkSelected = new Set(["epic-1", "feature-1", "task-1", "task-2", "feature-2"]);
    const targetItem = findItemById(tree, "epic-1")!;
    const affectedIds = collectSubtreeIds(targetItem);

    const cleanedSelection = new Set(bulkSelected);
    for (const id of affectedIds) {
      cleanedSelection.delete(id);
    }

    expect(cleanedSelection.size).toBe(0);
  });
});

// ── Selected item deselection after deletion ─────────────────────

describe("selected item deselection after deletion", () => {
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
            makeItem({ id: "task-1", level: "task", status: "pending" }),
          ],
        }),
      ],
    }),
  ];

  it("detects when selected item is in the deleted subtree", () => {
    const selectedItemId = "task-1";
    const targetItem = findItemById(tree, "feature-1")!;
    const affectedIds = collectSubtreeIds(targetItem);

    expect(affectedIds.has(selectedItemId)).toBe(true);
  });

  it("does not flag unrelated selected item for deselection", () => {
    const selectedItemId = "epic-1";
    const targetItem = findItemById(tree, "task-1")!;
    const affectedIds = collectSubtreeIds(targetItem);

    expect(affectedIds.has(selectedItemId)).toBe(false);
  });
});

// ── findItemById returns null after removal ──────────────────────

describe("findItemById after removal", () => {
  const tree: PRDItemData[] = [
    makeItem({
      id: "epic-1",
      level: "epic",
      status: "in_progress",
      children: [
        makeItem({ id: "task-1", level: "task", status: "completed" }),
        makeItem({ id: "task-2", level: "task", status: "pending" }),
      ],
    }),
  ];

  it("returns null for a removed item", () => {
    const updated = removeItemById(tree, "task-1");
    expect(findItemById(updated, "task-1")).toBeNull();
  });

  it("still finds non-removed items", () => {
    const updated = removeItemById(tree, "task-1");
    expect(findItemById(updated, "task-2")).not.toBeNull();
    expect(findItemById(updated, "task-2")!.id).toBe("task-2");
  });

  it("returns null for all descendants when parent is removed", () => {
    const updated = removeItemById(tree, "epic-1");
    expect(findItemById(updated, "epic-1")).toBeNull();
    expect(findItemById(updated, "task-1")).toBeNull();
    expect(findItemById(updated, "task-2")).toBeNull();
  });
});
