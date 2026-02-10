import { describe, it, expect } from "vitest";
import { validateMerge, previewMerge, mergeItems } from "../../../src/core/merge.js";
import { findItem } from "../../../src/core/tree.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

/** Standard tree: epic → feature → 3 tasks, one with subtasks. */
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
              description: "First task desc",
              acceptanceCriteria: ["AC1", "AC2"],
              tags: ["api", "core"],
              children: [
                makeItem({ id: "s1", title: "Subtask 1", level: "subtask" }),
                makeItem({ id: "s2", title: "Subtask 2", level: "subtask" }),
              ],
            }),
            makeItem({
              id: "t2",
              title: "Task 2",
              description: "Second task desc",
              acceptanceCriteria: ["AC2", "AC3"],
              tags: ["core", "ui"],
            }),
            makeItem({
              id: "t3",
              title: "Task 3",
              description: "Third task desc",
              tags: ["ui"],
              blockedBy: ["t1"],
            }),
          ],
        }),
        makeItem({
          id: "f2",
          title: "Feature 2",
          level: "feature",
          children: [
            makeItem({ id: "t4", title: "Task 4", blockedBy: ["t2"] }),
          ],
        }),
      ],
    }),
  ];
}

// ── validateMerge ────────────────────────────────────────────────────

describe("validateMerge", () => {
  it("rejects fewer than 2 items", () => {
    const items = makeTree();
    const result = validateMerge(items, ["t1"], "t1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least 2/i);
  });

  it("rejects when target is not in source IDs", () => {
    const items = makeTree();
    const result = validateMerge(items, ["t1", "t2"], "t3");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/target must be one of/i);
  });

  it("rejects when an item does not exist", () => {
    const items = makeTree();
    const result = validateMerge(items, ["t1", "nonexistent"], "t1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it("rejects items at different levels", () => {
    const items = makeTree();
    const result = validateMerge(items, ["f1", "t1"], "f1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/same level/i);
  });

  it("rejects items with different parents", () => {
    const items = makeTree();
    // t1 is under f1, t4 is under f2
    const result = validateMerge(items, ["t1", "t4"], "t1");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/siblings/i);
  });

  it("accepts valid sibling merge", () => {
    const items = makeTree();
    const result = validateMerge(items, ["t1", "t2"], "t1");
    expect(result.valid).toBe(true);
  });

  it("accepts merging all three siblings", () => {
    const items = makeTree();
    const result = validateMerge(items, ["t1", "t2", "t3"], "t1");
    expect(result.valid).toBe(true);
  });

  it("accepts merging features under the same epic", () => {
    const items = makeTree();
    const result = validateMerge(items, ["f1", "f2"], "f1");
    expect(result.valid).toBe(true);
  });
});

// ── previewMerge ─────────────────────────────────────────────────────

describe("previewMerge", () => {
  it("shows combined acceptance criteria (deduplicated)", () => {
    const items = makeTree();
    const preview = previewMerge(items, ["t1", "t2"], "t1");
    // AC1, AC2 from t1; AC3 from t2 (AC2 is deduplicated)
    expect(preview.target.acceptanceCriteria).toEqual(["AC1", "AC2", "AC3"]);
  });

  it("shows combined tags (deduplicated, sorted)", () => {
    const items = makeTree();
    const preview = previewMerge(items, ["t1", "t2"], "t1");
    expect(preview.target.tags).toEqual(["api", "core", "ui"]);
  });

  it("shows correct child count (target children + reparented)", () => {
    const items = makeTree();
    // t1 has 2 subtasks, t2 has 0
    const preview = previewMerge(items, ["t1", "t2"], "t1");
    expect(preview.target.childCount).toBe(2); // just t1's children
  });

  it("shows absorbed items", () => {
    const items = makeTree();
    const preview = previewMerge(items, ["t1", "t2", "t3"], "t1");
    expect(preview.absorbed).toHaveLength(2);
    expect(preview.absorbed.map((a) => a.id)).toEqual(["t2", "t3"]);
  });

  it("counts rewritten dependencies", () => {
    const items = makeTree();
    // t4 has blockedBy: ["t2"], so if t2 is absorbed into t1, that's 1 rewrite
    const preview = previewMerge(items, ["t1", "t2"], "t1");
    expect(preview.rewrittenDependencyCount).toBe(1);
  });

  it("excludes source IDs from blockedBy", () => {
    const items = makeTree();
    // t3 has blockedBy: ["t1"] — when merging t1+t3, that dep is internal
    const preview = previewMerge(items, ["t1", "t3"], "t1");
    expect(preview.target.blockedBy).toEqual([]);
  });

  it("respects custom title in options", () => {
    const items = makeTree();
    const preview = previewMerge(items, ["t1", "t2"], "t1", {
      title: "Consolidated Task",
    });
    expect(preview.target.title).toBe("Consolidated Task");
  });

  it("respects custom description in options", () => {
    const items = makeTree();
    const preview = previewMerge(items, ["t1", "t2"], "t1", {
      description: "Custom merged description",
    });
    expect(preview.target.description).toBe("Custom merged description");
  });

  it("combines descriptions with separator by default", () => {
    const items = makeTree();
    const preview = previewMerge(items, ["t1", "t2"], "t1");
    expect(preview.target.description).toContain("First task desc");
    expect(preview.target.description).toContain("Second task desc");
    expect(preview.target.description).toContain("---");
  });
});

// ── mergeItems ──────────────────────────────────────────────────────

describe("mergeItems", () => {
  it("merges two tasks and returns correct result", () => {
    const items = makeTree();
    const result = mergeItems(items, ["t1", "t2"], "t1");

    expect(result.targetId).toBe("t1");
    expect(result.absorbedIds).toEqual(["t2"]);
  });

  it("removes absorbed items from the tree", () => {
    const items = makeTree();
    mergeItems(items, ["t1", "t2"], "t1");

    expect(findItem(items, "t2")).toBeNull();
    expect(findItem(items, "t1")).not.toBeNull();
  });

  it("combines acceptance criteria on the target", () => {
    const items = makeTree();
    mergeItems(items, ["t1", "t2"], "t1");

    const target = findItem(items, "t1")!.item;
    expect(target.acceptanceCriteria).toEqual(["AC1", "AC2", "AC3"]);
  });

  it("combines tags on the target", () => {
    const items = makeTree();
    mergeItems(items, ["t1", "t2"], "t1");

    const target = findItem(items, "t1")!.item;
    expect(target.tags).toEqual(["api", "core", "ui"]);
  });

  it("combines descriptions with separator", () => {
    const items = makeTree();
    mergeItems(items, ["t1", "t2"], "t1");

    const target = findItem(items, "t1")!.item;
    expect(target.description).toContain("First task desc");
    expect(target.description).toContain("Second task desc");
  });

  it("rewrites blockedBy references to absorbed items", () => {
    const items = makeTree();
    // t4 has blockedBy: ["t2"]. After merging t1+t2 → t1, t4 should point to t1
    mergeItems(items, ["t1", "t2"], "t1");

    const t4 = findItem(items, "t4")!.item;
    expect(t4.blockedBy).toEqual(["t1"]);
  });

  it("removes internal blockedBy references between source items", () => {
    const items = makeTree();
    // t3 has blockedBy: ["t1"]. After merging t1+t3 → t1, blockedBy should be empty
    mergeItems(items, ["t1", "t3"], "t1");

    const target = findItem(items, "t1")!.item;
    expect(target.blockedBy).toBeUndefined();
  });

  it("reparents children of absorbed items under the target", () => {
    const items = makeTree();
    // Add a subtask to t2 so there's something to reparent
    const t2 = findItem(items, "t2")!.item;
    t2.children = [
      makeItem({ id: "s3", title: "Subtask 3", level: "subtask" }),
    ];

    const result = mergeItems(items, ["t1", "t2"], "t1");

    expect(result.reparentedChildIds).toEqual(["s3"]);

    // Verify s3 is now under t1
    const target = findItem(items, "t1")!.item;
    const childIds = (target.children ?? []).map((c) => c.id);
    expect(childIds).toContain("s1");
    expect(childIds).toContain("s2");
    expect(childIds).toContain("s3");
  });

  it("works with custom title", () => {
    const items = makeTree();
    mergeItems(items, ["t1", "t2"], "t1", { title: "Merged Task" });

    const target = findItem(items, "t1")!.item;
    expect(target.title).toBe("Merged Task");
  });

  it("handles merging features (children are tasks)", () => {
    const items = makeTree();
    // f2 has t4 as a child. Merging f1+f2 → f1 should reparent t4 under f1
    const result = mergeItems(items, ["f1", "f2"], "f1");

    expect(result.absorbedIds).toEqual(["f2"]);
    expect(result.reparentedChildIds).toEqual(["t4"]);
    expect(findItem(items, "f2")).toBeNull();

    const f1 = findItem(items, "f1")!.item;
    const childIds = (f1.children ?? []).map((c) => c.id);
    expect(childIds).toContain("t4");
  });

  it("deduplicates blockedBy references after rewriting", () => {
    const items = makeTree();
    // Make t4 depend on both t1 and t2. After merging t1+t2 → t1,
    // t4 should have blockedBy: ["t1"] (not ["t1", "t1"])
    const t4 = findItem(items, "t4")!.item;
    t4.blockedBy = ["t1", "t2"];

    mergeItems(items, ["t1", "t2"], "t1");

    const updatedT4 = findItem(items, "t4")!.item;
    expect(updatedT4.blockedBy).toEqual(["t1"]);
  });

  it("merges three items at once", () => {
    const items = makeTree();
    const result = mergeItems(items, ["t1", "t2", "t3"], "t2");

    expect(result.targetId).toBe("t2");
    expect(result.absorbedIds).toEqual(["t1", "t3"]);
    expect(findItem(items, "t1")).toBeNull();
    expect(findItem(items, "t3")).toBeNull();
    expect(findItem(items, "t2")).not.toBeNull();

    // t1's subtasks should be reparented under t2
    const target = findItem(items, "t2")!.item;
    const childIds = (target.children ?? []).map((c) => c.id);
    expect(childIds).toContain("s1");
    expect(childIds).toContain("s2");
  });
});
