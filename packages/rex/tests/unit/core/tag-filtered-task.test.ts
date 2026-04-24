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
 * Tree with two tasks — one tagged 'self-heal', one untagged.
 *
 *   epic-1
 *     task-sh  (high, tags: ['self-heal'])
 *     task-hi  (critical, no tags)
 */
function makeTree(): PRDItem[] {
  return [
    makeItem({
      id: "epic-1",
      title: "Epic 1",
      level: "epic",
      children: [
        makeItem({ id: "task-sh", title: "Self Heal Task", priority: "high", tags: ["self-heal"] }),
        makeItem({ id: "task-hi", title: "High Priority Task", priority: "critical" }),
      ],
    }),
  ];
}

describe("findNextTask with tags filter", () => {
  it("returns the highest-priority task without filter", () => {
    const items = makeTree();
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("task-hi");
  });

  it("returns only tagged task when tags filter is active", () => {
    const items = makeTree();
    const result = findNextTask(items, new Set(), { tags: ["self-heal"] });
    expect(result!.item.id).toBe("task-sh");
  });

  it("returns null when no tasks match the tag filter", () => {
    const items = makeTree();
    const result = findNextTask(items, new Set(), { tags: ["nonexistent-tag"] });
    expect(result).toBeNull();
  });

  it("skips completed tagged tasks", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "epic-1",
        title: "Epic 1",
        level: "epic",
        children: [
          makeItem({ id: "task-sh", title: "Done", priority: "high", tags: ["self-heal"], status: "completed" }),
          makeItem({ id: "task-hi", title: "Other", priority: "critical" }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set(["task-sh"]), { tags: ["self-heal"] });
    expect(result).toBeNull();
  });

  it("matches any tag in the filter list (OR logic)", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "epic-1",
        title: "Epic 1",
        level: "epic",
        children: [
          makeItem({ id: "task-a", title: "Task A", tags: ["alpha"] }),
          makeItem({ id: "task-b", title: "Task B", tags: ["beta"], priority: "critical" }),
          makeItem({ id: "task-c", title: "Task C" }),
        ],
      }),
    ];
    // Should pick task-b (critical, matches "beta")
    const result = findNextTask(items, new Set(), { tags: ["alpha", "beta"] });
    expect(result!.item.id).toBe("task-b");
  });
});

describe("findActionableTasks with tags filter", () => {
  it("returns only tasks with matching tags", () => {
    const items = makeTree();
    const results = findActionableTasks(items, new Set(), 20, { tags: ["self-heal"] });
    expect(results).toHaveLength(1);
    expect(results[0].item.id).toBe("task-sh");
  });

  it("returns all tasks without filter", () => {
    const items = makeTree();
    const results = findActionableTasks(items, new Set(), 20);
    expect(results).toHaveLength(2);
  });

  it("returns empty when no tasks match", () => {
    const items = makeTree();
    const results = findActionableTasks(items, new Set(), 20, { tags: ["missing"] });
    expect(results).toHaveLength(0);
  });

  it("applies both featureId and tags filters together", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "epic-1",
        title: "Epic 1",
        level: "epic",
        children: [
          makeItem({
            id: "feature-a",
            title: "Feature A",
            level: "feature",
            children: [
              makeItem({ id: "task-a1", title: "A1", tags: ["self-heal"] }),
              makeItem({ id: "task-a2", title: "A2" }),
            ],
          }),
          makeItem({
            id: "feature-b",
            title: "Feature B",
            level: "feature",
            children: [
              makeItem({ id: "task-b1", title: "B1", tags: ["self-heal"], priority: "critical" }),
            ],
          }),
        ],
      }),
    ];
    // featureId restricts to feature-a; tags restricts to self-heal → only task-a1
    const results = findActionableTasks(items, new Set(), 20, {
      featureId: "feature-a",
      tags: ["self-heal"],
    });
    expect(results).toHaveLength(1);
    expect(results[0].item.id).toBe("task-a1");
  });
});
