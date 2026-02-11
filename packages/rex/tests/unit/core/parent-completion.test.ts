import { describe, it, expect } from "vitest";
import { findAutoCompletions } from "../../../src/core/parent-completion.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

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
        status: "in_progress",
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

  it("auto-completes parent when children are mix of completed and deferred", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "in_progress",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "deferred" }),
          makeItem({ id: "t3", title: "Task 3", status: "completed" }),
        ],
      }),
    ];
    const result = findAutoCompletions(items, "t3");
    expect(result.completedIds).toEqual(["f1"]);
  });

  it("does not auto-complete when some children are still pending", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "in_progress",
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
        status: "in_progress",
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
        status: "in_progress",
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
        status: "in_progress",
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
        status: "in_progress",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            status: "in_progress",
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
        status: "in_progress",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            status: "in_progress",
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

  it("auto-completes pending parent (not just in_progress)", () => {
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
        status: "in_progress",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            status: "in_progress",
            children: [
              makeItem({
                id: "t1",
                title: "Task",
                level: "task",
                status: "in_progress",
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
