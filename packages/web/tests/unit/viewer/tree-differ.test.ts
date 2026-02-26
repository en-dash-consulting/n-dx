/**
 * Tests for structural sharing in PRD tree updates (tree-differ.ts).
 *
 * Verifies that:
 * - Unchanged items keep their original object references
 * - Only changed nodes and their ancestors get new references
 * - Full document diffing preserves structural sharing
 * - Incremental updates (applyItemUpdate) follow the same pattern
 * - Edge cases (empty trees, new items, removed items) are handled
 */

import { describe, it, expect } from "vitest";
import { diffItems, diffDocument, applyItemUpdate } from "../../../src/viewer/components/prd-tree/tree-differ.js";
import type { PRDItemData, PRDDocumentData } from "../../../src/viewer/components/prd-tree/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeItem(overrides: Partial<PRDItemData> & { id: string }): PRDItemData {
  return {
    title: `Item ${overrides.id}`,
    status: "pending",
    level: "task",
    ...overrides,
  };
}

function makeDoc(items: PRDItemData[]): PRDDocumentData {
  return { schema: "rex/v1", title: "Test PRD", items };
}

// ── diffItems ────────────────────────────────────────────────────────

describe("diffItems", () => {
  it("returns same reference when nothing changed", () => {
    const items: PRDItemData[] = [
      makeItem({ id: "a" }),
      makeItem({ id: "b" }),
    ];
    // Simulate a new parse of the same data
    const next: PRDItemData[] = [
      makeItem({ id: "a" }),
      makeItem({ id: "b" }),
    ];

    const result = diffItems(items, next);
    expect(result).toBe(items);
  });

  it("reuses unchanged items when one sibling changes", () => {
    const a = makeItem({ id: "a", status: "pending" });
    const b = makeItem({ id: "b", status: "pending" });
    const items = [a, b];

    const next = [
      makeItem({ id: "a", status: "pending" }),
      makeItem({ id: "b", status: "completed" }),
    ];

    const result = diffItems(items, next);
    // Array is new because b changed
    expect(result).not.toBe(items);
    // a is unchanged — same reference
    expect(result[0]).toBe(a);
    // b is changed — new reference
    expect(result[1]).not.toBe(b);
    expect(result[1].status).toBe("completed");
  });

  it("preserves deep subtree references when parent changes", () => {
    const subtask = makeItem({ id: "sub-1", level: "subtask" });
    const task = makeItem({
      id: "task-1",
      level: "task",
      status: "pending",
      children: [subtask],
    });
    const epic = makeItem({
      id: "epic-1",
      level: "epic",
      children: [task],
    });
    const items = [epic];

    // Only epic title changes
    const next = [
      makeItem({
        id: "epic-1",
        level: "epic",
        title: "Renamed Epic",
        children: [
          makeItem({
            id: "task-1",
            level: "task",
            status: "pending",
            children: [makeItem({ id: "sub-1", level: "subtask" })],
          }),
        ],
      }),
    ];

    const result = diffItems(items, next);
    expect(result).not.toBe(items);
    // Epic is new (title changed)
    expect(result[0]).not.toBe(epic);
    expect(result[0].title).toBe("Renamed Epic");
    // Task is unchanged — same reference
    expect(result[0].children![0]).toBe(task);
    // Subtask is unchanged — same reference
    expect(result[0].children![0].children![0]).toBe(subtask);
  });

  it("creates new references only along the changed path", () => {
    const leaf1 = makeItem({ id: "leaf-1", level: "subtask" });
    const leaf2 = makeItem({ id: "leaf-2", level: "subtask" });
    const task1 = makeItem({ id: "task-1", level: "task", children: [leaf1] });
    const task2 = makeItem({ id: "task-2", level: "task", children: [leaf2] });
    const items = [task1, task2];

    // Only leaf2 status changes
    const next = [
      makeItem({ id: "task-1", level: "task", children: [makeItem({ id: "leaf-1", level: "subtask" })] }),
      makeItem({ id: "task-2", level: "task", children: [makeItem({ id: "leaf-2", level: "subtask", status: "completed" })] }),
    ];

    const result = diffItems(items, next);
    expect(result).not.toBe(items);
    // task1 branch is completely unchanged
    expect(result[0]).toBe(task1);
    expect(result[0].children![0]).toBe(leaf1);
    // task2 is new (descendant changed)
    expect(result[1]).not.toBe(task2);
    // leaf2 is new (status changed)
    expect(result[1].children![0]).not.toBe(leaf2);
    expect(result[1].children![0].status).toBe("completed");
  });

  it("handles new items added to the tree", () => {
    const a = makeItem({ id: "a" });
    const items = [a];

    const next = [
      makeItem({ id: "a" }),
      makeItem({ id: "b" }),
    ];

    const result = diffItems(items, next);
    expect(result).not.toBe(items);
    expect(result.length).toBe(2);
    // Existing item unchanged
    expect(result[0]).toBe(a);
    // New item added
    expect(result[1].id).toBe("b");
  });

  it("handles items removed from the tree", () => {
    const a = makeItem({ id: "a" });
    const b = makeItem({ id: "b" });
    const items = [a, b];

    const next = [makeItem({ id: "a" })];

    const result = diffItems(items, next);
    expect(result).not.toBe(items);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(a);
  });

  it("handles empty arrays", () => {
    const empty: PRDItemData[] = [];
    expect(diffItems(empty, [])).toBe(empty);
    expect(diffItems([], [makeItem({ id: "a" })])).not.toBe(empty);
  });

  it("detects tag changes", () => {
    const a = makeItem({ id: "a", tags: ["ui"] });
    const items = [a];

    const next = [makeItem({ id: "a", tags: ["ui", "perf"] })];

    const result = diffItems(items, next);
    expect(result).not.toBe(items);
    expect(result[0]).not.toBe(a);
    expect(result[0].tags).toEqual(["ui", "perf"]);
  });

  it("detects acceptanceCriteria changes", () => {
    const a = makeItem({ id: "a", acceptanceCriteria: ["AC1"] });
    const items = [a];

    const next = [makeItem({ id: "a", acceptanceCriteria: ["AC1", "AC2"] })];

    const result = diffItems(items, next);
    expect(result).not.toBe(items);
    expect(result[0]).not.toBe(a);
  });

  it("handles reordered items", () => {
    const a = makeItem({ id: "a" });
    const b = makeItem({ id: "b" });
    const items = [a, b];

    // Same items, different order
    const next = [makeItem({ id: "b" }), makeItem({ id: "a" })];

    const result = diffItems(items, next);
    expect(result).not.toBe(items);
    // b is first now — its reference should be reused
    expect(result[0]).toBe(b);
    expect(result[1]).toBe(a);
  });
});

