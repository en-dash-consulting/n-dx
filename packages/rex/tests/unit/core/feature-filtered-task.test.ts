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
 * Helper to build a tree with two features under one epic.
 *
 * Structure:
 *   epic-1
 *     feature-A
 *       task-a1 (high)
 *       task-a2 (medium)
 *     feature-B
 *       task-b1 (critical)
 *       task-b2 (low)
 */
function makeTreeWithTwoFeatures(overrides?: {
  taskA1?: Partial<PRDItem>;
  taskA2?: Partial<PRDItem>;
  taskB1?: Partial<PRDItem>;
  taskB2?: Partial<PRDItem>;
}): PRDItem[] {
  return [
    makeItem({
      id: "epic-1",
      title: "Epic 1",
      level: "epic",
      children: [
        makeItem({
          id: "feature-A",
          title: "Feature A",
          level: "feature",
          children: [
            makeItem({ id: "task-a1", title: "Task A1", priority: "high", ...overrides?.taskA1 }),
            makeItem({ id: "task-a2", title: "Task A2", priority: "medium", ...overrides?.taskA2 }),
          ],
        }),
        makeItem({
          id: "feature-B",
          title: "Feature B",
          level: "feature",
          children: [
            makeItem({ id: "task-b1", title: "Task B1", priority: "critical", ...overrides?.taskB1 }),
            makeItem({ id: "task-b2", title: "Task B2", priority: "low", ...overrides?.taskB2 }),
          ],
        }),
      ],
    }),
  ];
}

describe("findNextTask with featureId", () => {
  it("only considers tasks under the specified feature", () => {
    const items = makeTreeWithTwoFeatures();
    // Without feature filter, task-b1 (critical) would win
    const unfiltered = findNextTask(items, new Set());
    expect(unfiltered!.item.id).toBe("task-b1");

    // With feature-A filter, only task-a1 (high) and task-a2 (medium) are candidates
    const filtered = findNextTask(items, new Set(), { featureId: "feature-A" });
    expect(filtered!.item.id).toBe("task-a1");
  });

  it("respects priority ordering within feature scope", () => {
    const items = makeTreeWithTwoFeatures();
    const result = findNextTask(items, new Set(), { featureId: "feature-B" });
    // task-b1 (critical) should beat task-b2 (low)
    expect(result!.item.id).toBe("task-b1");
  });

  it("respects dependency logic within feature scope", () => {
    const items = makeTreeWithTwoFeatures({
      taskB1: { blockedBy: ["task-a1"] }, // blocked by task in another feature
    });
    const result = findNextTask(items, new Set(), { featureId: "feature-B" });
    // task-b1 is blocked, only task-b2 is actionable
    expect(result!.item.id).toBe("task-b2");
  });

  it("returns null when no actionable tasks exist in the feature", () => {
    const items = makeTreeWithTwoFeatures({
      taskA1: { status: "completed" },
      taskA2: { status: "completed" },
    });
    const result = findNextTask(items, new Set(["task-a1", "task-a2"]), { featureId: "feature-A" });
    expect(result).toBeNull();
  });

  it("handles cross-feature dependencies by blocking tasks", () => {
    const items = makeTreeWithTwoFeatures({
      taskA1: { blockedBy: ["task-b1"] }, // depends on task in feature-B
    });
    // task-b1 is not completed, so task-a1 should be blocked
    const result = findNextTask(items, new Set(), { featureId: "feature-A" });
    expect(result!.item.id).toBe("task-a2");
  });

  it("unblocks tasks when cross-feature dependency is completed", () => {
    const items = makeTreeWithTwoFeatures({
      taskA1: { blockedBy: ["task-b1"] },
    });
    // task-b1 is completed — task-a1 should be unblocked and win (high > medium)
    const result = findNextTask(items, new Set(["task-b1"]), { featureId: "feature-A" });
    expect(result!.item.id).toBe("task-a1");
  });

  it("prefers in_progress tasks within feature scope", () => {
    const items = makeTreeWithTwoFeatures({
      taskA2: { status: "in_progress" },
    });
    const result = findNextTask(items, new Set(), { featureId: "feature-A" });
    // in_progress always wins — finish what you started
    expect(result!.item.id).toBe("task-a2");
  });

  it("includes subtasks of tasks within the feature", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "epic-1",
        title: "Epic 1",
        level: "epic",
        children: [
          makeItem({
            id: "feature-A",
            title: "Feature A",
            level: "feature",
            children: [
              makeItem({
                id: "task-a1",
                title: "Task A1",
                level: "task",
                children: [
                  makeItem({ id: "subtask-a1-1", title: "Subtask A1.1", level: "subtask", priority: "high" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set(), { featureId: "feature-A" });
    expect(result!.item.id).toBe("subtask-a1-1");
  });

  it("returns null when feature has no tasks", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "epic-1",
        title: "Epic 1",
        level: "epic",
        children: [
          makeItem({
            id: "feature-empty",
            title: "Empty Feature",
            level: "feature",
            children: [],
          }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set(), { featureId: "feature-empty" });
    expect(result).toBeNull();
  });

  it("ignores featureId when not provided (backward compatible)", () => {
    const items = makeTreeWithTwoFeatures();
    // Should behave exactly as before — task-b1 (critical) wins globally
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("task-b1");
  });
});

describe("findActionableTasks with featureId", () => {
  it("only returns tasks under the specified feature", () => {
    const items = makeTreeWithTwoFeatures();
    const results = findActionableTasks(items, new Set(), 20, { featureId: "feature-A" });
    const ids = results.map((r) => r.item.id);
    expect(ids).toEqual(["task-a1", "task-a2"]);
  });

  it("returns empty when all tasks in feature are done", () => {
    const items = makeTreeWithTwoFeatures({
      taskB1: { status: "completed" },
      taskB2: { status: "completed" },
    });
    const results = findActionableTasks(items, new Set(["task-b1", "task-b2"]), 20, { featureId: "feature-B" });
    expect(results).toHaveLength(0);
  });

  it("respects limit within feature scope", () => {
    const items = makeTreeWithTwoFeatures();
    const results = findActionableTasks(items, new Set(), 1, { featureId: "feature-A" });
    expect(results).toHaveLength(1);
    expect(results[0].item.id).toBe("task-a1");
  });

  it("ignores featureId when not provided", () => {
    const items = makeTreeWithTwoFeatures();
    const results = findActionableTasks(items, new Set());
    // All 4 tasks should be returned
    expect(results).toHaveLength(4);
  });
});
