import { describe, it, expect } from "vitest";
import type { PRDItem } from "../../../src/schema/v1.js";
import { isFullyCompleted, findPrunableItems, findKeptItems, pruneItems, countSubtree, mergeKeepReason, deleteKeepReason } from "../../../src/core/prune.js";

function item(overrides: Partial<PRDItem> & { id: string; title: string; level: PRDItem["level"] }): PRDItem {
  return { status: "pending", ...overrides };
}

describe("isFullyCompleted", () => {
  it("returns true for a completed leaf", () => {
    expect(isFullyCompleted(item({ id: "1", title: "Leaf", level: "task", status: "completed" }))).toBe(true);
  });

  it("returns false for a pending leaf", () => {
    expect(isFullyCompleted(item({ id: "1", title: "Leaf", level: "task", status: "pending" }))).toBe(false);
  });

  it("returns true when all children are completed", () => {
    const parent = item({
      id: "p", title: "Parent", level: "feature", status: "completed",
      children: [
        item({ id: "c1", title: "C1", level: "task", status: "completed" }),
        item({ id: "c2", title: "C2", level: "task", status: "completed" }),
      ],
    });
    expect(isFullyCompleted(parent)).toBe(true);
  });

  it("returns false when parent is completed but a child is not", () => {
    const parent = item({
      id: "p", title: "Parent", level: "feature", status: "completed",
      children: [
        item({ id: "c1", title: "C1", level: "task", status: "completed" }),
        item({ id: "c2", title: "C2", level: "task", status: "in_progress" }),
      ],
    });
    expect(isFullyCompleted(parent)).toBe(false);
  });

  it("checks deeply nested children", () => {
    const tree = item({
      id: "e", title: "Epic", level: "epic", status: "completed",
      children: [
        item({
          id: "f", title: "Feature", level: "feature", status: "completed",
          children: [
            item({
              id: "t", title: "Task", level: "task", status: "completed",
              children: [
                item({ id: "s", title: "Subtask", level: "subtask", status: "pending" }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(isFullyCompleted(tree)).toBe(false);
  });
});

describe("findPrunableItems", () => {
  it("returns empty array when nothing is completed", () => {
    const items = [
      item({ id: "e1", title: "Epic", level: "epic" }),
    ];
    expect(findPrunableItems(items)).toEqual([]);
  });

  it("returns a fully completed root item", () => {
    const items = [
      item({ id: "e1", title: "Done Epic", level: "epic", status: "completed" }),
      item({ id: "e2", title: "Active Epic", level: "epic" }),
    ];
    const prunable = findPrunableItems(items);
    expect(prunable).toHaveLength(1);
    expect(prunable[0].id).toBe("e1");
  });

  it("returns a completed subtree nested under an active parent", () => {
    const items = [
      item({
        id: "e1", title: "Epic", level: "epic", status: "in_progress",
        children: [
          item({ id: "f1", title: "Done Feature", level: "feature", status: "completed",
            children: [
              item({ id: "t1", title: "Done Task", level: "task", status: "completed" }),
            ],
          }),
          item({ id: "f2", title: "Active Feature", level: "feature" }),
        ],
      }),
    ];
    const prunable = findPrunableItems(items);
    expect(prunable).toHaveLength(1);
    expect(prunable[0].id).toBe("f1");
  });

  it("does not list children of a fully completed parent separately", () => {
    const items = [
      item({
        id: "e1", title: "Done Epic", level: "epic", status: "completed",
        children: [
          item({ id: "f1", title: "Done Feature", level: "feature", status: "completed" }),
        ],
      }),
    ];
    // Only the epic should appear, not the feature (it's part of the epic subtree)
    const prunable = findPrunableItems(items);
    expect(prunable).toHaveLength(1);
    expect(prunable[0].id).toBe("e1");
  });

  it("skips items that are completed but have non-completed children", () => {
    const items = [
      item({
        id: "e1", title: "Epic", level: "epic", status: "completed",
        children: [
          item({ id: "f1", title: "Feature", level: "feature", status: "in_progress" }),
        ],
      }),
    ];
    expect(findPrunableItems(items)).toEqual([]);
  });
});

describe("pruneItems", () => {
  it("removes fully completed root items", () => {
    const items = [
      item({ id: "e1", title: "Done", level: "epic", status: "completed" }),
      item({ id: "e2", title: "Active", level: "epic" }),
    ];
    const result = pruneItems(items);
    expect(result.pruned).toHaveLength(1);
    expect(result.pruned[0].id).toBe("e1");
    expect(result.prunedCount).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("e2");
  });

  it("removes fully completed subtrees from children", () => {
    const items = [
      item({
        id: "e1", title: "Epic", level: "epic", status: "in_progress",
        children: [
          item({ id: "f1", title: "Done Feature", level: "feature", status: "completed",
            children: [
              item({ id: "t1", title: "Done Task", level: "task", status: "completed" }),
            ],
          }),
          item({ id: "f2", title: "Active Feature", level: "feature" }),
        ],
      }),
    ];
    const result = pruneItems(items);
    expect(result.pruned).toHaveLength(1);
    expect(result.pruned[0].id).toBe("f1");
    expect(result.prunedCount).toBe(2); // f1 + t1
    expect(items[0].children).toHaveLength(1);
    expect(items[0].children![0].id).toBe("f2");
  });

  it("counts nested children in prunedCount", () => {
    const items = [
      item({
        id: "e1", title: "Done Epic", level: "epic", status: "completed",
        children: [
          item({
            id: "f1", title: "Feature", level: "feature", status: "completed",
            children: [
              item({
                id: "t1", title: "Task", level: "task", status: "completed",
                children: [
                  item({ id: "s1", title: "Subtask", level: "subtask", status: "completed" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const result = pruneItems(items);
    expect(result.prunedCount).toBe(4); // e1 + f1 + t1 + s1
    expect(items).toHaveLength(0);
  });

  it("preserves items with non-completed children", () => {
    const items = [
      item({
        id: "e1", title: "Epic", level: "epic", status: "completed",
        children: [
          item({ id: "f1", title: "Done", level: "feature", status: "completed" }),
          item({ id: "f2", title: "Active", level: "feature", status: "in_progress" }),
        ],
      }),
    ];
    const result = pruneItems(items);
    // e1 is NOT fully completed because f2 is in_progress
    // But f1 IS fully completed and can be pruned from e1's children
    expect(result.pruned).toHaveLength(1);
    expect(result.pruned[0].id).toBe("f1");
    expect(result.prunedCount).toBe(1);
    expect(items[0].children).toHaveLength(1);
    expect(items[0].children![0].id).toBe("f2");
  });

  it("returns empty result when nothing to prune", () => {
    const items = [
      item({ id: "e1", title: "Active", level: "epic" }),
    ];
    const result = pruneItems(items);
    expect(result.pruned).toEqual([]);
    expect(result.prunedCount).toBe(0);
    expect(items).toHaveLength(1);
  });

  it("handles empty items array", () => {
    const items: PRDItem[] = [];
    const result = pruneItems(items);
    expect(result.pruned).toEqual([]);
    expect(result.prunedCount).toBe(0);
  });

  it("prunes multiple completed subtrees at same level", () => {
    const items = [
      item({
        id: "e1", title: "Epic", level: "epic", status: "in_progress",
        children: [
          item({ id: "f1", title: "Done 1", level: "feature", status: "completed" }),
          item({ id: "f2", title: "Active", level: "feature" }),
          item({ id: "f3", title: "Done 2", level: "feature", status: "completed" }),
        ],
      }),
    ];
    const result = pruneItems(items);
    expect(result.pruned).toHaveLength(2);
    expect(result.pruned[0].id).toBe("f1");
    expect(result.pruned[1].id).toBe("f3");
    expect(result.prunedCount).toBe(2);
    expect(items[0].children).toHaveLength(1);
    expect(items[0].children![0].id).toBe("f2");
  });

  it("preserves pruned subtree structure (children intact)", () => {
    const items = [
      item({
        id: "e1", title: "Done Epic", level: "epic", status: "completed",
        children: [
          item({
            id: "f1", title: "Feature", level: "feature", status: "completed",
            children: [
              item({ id: "t1", title: "Task", level: "task", status: "completed" }),
            ],
          }),
        ],
      }),
    ];
    const result = pruneItems(items);
    // The pruned epic should still have its full subtree
    const prunedEpic = result.pruned[0];
    expect(prunedEpic.children).toHaveLength(1);
    expect(prunedEpic.children![0].id).toBe("f1");
    expect(prunedEpic.children![0].children).toHaveLength(1);
    expect(prunedEpic.children![0].children![0].id).toBe("t1");
  });
});

describe("countSubtree", () => {
  it("counts a single leaf item as 1", () => {
    expect(countSubtree(item({ id: "1", title: "Leaf", level: "task" }))).toBe(1);
  });

  it("counts item and all children", () => {
    const epic = item({
      id: "e1", title: "Epic", level: "epic", status: "completed",
      children: [
        item({ id: "f1", title: "Feature", level: "feature", status: "completed" }),
        item({ id: "f2", title: "Feature 2", level: "feature", status: "completed" }),
      ],
    });
    expect(countSubtree(epic)).toBe(3);
  });

  it("counts deeply nested subtrees", () => {
    const epic = item({
      id: "e1", title: "Epic", level: "epic", status: "completed",
      children: [
        item({
          id: "f1", title: "Feature", level: "feature", status: "completed",
          children: [
            item({
              id: "t1", title: "Task", level: "task", status: "completed",
              children: [
                item({ id: "s1", title: "Subtask", level: "subtask", status: "completed" }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(countSubtree(epic)).toBe(4);
  });

  it("counts item with empty children array as 1", () => {
    const leaf = item({ id: "1", title: "Leaf", level: "task", children: [] });
    expect(countSubtree(leaf)).toBe(1);
  });
});

describe("applied changes that retire or add product nodes", () => {
  const appliedFields = (delta: string) => ({ appliedAt: "2026-10-01T00:00:00.000Z", amends: [{ delta, target: "x" }] });
  const applied = (id: string, delta: string, children?: PRDItem[]) =>
    item({ id, title: id, level: "epic", status: "completed", children, ...appliedFields(delta) } as PRDItem);
  const plain = (id: string) => item({ id, title: id, level: "epic", status: "completed" });

  it.each(["removed", "added"])("keeps an applied change with a %s amendment, subtree included", (delta) => {
    const keep = applied("keep", delta, [item({ id: "t", title: "t", level: "task", status: "completed" })]);
    const items = [keep, plain("done")];
    expect(findPrunableItems(items).map((i) => i.id)).toEqual(["done"]);
    expect(pruneItems(items).pruned.map((i) => i.id)).toEqual(["done"]);
    expect(items.map((i) => i.id)).toEqual(["keep"]);
    expect(findKeptItems([keep])[0].reason).toContain(delta);
    expect(findKeptItems([keep])[0].reason).toMatch(delta === "removed" ? /retired/ : /came from/);
  });

  it("prunes an applied change that only modifies, or one never applied", () => {
    const modifies = applied("mod", "modified");
    const unapplied = item({ id: "un", title: "un", level: "epic", status: "completed", amends: [{ delta: "removed", target: "x" }] } as PRDItem);
    expect(pruneItems([modifies, unapplied]).pruned.map((i) => i.id)).toEqual(["mod", "un"]);
  });

  it("merge keeps every applied change; delete keeps what prune keeps, subtree included", () => {
    expect(mergeKeepReason(applied("mod", "modified"))).toMatch(/applied change/);
    expect(mergeKeepReason(plain("done"))).toBeUndefined();
    expect(deleteKeepReason(applied("mod", "modified"))).toBeUndefined();
    expect(deleteKeepReason(applied("keep", "removed"))).toMatch(/retired/);
    expect(deleteKeepReason(item({ id: "p", title: "p", level: "epic", children: [applied("keep", "added")] }))).toMatch(/^holds "keep", an applied change/);
  });

  it("does not prune a completed parent whose child is kept", () => {
    const parent = item({ id: "p", title: "p", level: "epic", status: "completed", children: [applied("keep", "removed"), plain("other")] });
    const items = [parent];
    expect(findPrunableItems(items).map((i) => i.id)).toEqual(["other"]);
    expect(pruneItems(items).pruned.map((i) => i.id)).toEqual(["other"]);
    expect(parent.children!.map((i) => i.id)).toEqual(["keep"]);
  });
});
