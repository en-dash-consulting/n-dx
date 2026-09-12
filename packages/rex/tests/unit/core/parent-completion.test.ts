import { describe, it, expect } from "vitest";
import { findAutoCompletions, reconcileAutoCompletions } from "../../../src/core/parent-completion.js";
import { makeItem } from "../../helpers/index.js";

describe("findAutoCompletions", () => {
  it("returns empty when item has no parent", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "completed" }),
    ];
    const result = findAutoCompletions(items, "t1");
    expect(result.completedIds).toEqual([]);
    expect(result.completedItems).toEqual([]);
  });

  it("returns empty when item is not found", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
    ];
    const result = findAutoCompletions(items, "unknown");
    expect(result.completedIds).toEqual([]);
  });

  it("auto-completes parent when all children are completed", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t2");
    expect(result.completedIds).toEqual(["f1"]);
    expect(result.completedItems).toEqual([
      { id: "f1", title: "Feature 1", level: "feature" },
    ]);
  });

  it("does not auto-complete when a sibling is deferred (GH #364)", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "deferred" }),
          makeItem({ id: "t3", title: "Task 3", status: "completed" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t3");
    expect(result.completedIds).toEqual([]);
  });

  it("does not auto-complete a parent when the just-changed item itself is deferred", () => {
    // A caller may invoke findAutoCompletions after ANY terminal-ish status
    // change (completed or deferred). If the triggering item landed on
    // "deferred" rather than "completed", it must not be treated as done —
    // even though every OTHER sibling is completed.
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "deferred" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t2");
    expect(result.completedIds).toEqual([]);
  });

  it("does not auto-complete when some children are still pending", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "pending" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t1");
    expect(result.completedIds).toEqual([]);
  });

  it("does not auto-complete when some children are in_progress", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "in_progress" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t1");
    expect(result.completedIds).toEqual([]);
  });

  it("does not auto-complete when some children are blocked", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "blocked" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t1");
    expect(result.completedIds).toEqual([]);
  });

  it("does not auto-complete parent that is already completed", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "completed",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t2");
    expect(result.completedIds).toEqual([]);
  });

  it("does not auto-complete parent that is deferred", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "deferred",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t2");
    expect(result.completedIds).toEqual([]);
  });

  it("does not auto-complete parent that is blocked", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "blocked",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t2");
    expect(result.completedIds).toEqual([]);
  });

  it("does not auto-complete when some children are failing", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "failing" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t1");
    expect(result.completedIds).toEqual([]);
  });

  it("propagates up multiple levels", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t1", title: "Task 1", status: "completed" }),
              makeItem({ id: "t2", title: "Task 2", status: "completed" }),
            ],
          }),
        ],
      }),
    ];
    // All tasks done → feature completable → epic has one child (feature) that will be completable
    const result = findAutoCompletions(items, "t2");
    expect(result.completedIds).toEqual(["f1", "e1"]);
    expect(result.completedItems).toEqual([
      { id: "f1", title: "Feature 1", level: "feature" },
      { id: "e1", title: "Epic 1", level: "epic" },
    ]);
  });

  it("stops propagation when a sibling feature is incomplete", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t1", title: "Task 1", status: "completed" }),
              makeItem({ id: "t2", title: "Task 2", status: "completed" }),
            ],
          }),
          makeItem({
            id: "f2",
            title: "Feature 2",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t3", title: "Task 3", status: "pending" }),
            ],
          }),
        ],
      }),
    ];
    // f1 is completable, but e1 still has f2 pending
    const result = findAutoCompletions(items, "t2");
    expect(result.completedIds).toEqual(["f1"]);
  });

  it("auto-completes a pending parent", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t1");
    expect(result.completedIds).toEqual(["f1"]);
  });

  it("handles deeply nested trees (4 levels)", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            status: "pending",
            children: [
              makeItem({
                id: "t1",
                title: "Task",
                level: "task",
                status: "pending",
                children: [
                  makeItem({ id: "s1", title: "Subtask 1", level: "subtask", status: "completed" }),
                  makeItem({ id: "s2", title: "Subtask 2", level: "subtask", status: "completed" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "s2");
    expect(result.completedIds).toEqual(["t1", "f1", "e1"]);
  });

  it("handles parent with no children (leaf parent)", () => {
    // Edge case: parent in the chain has no children — should not auto-complete
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Leaf task", status: "completed" }),
    ];
    const result = findAutoCompletions(items, "t1");
    expect(result.completedIds).toEqual([]);
  });
});

describe("reconcileAutoCompletions", () => {
  it("returns empty for empty tree", () => {
    const result = reconcileAutoCompletions([]);
    expect(result.completedIds).toEqual([]);
    expect(result.completedItems).toEqual([]);
  });

  it("returns empty when no parent qualifies", () => {
    const items = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "pending" }),
        ],
      }),
    ];
    const result = reconcileAutoCompletions(items);
    expect(result.completedIds).toEqual([]);
  });

  it("returns a stuck-pending feature whose all children are completed", () => {
    const items = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        ],
      }),
    ];
    const result = reconcileAutoCompletions(items);
    expect(result.completedIds).toEqual(["f1"]);
    expect(result.completedItems).toEqual([
      { id: "f1", title: "Feature 1", level: "feature" },
    ]);
  });

  it("does not treat deferred children as done (GH #364)", () => {
    const items = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "deferred" }),
        ],
      }),
    ];
    const result = reconcileAutoCompletions(items);
    expect(result.completedIds).toEqual([]);
  });

  it("does not treat blocked children as done", () => {
    const items = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "blocked" }),
        ],
      }),
    ];
    const result = reconcileAutoCompletions(items);
    expect(result.completedIds).toEqual([]);
  });

  it("does not treat failing children as done", () => {
    const items = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "failing" }),
        ],
      }),
    ];
    const result = reconcileAutoCompletions(items);
    expect(result.completedIds).toEqual([]);
  });

  it("does not return a feature with a pending child", () => {
    const items = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "pending" }),
        ],
      }),
    ];
    const result = reconcileAutoCompletions(items);
    expect(result.completedIds).toEqual([]);
  });

  it("does not touch already-completed parents", () => {
    const items = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "completed",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
        ],
      }),
    ];
    const result = reconcileAutoCompletions(items);
    expect(result.completedIds).toEqual([]);
  });

  it("propagates up: completes epic when feature was also stuck", () => {
    const items = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t1", title: "Task 1", status: "completed" }),
              makeItem({ id: "t2", title: "Task 2", status: "completed" }),
            ],
          }),
        ],
      }),
    ];
    const result = reconcileAutoCompletions(items);
    expect(result.completedIds).toEqual(["f1", "e1"]);
    expect(result.completedItems[0]).toMatchObject({ id: "f1", level: "feature" });
    expect(result.completedItems[1]).toMatchObject({ id: "e1", level: "epic" });
  });

  it("returns items bottom-up (child before parent)", () => {
    const items = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t1", title: "Task", status: "completed" }),
            ],
          }),
        ],
      }),
    ];
    const result = reconcileAutoCompletions(items);
    // f1 comes before e1 (bottom-up)
    expect(result.completedIds.indexOf("f1")).toBeLessThan(result.completedIds.indexOf("e1"));
  });

  it("stops at a sibling with non-terminal children — epic not healed", () => {
    const items = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t1", title: "Task 1", status: "completed" }),
            ],
          }),
          makeItem({
            id: "f2",
            title: "Feature 2",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t2", title: "Task 2", status: "pending" }),
            ],
          }),
        ],
      }),
    ];
    const result = reconcileAutoCompletions(items);
    // f1 qualifies; e1 does not (f2 still has pending child)
    expect(result.completedIds).toEqual(["f1"]);
  });

  it("heals multiple sibling features independently", () => {
    const items = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t1", title: "Task 1", status: "completed" }),
            ],
          }),
          makeItem({
            id: "f2",
            title: "Feature 2",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t2", title: "Task 2", status: "completed" }),
            ],
          }),
        ],
      }),
    ];
    const result = reconcileAutoCompletions(items);
    // Both features qualify; epic too (after both features are virtually completed)
    expect(result.completedIds).toContain("f1");
    expect(result.completedIds).toContain("f2");
    expect(result.completedIds).toContain("e1");
    // f1 and f2 must come before e1
    const e1Idx = result.completedIds.indexOf("e1");
    expect(result.completedIds.indexOf("f1")).toBeLessThan(e1Idx);
    expect(result.completedIds.indexOf("f2")).toBeLessThan(e1Idx);
  });
});

