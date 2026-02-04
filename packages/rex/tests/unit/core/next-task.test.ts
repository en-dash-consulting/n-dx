import { describe, it, expect } from "vitest";
import { findNextTask, collectCompletedIds } from "../../../src/core/next-task.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("collectCompletedIds", () => {
  it("collects completed item ids", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "A", status: "completed" }),
      makeItem({ id: "2", title: "B", status: "pending" }),
      makeItem({
        id: "3",
        title: "C",
        level: "epic",
        children: [
          makeItem({ id: "4", title: "D", status: "completed" }),
        ],
      }),
    ];
    const ids = collectCompletedIds(items);
    expect(ids).toEqual(new Set(["1", "4"]));
  });
});

describe("findNextTask", () => {
  it("returns first pending leaf", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("t1");
  });

  it("skips completed items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "completed" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set(["t1"]));
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("t2");
  });

  it("skips deferred items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "deferred" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("skips blocked items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "blocked" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("skips items with unresolved blockers", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", blockedBy: ["t3"] }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("unblocks items when blockers are completed", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", blockedBy: ["t0"] }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set(["t0"]));
    expect(result!.item.id).toBe("t1");
  });

  it("prioritizes by priority (critical first)", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Low", priority: "low" }),
      makeItem({ id: "t2", title: "Critical", priority: "critical" }),
      makeItem({ id: "t3", title: "High", priority: "high" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("goes depth-first into children", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Deep Task" }),
            ],
          }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t1");
    expect(result!.parents.map((p) => p.id)).toEqual(["e1", "f1"]);
  });

  it("returns null when all done", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "completed" }),
      makeItem({ id: "t2", title: "Task 2", status: "deferred" }),
    ];
    const result = findNextTask(items, new Set(["t1"]));
    expect(result).toBeNull();
  });

  it("returns null for empty tree", () => {
    expect(findNextTask([], new Set())).toBeNull();
  });

  it("returns parent when all children are done", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set(["t1", "t2"]));
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("e1");
  });
});
