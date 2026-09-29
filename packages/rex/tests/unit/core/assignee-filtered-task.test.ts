import { describe, it, expect } from "vitest";
import { findNextTask, findActionableTasks } from "../../../src/core/next-task.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

/**
 * Tree with two tasks — one assigned to alice, one unassigned.
 *
 *   epic-1
 *     task-mine  (high, assignee: 'alice <alice@example.com>')
 *     task-hi    (critical, no assignee)
 */
function makeTree(): PRDItem[] {
  return [
    makeItem({
      id: "epic-1",
      title: "Epic 1",
      level: "epic",
      children: [
        makeItem({ id: "task-mine", title: "Alice's Task", priority: "high", assignee: "alice <alice@example.com>" }),
        makeItem({ id: "task-hi", title: "High Priority Task", priority: "critical" }),
      ],
    }),
  ];
}

describe("findNextTask with assignee filter", () => {
  it("returns the highest-priority task without filter, regardless of assignee", () => {
    const items = makeTree();
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("task-hi");
  });

  it("returns only the assigned task when the assignee filter is active", () => {
    const items = makeTree();
    const result = findNextTask(items, new Set(), { assignee: "alice <alice@example.com>" });
    expect(result!.item.id).toBe("task-mine");
  });

  it("returns null when no task is assigned to the given identity", () => {
    const items = makeTree();
    const result = findNextTask(items, new Set(), { assignee: "bob <bob@example.com>" });
    expect(result).toBeNull();
  });

  it("a tree with no assignee fields at all selects exactly as it always has", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "epic-1",
        title: "Epic 1",
        level: "epic",
        children: [
          makeItem({ id: "task-a", title: "Task A" }),
          makeItem({ id: "task-b", title: "Task B", priority: "critical" }),
        ],
      }),
    ];
    const withoutOption = findNextTask(items, new Set());
    const withOption = findNextTask(items, new Set(), { assignee: "anyone <anyone@example.com>" });
    // Passing the option against a tree with no `assignee` fields matches
    // today's behavior exactly — nothing qualifies, since nothing is assigned
    // to anyone. Selection without the option is unaffected either way.
    expect(withoutOption!.item.id).toBe("task-b");
    expect(withOption).toBeNull();
  });

  it("does not match a substring or case-insensitive variant of the assignee", () => {
    const items = makeTree();
    const result = findNextTask(items, new Set(), { assignee: "Alice <alice@example.com>" });
    expect(result).toBeNull();
  });
});

describe("findActionableTasks with assignee filter", () => {
  it("returns only the task assigned to the given identity", () => {
    const items = makeTree();
    const results = findActionableTasks(items, new Set(), 20, { assignee: "alice <alice@example.com>" });
    expect(results).toHaveLength(1);
    expect(results[0].item.id).toBe("task-mine");
  });

  it("returns all tasks without the filter", () => {
    const items = makeTree();
    const results = findActionableTasks(items, new Set(), 20);
    expect(results).toHaveLength(2);
  });

  it("returns empty when no task matches the assignee", () => {
    const items = makeTree();
    const results = findActionableTasks(items, new Set(), 20, { assignee: "bob <bob@example.com>" });
    expect(results).toHaveLength(0);
  });

  it("combines with a tag filter (AND, not OR)", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "epic-1",
        title: "Epic 1",
        level: "epic",
        children: [
          makeItem({ id: "task-a", title: "A", tags: ["self-heal"], assignee: "alice <alice@example.com>" }),
          makeItem({ id: "task-b", title: "B", tags: ["self-heal"] }),
          makeItem({ id: "task-c", title: "C", assignee: "alice <alice@example.com>" }),
        ],
      }),
    ];
    const results = findActionableTasks(items, new Set(), 20, {
      tags: ["self-heal"],
      assignee: "alice <alice@example.com>",
    });
    expect(results).toHaveLength(1);
    expect(results[0].item.id).toBe("task-a");
  });
});
