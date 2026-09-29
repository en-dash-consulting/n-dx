/**
 * Unit tests for the id-based PRD tree diff.
 *
 * The categories are four-and-a-bit questions rather than a partition, and
 * the overlaps are the part worth pinning: a task added and finished between
 * the two trees is both `added` and `completed`, and a task that moved and
 * was renamed is both `moved` and `changed`. A test suite that asserted
 * disjoint categories would be asserting the wrong contract.
 */

import { describe, it, expect } from "vitest";
import { diffTrees, TREE_DIFF_COMPARED_FIELDS } from "../../../src/core/tree-diff.js";
import type { PRDItem } from "../../../src/schema/index.js";

function item(
  overrides: Partial<PRDItem> & { id: string; title: string },
): PRDItem {
  return { status: "pending", level: "task", ...overrides };
}

/** epic e1 → feature f1 → task t1, the shape most assertions start from. */
function baseTree(): PRDItem[] {
  return [
    item({
      id: "e1",
      title: "Epic One",
      level: "epic",
      children: [
        item({
          id: "f1",
          title: "Feature One",
          level: "feature",
          children: [item({ id: "t1", title: "Task One" })],
        }),
      ],
    }),
  ];
}

describe("diffTrees", () => {
  describe("identical trees", () => {
    it("produces an empty diff", () => {
      const diff = diffTrees(baseTree(), baseTree());

      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
      expect(diff.changed).toEqual([]);
      expect(diff.completed).toEqual([]);
      expect(diff.moved).toEqual([]);
      expect(diff.identical).toBe(true);
      expect(diff.counts).toEqual({
        added: 0,
        removed: 0,
        changed: 0,
        completed: 0,
        moved: 0,
      });
    });

    it("counts both sides' totals even when nothing differs", () => {
      const diff = diffTrees(baseTree(), baseTree());
      expect(diff.totals).toEqual({ from: 3, to: 3 });
    });

    it("treats two empty trees as identical", () => {
      const diff = diffTrees([], []);
      expect(diff.identical).toBe(true);
      expect(diff.totals).toEqual({ from: 0, to: 0 });
    });
  });

  describe("added", () => {
    it("reports an id present only in the target tree", () => {
      const to = baseTree();
      to[0].children![0].children!.push(item({ id: "t2", title: "Task Two" }));

      const diff = diffTrees(baseTree(), to);

      expect(diff.added.map((e) => e.id)).toEqual(["t2"]);
      expect(diff.identical).toBe(false);
    });

    it("carries the new item's ancestor chain, outermost first", () => {
      const to = baseTree();
      to[0].children![0].children!.push(item({ id: "t2", title: "Task Two" }));

      const diff = diffTrees(baseTree(), to);

      expect(diff.added[0].ancestors).toEqual([
        { id: "e1", title: "Epic One", level: "epic" },
        { id: "f1", title: "Feature One", level: "feature" },
      ]);
    });

    it("gives a root-level addition an empty ancestor chain", () => {
      const to = [...baseTree(), item({ id: "e2", title: "Epic Two", level: "epic" })];

      const diff = diffTrees(baseTree(), to);

      expect(diff.added.map((e) => e.id)).toEqual(["e2"]);
      expect(diff.added[0].ancestors).toEqual([]);
    });
  });

  describe("removed", () => {
    it("reports an id present only in the baseline, with its baseline ancestors", () => {
      const to = baseTree();
      to[0].children![0].children = [];

      const diff = diffTrees(baseTree(), to);

      expect(diff.removed.map((e) => e.id)).toEqual(["t1"]);
      expect(diff.removed[0].ancestors).toEqual([
        { id: "e1", title: "Epic One", level: "epic" },
        { id: "f1", title: "Feature One", level: "feature" },
      ]);
    });

    it("reports every descendant of a removed container, not just the container", () => {
      const diff = diffTrees(baseTree(), []);
      expect(diff.removed.map((e) => e.id).sort()).toEqual(["e1", "f1", "t1"]);
    });
  });

  describe("changed", () => {
    it("reports a compared field that differs, naming both values", () => {
      const to = baseTree();
      to[0].children![0].children![0].title = "Task One, renamed";

      const diff = diffTrees(baseTree(), to);

      expect(diff.changed.map((e) => e.id)).toEqual(["t1"]);
      expect(diff.changed[0].fields).toEqual([
        { field: "title", from: "Task One", to: "Task One, renamed" },
      ]);
    });

    it("ignores a field outside the compared set", () => {
      const to = baseTree();
      to[0].children![0].children![0].source = "somewhere-else";

      expect(diffTrees(baseTree(), to).changed).toEqual([]);
    });

    it("treats an absent field and an explicitly undefined one as equal", () => {
      const to = baseTree();
      to[0].children![0].children![0].description = undefined;

      expect(diffTrees(baseTree(), to).changed).toEqual([]);
    });

    it("reports a field gained from absent as a null-to-value change", () => {
      const to = baseTree();
      to[0].children![0].children![0].priority = "high";

      const diff = diffTrees(baseTree(), to);
      expect(diff.changed[0].fields).toEqual([
        { field: "priority", from: null, to: "high" },
      ]);
    });

    it("honours a caller-supplied compared-field set", () => {
      const to = baseTree();
      to[0].children![0].children![0].title = "Renamed";

      const diff = diffTrees(baseTree(), to, { comparedFields: ["status"] });
      expect(diff.changed).toEqual([]);
    });

    it("compares the documented default field set", () => {
      expect([...TREE_DIFF_COMPARED_FIELDS]).toEqual([
        "status",
        "title",
        "priority",
        "description",
        "lastModified",
      ]);
    });
  });

  describe("completed", () => {
    it("reports an item completed in the target but not the baseline", () => {
      const to = baseTree();
      to[0].children![0].children![0].status = "completed";

      const diff = diffTrees(baseTree(), to);

      expect(diff.completed.map((e) => e.id)).toEqual(["t1"]);
      // Status is a compared field, so the same item is also `changed`.
      expect(diff.changed.map((e) => e.id)).toEqual(["t1"]);
    });

    it("reports an item added already completed", () => {
      const to = baseTree();
      to[0].children![0].children!.push(
        item({ id: "t2", title: "Task Two", status: "completed" }),
      );

      const diff = diffTrees(baseTree(), to);

      expect(diff.completed.map((e) => e.id)).toEqual(["t2"]);
      expect(diff.added.map((e) => e.id)).toEqual(["t2"]);
    });

    it("does not report an item completed on both sides", () => {
      const from = baseTree();
      from[0].children![0].children![0].status = "completed";
      const to = baseTree();
      to[0].children![0].children![0].status = "completed";

      expect(diffTrees(from, to).completed).toEqual([]);
    });

    it("does not report an item that was re-opened", () => {
      const from = baseTree();
      from[0].children![0].children![0].status = "completed";

      const diff = diffTrees(from, baseTree());

      expect(diff.completed).toEqual([]);
      expect(diff.changed.map((e) => e.id)).toEqual(["t1"]);
    });
  });

  describe("moved", () => {
    it("reports an item reparented to another container", () => {
      const to: PRDItem[] = [
        item({
          id: "e1",
          title: "Epic One",
          level: "epic",
          children: [
            item({ id: "f1", title: "Feature One", level: "feature", children: [] }),
            item({
              id: "f2",
              title: "Feature Two",
              level: "feature",
              children: [item({ id: "t1", title: "Task One" })],
            }),
          ],
        }),
      ];

      const diff = diffTrees(baseTree(), to);

      expect(diff.moved.map((e) => e.id)).toEqual(["t1"]);
      expect(diff.moved[0].fromAncestors.map((a) => a.id)).toEqual(["e1", "f1"]);
      expect(diff.moved[0].ancestors.map((a) => a.id)).toEqual(["e1", "f2"]);
    });

    it("does not report a move when the item keeps its parent", () => {
      const to = baseTree();
      to[0].children![0].children!.push(item({ id: "t2", title: "Task Two" }));

      expect(diffTrees(baseTree(), to).moved).toEqual([]);
    });

    it("reports a promotion to the root as a move", () => {
      const to: PRDItem[] = [
        item({
          id: "e1",
          title: "Epic One",
          level: "epic",
          children: [item({ id: "f1", title: "Feature One", level: "feature", children: [] })],
        }),
        item({ id: "t1", title: "Task One" }),
      ];

      const diff = diffTrees(baseTree(), to);

      expect(diff.moved.map((e) => e.id)).toEqual(["t1"]);
      expect(diff.moved[0].fromAncestors.map((a) => a.id)).toEqual(["e1", "f1"]);
      expect(diff.moved[0].ancestors).toEqual([]);
    });

    it("reports a grandparent change even when the direct parent id is unchanged", () => {
      // f1 itself moved to e2, carrying t1 with it. t1's parent is still f1,
      // but its chain to the root is different — an item the reader would not
      // find where the baseline said it was.
      const to: PRDItem[] = [
        item({ id: "e1", title: "Epic One", level: "epic", children: [] }),
        item({
          id: "e2",
          title: "Epic Two",
          level: "epic",
          children: [
            item({
              id: "f1",
              title: "Feature One",
              level: "feature",
              children: [item({ id: "t1", title: "Task One" })],
            }),
          ],
        }),
      ];

      const diff = diffTrees(baseTree(), to);

      expect(diff.moved.map((e) => e.id).sort()).toEqual(["f1", "t1"]);
    });

    it("reports a move and a rename on the same item in both categories", () => {
      const to: PRDItem[] = [
        item({
          id: "e1",
          title: "Epic One",
          level: "epic",
          children: [
            item({ id: "f1", title: "Feature One", level: "feature", children: [] }),
            item({
              id: "f2",
              title: "Feature Two",
              level: "feature",
              children: [item({ id: "t1", title: "Task One, renamed" })],
            }),
          ],
        }),
      ];

      const diff = diffTrees(baseTree(), to);

      expect(diff.moved.map((e) => e.id)).toEqual(["t1"]);
      expect(diff.changed.map((e) => e.id)).toEqual(["t1"]);
    });
  });

  describe("determinism", () => {
    it("sorts every category by id so two runs produce the same payload", () => {
      const to = baseTree();
      const feature = to[0].children![0];
      feature.children!.push(
        item({ id: "t9", title: "Task Nine" }),
        item({ id: "t3", title: "Task Three" }),
        item({ id: "t5", title: "Task Five" }),
      );

      const diff = diffTrees(baseTree(), to);

      expect(diff.added.map((e) => e.id)).toEqual(["t3", "t5", "t9"]);
    });

    it("keeps the first occurrence when a tree repeats an id", () => {
      const from = baseTree();
      const to = baseTree();
      to[0].children![0].children!.push(item({ id: "t1", title: "Duplicate" }));

      // The duplicate is the second occurrence, so the compared item is still
      // the first — no spurious `changed` entry from a malformed tree.
      expect(diffTrees(from, to).changed).toEqual([]);
    });
  });
});