// ── diffDocument ─────────────────────────────────────────────────────

describe("diffDocument", () => {
  it("returns same reference when nothing changed", () => {
    const doc = makeDoc([makeItem({ id: "a" })]);
    const next = makeDoc([makeItem({ id: "a" })]);

    const result = diffDocument(doc, next);
    expect(result).toBe(doc);
  });

  it("returns new document when title changes", () => {
    const doc = makeDoc([makeItem({ id: "a" })]);
    const next: PRDDocumentData = { ...makeDoc([makeItem({ id: "a" })]), title: "New Title" };

    const result = diffDocument(doc, next);
    expect(result).not.toBe(doc);
    expect(result.title).toBe("New Title");
    // Items should still be shared
    expect(result.items).toBe(doc.items);
  });

  it("returns new document when items change, preserving unchanged refs", () => {
    const a = makeItem({ id: "a" });
    const b = makeItem({ id: "b" });
    const doc = makeDoc([a, b]);
    const next = makeDoc([
      makeItem({ id: "a" }),
      makeItem({ id: "b", status: "completed" }),
    ]);

    const result = diffDocument(doc, next);
    expect(result).not.toBe(doc);
    expect(result.items[0]).toBe(a);
    expect(result.items[1]).not.toBe(b);
  });

  it("returns next when prev is null", () => {
    const next = makeDoc([makeItem({ id: "a" })]);
    expect(diffDocument(null, next)).toBe(next);
  });
});

// ── applyItemUpdate ──────────────────────────────────────────────────