/**
 * GitHub #368. Distinct from #364, which is about which CHILD statuses count
 * as done — see the module header of parent-completion.ts. These are about
 * whether the PARENT may be touched at all.
 */
describe("cascade containment (GH #368)", () => {
  /**
   * The exact shape from the incident: someone else's `in_progress` task whose
   * only child is `completed`, sitting in an epic the run never touched.
   */
  function twoSiblingEpics(): PRDItem[] {
    return [
      makeItem({
        id: "epic-run",
        title: "Epic under the run",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "task-run",
            title: "Task the run is operating on",
            level: "task",
            status: "in_progress",
          }),
        ],
      }),
      makeItem({
        id: "epic-other",
        title: "Someone else's epic",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "task-other",
            title: "Open investigation",
            level: "task",
            status: "in_progress",
            children: [
              makeItem({ id: "sub-other", title: "Only subtask", level: "subtask", status: "completed" }),
            ],
          }),
        ],
      }),
    ];
  }

  describe("an explicit in_progress parent is not auto-completed", () => {
    it("findAutoCompletions leaves it alone when its last child completes", () => {
      const items = twoSiblingEpics();
      const result = findAutoCompletions(items, "sub-other");
      expect(result.completedIds).toEqual([]);
    });

    it("and the block also stops the grandparent epic completing", () => {
      const items = twoSiblingEpics();
      const result = findAutoCompletions(items, "sub-other");
      expect(result.completedIds).not.toContain("epic-other");
    });

    it("reconcileAutoCompletions leaves it alone during a whole-tree sweep", () => {
      const items = twoSiblingEpics();
      const result = reconcileAutoCompletions(items);
      expect(result.completedIds).toEqual([]);
    });
  });

  describe("a cascade cannot reach outside the run's subtree", () => {
    it("a sweep scoped to the run's task does not touch a sibling epic", () => {
      // Make the other epic fully sweepable so only containment can stop it:
      // pending parent, all children completed.
      const items = twoSiblingEpics();
      const other = items[1].children![0];
      other.status = "pending";

      // Unscoped, the sweep reaches into the sibling epic — the #368 bug.
      expect(reconcileAutoCompletions(items).completedIds).toEqual(
        expect.arrayContaining(["task-other", "epic-other"]),
      );

      // Scoped to the run's own task, it cannot.
      const scoped = reconcileAutoCompletions(items, { ancestorsOf: "task-run" });
      expect(scoped.completedIds).not.toContain("task-other");
      expect(scoped.completedIds).not.toContain("epic-other");
    });

    it("still heals a stuck ancestor of the run's own task", () => {
      const items = twoSiblingEpics();
      items[0].children![0].status = "completed";

      const scoped = reconcileAutoCompletions(items, { ancestorsOf: "task-run" });
      expect(scoped.completedIds).toEqual(["epic-run"]);
    });

    it("never completes the anchor item itself, only its ancestors", () => {
      const items = twoSiblingEpics();
      // A pending anchor whose own children are all done would be swept up by
      // an unscoped reconcile; scoping must confine the sweep to ancestors.
      items[0].children![0].status = "pending";
      items[0].children![0].children = [
        makeItem({ id: "sub-run", title: "Done", level: "subtask", status: "completed" }),
      ];

      const scoped = reconcileAutoCompletions(items, { ancestorsOf: "task-run" });
      expect(scoped.completedIds).not.toContain("task-run");
    });

    it("fails closed when the anchor id is unknown", () => {
      const items = twoSiblingEpics();
      items[1].children![0].status = "pending";

      // A lookup miss must not silently degrade to a whole-tree sweep.
      const scoped = reconcileAutoCompletions(items, { ancestorsOf: "no-such-id" });
      expect(scoped.completedIds).toEqual([]);
    });
  });
});
