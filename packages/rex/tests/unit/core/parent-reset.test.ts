import { describe, it, expect } from "vitest";
import { findParentResets } from "../../../src/core/parent-reset.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("findParentResets", () => {
  it("returns empty when parent is not completed", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "in_progress",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
        ],
      }),
    ];
    const result = findParentResets(items, "f1");
    expect(result.resetIds).toEqual([]);
    expect(result.resetItems).toEqual([]);
  });

  it("resets a root-level completed epic (no ancestors to cascade)", () => {
    const items: PRDItem[] = [
      makeItem({ id: "e1", title: "Epic 1", level: "epic", status: "completed" }),
    ];
    // New child added to e1 — e1 is completed so it should be reset
    const result = findParentResets(items, "e1");
    expect(result.resetIds).toEqual(["e1"]);
    expect(result.resetItems).toEqual([
      { id: "e1", title: "Epic 1", level: "epic" },
    ]);
  });

  it("resets completed parent when new child is added", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "completed",
        completedAt: "2025-01-01T00:00:00.000Z",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2 (new)", status: "pending" }),
        ],
      }),
    ];
    const result = findParentResets(items, "f1");
    expect(result.resetIds).toEqual(["f1"]);
    expect(result.resetItems).toEqual([
      { id: "f1", title: "Feature 1", level: "feature" },
    ]);
  });

  it("cascades reset up the hierarchy", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        status: "completed",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            status: "completed",
            children: [
              makeItem({ id: "t1", title: "Task 1", status: "completed" }),
              makeItem({ id: "t2", title: "Task 2 (new)", status: "pending" }),
            ],
          }),
        ],
      }),
    ];
    // f1 is completed but now has a pending child → should reset f1 and e1
    const result = findParentResets(items, "f1");
    expect(result.resetIds).toEqual(["f1", "e1"]);
    expect(result.resetItems).toEqual([
      { id: "f1", title: "Feature 1", level: "feature" },
      { id: "e1", title: "Epic 1", level: "epic" },
    ]);
  });

  it("only resets completed parents, not pending or in_progress", () => {
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
            status: "completed",
            children: [
              makeItem({ id: "t1", title: "Task 1", status: "pending" }),
            ],
          }),
        ],
      }),
    ];
    // f1 is completed → should reset. e1 is in_progress → should NOT reset.
    const result = findParentResets(items, "f1");
    expect(result.resetIds).toEqual(["f1"]);
    expect(result.resetItems).toEqual([
      { id: "f1", title: "Feature 1", level: "feature" },
    ]);
  });

  it("stops cascading when an ancestor is not completed", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        status: "completed",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            status: "in_progress",
            children: [
              makeItem({ id: "t1", title: "Task 1", status: "pending" }),
            ],
          }),
        ],
      }),
    ];
    // f1 is in_progress (not completed) → no reset needed. e1 check does not propagate.
    const result = findParentResets(items, "f1");
    expect(result.resetIds).toEqual([]);
  });

  it("resets epic when new feature is added to completed epic", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        status: "completed",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            status: "completed",
          }),
          makeItem({
            id: "f2",
            title: "Feature 2 (new)",
            level: "feature",
            status: "pending",
          }),
        ],
      }),
    ];
    const result = findParentResets(items, "e1");
    expect(result.resetIds).toEqual(["e1"]);
  });

  it("returns empty when item is not found", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
    ];
    const result = findParentResets(items, "nonexistent");
    expect(result.resetIds).toEqual([]);
  });

  it("handles deeply nested trees (4 levels)", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "completed",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            status: "completed",
            children: [
              makeItem({
                id: "t1",
                title: "Task",
                level: "task",
                status: "completed",
                children: [
                  makeItem({ id: "s1", title: "Subtask 1", level: "subtask", status: "completed" }),
                  makeItem({ id: "s2", title: "Subtask 2 (new)", level: "subtask", status: "pending" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    // All ancestors are completed; t1 now has a pending child → cascade all the way up
    const result = findParentResets(items, "t1");
    expect(result.resetIds).toEqual(["t1", "f1", "e1"]);
  });

  it("does not reset deferred parent", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "deferred",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "pending" }),
        ],
      }),
    ];
    const result = findParentResets(items, "f1");
    expect(result.resetIds).toEqual([]);
  });

  it("does not reset blocked parent", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "blocked",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "pending" }),
        ],
      }),
    ];
    const result = findParentResets(items, "f1");
    expect(result.resetIds).toEqual([]);
  });

  it("resets parent found by parentId (not item ID)", () => {
    // This tests the common usage: after addItem(child, parentId),
    // call findParentResets(items, parentId) to find ancestors to reset
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        status: "completed",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            status: "completed",
            children: [
              makeItem({ id: "t1", title: "Existing Task", status: "completed" }),
              makeItem({ id: "t2", title: "New Task", status: "pending" }),
            ],
          }),
        ],
      }),
    ];
    // Pass the parent ID (f1) where the new child was added
    const result = findParentResets(items, "f1");
    expect(result.resetIds).toEqual(["f1", "e1"]);
  });
});