describe("applyItemUpdate", () => {
  it("updates a root-level item", () => {
    const a = makeItem({ id: "a", status: "pending" });
    const b = makeItem({ id: "b", status: "pending" });
    const items = [a, b];

    const result = applyItemUpdate(items, "a", { status: "completed" });
    expect(result).not.toBe(items);
    expect(result[0]).not.toBe(a);
    expect(result[0].status).toBe("completed");
    // b unchanged
    expect(result[1]).toBe(b);
  });

  it("updates a deeply nested item", () => {
    const subtask = makeItem({ id: "sub-1", level: "subtask", status: "pending" });
    const task = makeItem({ id: "task-1", level: "task", children: [subtask] });
    const epic = makeItem({ id: "epic-1", level: "epic", children: [task] });
    const otherEpic = makeItem({ id: "epic-2", level: "epic" });
    const items = [epic, otherEpic];

    const result = applyItemUpdate(items, "sub-1", { status: "completed" });

    // Path to changed node gets new references
    expect(result).not.toBe(items);
    expect(result[0]).not.toBe(epic);
    expect(result[0].children![0]).not.toBe(task);
    expect(result[0].children![0].children![0]).not.toBe(subtask);
    expect(result[0].children![0].children![0].status).toBe("completed");

    // Unrelated branch unchanged
    expect(result[1]).toBe(otherEpic);
  });

  it("returns same reference when item not found", () => {
    const items = [makeItem({ id: "a" })];
    const result = applyItemUpdate(items, "nonexistent", { status: "completed" });
    expect(result).toBe(items);
  });

  it("preserves sibling references in nested updates", () => {
    const sibling1 = makeItem({ id: "s1", level: "subtask" });
    const sibling2 = makeItem({ id: "s2", level: "subtask" });
    const parent = makeItem({ id: "p", level: "task", children: [sibling1, sibling2] });
    const items = [parent];

    const result = applyItemUpdate(items, "s1", { status: "in_progress" });
    expect(result[0].children![0]).not.toBe(sibling1);
    expect(result[0].children![0].status).toBe("in_progress");
    // Sibling unchanged
    expect(result[0].children![1]).toBe(sibling2);
  });
});

// ── Performance characteristics ──────────────────────────────────────

describe("performance characteristics", () => {
  it("scales sub-linearly: single-item change in large tree only creates O(depth) new objects", () => {
    // Build a tree with 100 epics, each with 10 tasks = 1000 items
    const items: PRDItemData[] = [];
    for (let i = 0; i < 100; i++) {
      const tasks: PRDItemData[] = [];
      for (let j = 0; j < 10; j++) {
        tasks.push(makeItem({ id: `task-${i}-${j}`, level: "task" }));
      }
      items.push(makeItem({ id: `epic-${i}`, level: "epic", children: tasks }));
    }

    // Change one task's status
    const next: PRDItemData[] = items.map((epic, i) => {
      if (i !== 50) {
        return makeItem({
          id: `epic-${i}`,
          level: "epic",
          children: epic.children!.map((task, j) =>
            makeItem({ id: `task-${i}-${j}`, level: "task" }),
          ),
        });
      }
      return makeItem({
        id: "epic-50",
        level: "epic",
        children: epic.children!.map((task, j) =>
          j === 5
            ? makeItem({ id: "task-50-5", level: "task", status: "completed" })
            : makeItem({ id: `task-50-${j}`, level: "task" }),
        ),
      });
    });

    const result = diffItems(items, next);

    // Count how many items have new references
    let newRefs = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i] !== items[i]) newRefs++;
      const oldChildren = items[i].children!;
      const newChildren = result[i].children!;
      for (let j = 0; j < oldChildren.length; j++) {
        if (newChildren[j] !== oldChildren[j]) newRefs++;
      }
    }

    // Only the changed epic and its changed task should be new (2 new refs)
    // not all 1100 items
    expect(newRefs).toBe(2);
  });

  it("applyItemUpdate creates minimal new references", () => {
    const items: PRDItemData[] = [];
    for (let i = 0; i < 50; i++) {
      const tasks: PRDItemData[] = [];
      for (let j = 0; j < 5; j++) {
        tasks.push(makeItem({ id: `t-${i}-${j}`, level: "task" }));
      }
      items.push(makeItem({ id: `e-${i}`, level: "epic", children: tasks }));
    }

    const result = applyItemUpdate(items, "t-25-3", { status: "completed" });

    // Count new refs at top level
    let topNewRefs = 0;
    for (let i = 0; i < items.length; i++) {
      if (result[i] !== items[i]) topNewRefs++;
    }
    // Only epic-25 should be new
    expect(topNewRefs).toBe(1);

    // Count new refs in children of changed epic
    let childNewRefs = 0;
    for (let j = 0; j < items[25].children!.length; j++) {
      if (result[25].children![j] !== items[25].children![j]) childNewRefs++;
    }
    // Only t-25-3 should be new
    expect(childNewRefs).toBe(1);
  });
});
