import { describe, it, expect } from "vitest";
import { removeTask } from "../../../src/core/remove-task.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

function buildTree(): PRDItem[] {
  return [
    makeItem({
      id: "e1",
      title: "Epic One",
      level: "epic",
      children: [
        makeItem({
          id: "f1",
          title: "Feature 1",
          level: "feature",
          children: [
            makeItem({ id: "t1", title: "Task 1" }),
            makeItem({ id: "t2", title: "Task 2", status: "completed" }),
            makeItem({
              id: "t3",
              title: "Task 3",
              children: [
                makeItem({ id: "s1", title: "Subtask 1", level: "subtask" }),
                makeItem({ id: "s2", title: "Subtask 2", level: "subtask" }),
              ],
            }),
          ],
        }),
        makeItem({
          id: "f2",
          title: "Feature 2",
          level: "feature",
          children: [
            makeItem({ id: "t4", title: "Task 4", blockedBy: ["t1"] }),
          ],
        }),
      ],
    }),
  ];
}

describe("removeTask", () => {
  it("removes a task from its parent feature", () => {
    const items = buildTree();
    const result = removeTask(items, "t1");

    expect(result.ok).toBe(true);
    expect(result.deletedIds).toEqual(["t1"]);
    // f1 should now have only t2 and t3
    const f1 = items[0].children![0];
    expect(f1.children!.length).toBe(2);
    expect(f1.children!.map((c) => c.id)).toEqual(["t2", "t3"]);
  });

  it("removes a task and all its subtasks", () => {
    const items = buildTree();
    const result = removeTask(items, "t3");

    expect(result.ok).toBe(true);
    expect(result.deletedIds).toEqual(["t3", "s1", "s2"]);
    // f1 should now have only t1 and t2
    const f1 = items[0].children![0];
    expect(f1.children!.length).toBe(2);
    expect(f1.children!.map((c) => c.id)).toEqual(["t1", "t2"]);
  });

  it("cleans blockedBy references pointing to deleted task", () => {
    const items = buildTree();
    removeTask(items, "t1");

    // t4 was blocked by t1 — reference should be cleaned
    const t4 = items[0].children![1].children![0];
    expect(t4.id).toBe("t4");
    expect(t4.blockedBy).toBeUndefined();
  });

  it("preserves blockedBy references that point to non-deleted items", () => {
    const items: PRDItem[] = [
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
              makeItem({ id: "t1", title: "Task 1" }),
              makeItem({ id: "t2", title: "Task 2", blockedBy: ["t1", "t3"] }),
              makeItem({ id: "t3", title: "Task 3" }),
            ],
          }),
        ],
      }),
    ];
    removeTask(items, "t1");

    // t2 was blocked by t1 (deleted) and t3 (kept) — only t3 should remain
    const t2 = items[0].children![0].children![0];
    expect(t2.id).toBe("t2");
    expect(t2.blockedBy).toEqual(["t3"]);
  });

  it("returns failure when task id does not exist", () => {
    const items = buildTree();
    const result = removeTask(items, "nonexistent");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(result.deletedIds).toEqual([]);
    expect(result.parentAutoCompletions).toEqual([]);
  });

  it("returns failure when target item is not a task", () => {
    const items = buildTree();
    const result = removeTask(items, "f1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a task/i);
    expect(result.deletedIds).toEqual([]);
    expect(result.parentAutoCompletions).toEqual([]);
  });

  it("rejects subtasks (must use task level)", () => {
    const items = buildTree();
    const result = removeTask(items, "s1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a task/i);
    expect(result.deletedIds).toEqual([]);
  });

  it("rejects epics (must use task level)", () => {
    const items = buildTree();
    const result = removeTask(items, "e1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a task/i);
    expect(result.deletedIds).toEqual([]);
  });

  it("does not mutate tree on failure", () => {
    const items = buildTree();
    const originalJson = JSON.stringify(items);

    removeTask(items, "nonexistent");
    expect(JSON.stringify(items)).toBe(originalJson);

    removeTask(items, "f1"); // not a task
    expect(JSON.stringify(items)).toBe(originalJson);
  });

  it("handles task with no subtasks", () => {
    const items = buildTree();
    const result = removeTask(items, "t1");

    expect(result.ok).toBe(true);
    expect(result.deletedIds).toEqual(["t1"]);
  });

  it("includes descriptive detail in success result", () => {
    const items = buildTree();
    const result = removeTask(items, "t3");

    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/Task 3/);
    expect(result.detail).toMatch(/3/); // 3 items removed (task + 2 subtasks)
  });

  // ---- Parent auto-completion ------------------------------------------------

  it("detects parent auto-completion when removing the last pending task", () => {
    const items: PRDItem[] = [
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
              makeItem({ id: "t1", title: "Task 1" }),
              makeItem({ id: "t2", title: "Task 2", status: "completed" }),
            ],
          }),
        ],
      }),
    ];
    const result = removeTask(items, "t1");

    expect(result.ok).toBe(true);
    // f1 now only has t2 (completed) — it should be auto-completable
    expect(result.parentAutoCompletions.length).toBeGreaterThan(0);
    expect(result.parentAutoCompletions[0]).toMatchObject({
      id: "f1",
      title: "Feature 1",
      level: "feature",
    });
  });

  it("cascades auto-completion up the ancestor chain", () => {
    const items: PRDItem[] = [
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
              makeItem({ id: "t1", title: "Task 1" }),
              makeItem({ id: "t2", title: "Task 2", status: "completed" }),
            ],
          }),
        ],
      }),
    ];
    const result = removeTask(items, "t1");

    expect(result.ok).toBe(true);
    // f1 becomes auto-completable, then e1 (only child f1 would be done)
    expect(result.parentAutoCompletions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "f1" }),
        expect.objectContaining({ id: "e1" }),
      ]),
    );
  });

  it("does not auto-complete parents that still have pending children", () => {
    const items = buildTree();
    const result = removeTask(items, "t1");

    expect(result.ok).toBe(true);
    // f1 still has t2 (completed) and t3 (pending) — no auto-completion
    expect(result.parentAutoCompletions).toEqual([]);
  });

  it("does not auto-complete parents that are already completed", () => {
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
              makeItem({ id: "t1", title: "Task 1" }),
              makeItem({ id: "t2", title: "Task 2", status: "completed" }),
            ],
          }),
        ],
      }),
    ];
    const result = removeTask(items, "t1");

    expect(result.ok).toBe(true);
    // Parents are already completed — no auto-completion needed
    expect(result.parentAutoCompletions).toEqual([]);
  });

  it("does not auto-complete parent when it has no remaining children", () => {
    const items: PRDItem[] = [
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
              makeItem({ id: "t1", title: "Task 1" }),
            ],
          }),
        ],
      }),
    ];
    const result = removeTask(items, "t1");

    expect(result.ok).toBe(true);
    // f1 now has no children — empty parent should not auto-complete
    expect(result.parentAutoCompletions).toEqual([]);
  });

  it("treats deferred siblings as terminal for auto-completion", () => {
    const items: PRDItem[] = [
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
              makeItem({ id: "t1", title: "Task 1" }),
              makeItem({ id: "t2", title: "Task 2", status: "deferred" }),
            ],
          }),
        ],
      }),
    ];
    const result = removeTask(items, "t1");

    expect(result.ok).toBe(true);
    // f1 only has t2 (deferred) — deferred counts as terminal
    expect(result.parentAutoCompletions.length).toBeGreaterThan(0);
    expect(result.parentAutoCompletions[0]).toMatchObject({ id: "f1" });
  });
});
