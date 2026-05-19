/**
 * Integration tests for completed task exclusion across all selection paths.
 *
 * Validates that:
 * - Explicit --task targeting a completed task throws TaskNotActionableError
 * - Auto-selection skips completed tasks
 * - Epic-filtered selection skips completed tasks
 * - All selection paths use a consistent completed-task filtering predicate
 */

import { describe, it, expect } from "vitest";
import type { PRDItem, PRDStore } from "@n-dx/rex";
import {
  assembleTaskBrief,
  TaskNotActionableError,
  collectEpicTaskIds,
  isCompletedTask,
} from "../../src/agent/planning/brief.js";

// ---------------------------------------------------------------------------
// Mock store for testing
// ---------------------------------------------------------------------------

function mockStore(items: PRDItem[]): PRDStore {
  return {
    loadDocument: async () => ({
      schema: "rex/v1",
      title: "Test",
      items,
    }),
    loadConfig: async () => ({
      schema: "rex/v1",
      project: "test",
      adapter: "file",
    }),
    loadWorkflow: async () => "",
    readLog: async () => [],
    saveDocument: async () => {},
    saveConfig: async () => {},
    getItem: async () => null,
    addItem: async () => {},
    updateItem: async () => {},
    removeItem: async () => {},
    appendLog: async () => {},
    saveWorkflow: async () => {},
    capabilities: () => ({ adapter: "file", supportsTransactions: false, supportsWatch: false }),
  };
}

// ---------------------------------------------------------------------------
// Shared predicate tests
// ---------------------------------------------------------------------------

describe("isCompletedTask — shared predicate", () => {
  it("returns true for completed status", () => {
    const item: PRDItem = {
      id: "done-1",
      title: "Completed task",
      status: "completed",
      level: "task",
    };
    expect(isCompletedTask(item)).toBe(true);
  });

  it("returns false for pending status", () => {
    const item: PRDItem = {
      id: "pending-1",
      title: "Pending task",
      status: "pending",
      level: "task",
    };
    expect(isCompletedTask(item)).toBe(false);
  });

  it("returns false for in_progress status", () => {
    const item: PRDItem = {
      id: "wip-1",
      title: "In progress task",
      status: "in_progress",
      level: "task",
    };
    expect(isCompletedTask(item)).toBe(false);
  });

  it("returns false for deferred status", () => {
    const item: PRDItem = {
      id: "deferred-1",
      title: "Deferred task",
      status: "deferred",
      level: "task",
    };
    expect(isCompletedTask(item)).toBe(false);
  });

  it("returns false for blocked status", () => {
    const item: PRDItem = {
      id: "blocked-1",
      title: "Blocked task",
      status: "blocked",
      level: "task",
    };
    expect(isCompletedTask(item)).toBe(false);
  });

  it("returns false for failing status", () => {
    const item: PRDItem = {
      id: "fail-1",
      title: "Failing task",
      status: "failing",
      level: "task",
    };
    expect(isCompletedTask(item)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Explicit --task targeting completed task
// ---------------------------------------------------------------------------

describe("assembleTaskBrief — explicit --task targeting completed task", () => {
  it("throws TaskNotActionableError when targeting completed task", async () => {
    const items: PRDItem[] = [
      {
        id: "done-1",
        title: "Already done",
        status: "completed",
        level: "task",
      },
    ];
    const store = mockStore(items);

    await expect(assembleTaskBrief(store, "done-1")).rejects.toThrow(TaskNotActionableError);
  });

  it("error message indicates completed status", async () => {
    const items: PRDItem[] = [
      {
        id: "done-2",
        title: "Finished work",
        status: "completed",
        level: "task",
      },
    ];
    const store = mockStore(items);

    try {
      await assembleTaskBrief(store, "done-2");
      throw new Error("Should have thrown TaskNotActionableError");
    } catch (err) {
      const e = err as TaskNotActionableError;
      expect(e.status).toBe("completed");
      expect(e.taskId).toBe("done-2");
      expect(e.message).toContain("completed");
    }
  });

  it("error includes helpful suggestion for completed tasks", async () => {
    const items: PRDItem[] = [
      {
        id: "done-3",
        title: "Task finished",
        status: "completed",
        level: "task",
      },
    ];
    const store = mockStore(items);

    try {
      await assembleTaskBrief(store, "done-3");
      throw new Error("Should have thrown TaskNotActionableError");
    } catch (err) {
      const e = err as TaskNotActionableError;
      expect(e.suggestion).toContain("n-dx status");
    }
  });

  it("error includes task title in message", async () => {
    const items: PRDItem[] = [
      {
        id: "done-4",
        title: "Deploy to production",
        status: "completed",
        level: "task",
      },
    ];
    const store = mockStore(items);

    try {
      await assembleTaskBrief(store, "done-4");
      throw new Error("Should have thrown TaskNotActionableError");
    } catch (err) {
      const e = err as TaskNotActionableError;
      expect(e.message).toContain("Deploy to production");
    }
  });
});

// ---------------------------------------------------------------------------
// Auto-selection skips completed tasks
// ---------------------------------------------------------------------------

describe("assembleTaskBrief — auto-selection skips completed tasks", () => {
  it("skips completed task and selects pending alternative", async () => {
    const items: PRDItem[] = [
      {
        id: "done-task",
        title: "Completed task",
        status: "completed",
        level: "task",
      },
      {
        id: "pending-task",
        title: "Pending task",
        status: "pending",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const { taskId } = await assembleTaskBrief(store);
    expect(taskId).toBe("pending-task");
  });

  it("skips all completed tasks when multiple exist", async () => {
    const items: PRDItem[] = [
      {
        id: "done-1",
        title: "Completed 1",
        status: "completed",
        level: "task",
      },
      {
        id: "done-2",
        title: "Completed 2",
        status: "completed",
        level: "task",
      },
      {
        id: "pending-1",
        title: "Pending 1",
        status: "pending",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const { taskId } = await assembleTaskBrief(store);
    expect(taskId).toBe("pending-1");
  });

  it("prefers in_progress over completed", async () => {
    const items: PRDItem[] = [
      {
        id: "done-task",
        title: "Completed task",
        status: "completed",
        level: "task",
      },
      {
        id: "wip-task",
        title: "In progress task",
        status: "in_progress",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const { taskId } = await assembleTaskBrief(store);
    expect(taskId).toBe("wip-task");
  });

  it("throws when all tasks are completed", async () => {
    const items: PRDItem[] = [
      {
        id: "done-1",
        title: "Completed 1",
        status: "completed",
        level: "task",
      },
      {
        id: "done-2",
        title: "Completed 2",
        status: "completed",
        level: "task",
      },
    ];
    const store = mockStore(items);

    await expect(assembleTaskBrief(store)).rejects.toThrow(
      "No actionable tasks found in PRD",
    );
  });
});

// ---------------------------------------------------------------------------
// Epic-filtered selection skips completed tasks
// ---------------------------------------------------------------------------

describe("assembleTaskBrief — epic-filtered selection skips completed tasks", () => {
  it("skips completed tasks in epic scope", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-auth",
        title: "Authentication",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "task-done",
            title: "Completed login",
            status: "completed",
            level: "task",
          },
          {
            id: "task-pending",
            title: "Add 2FA",
            status: "pending",
            level: "task",
          },
        ],
      },
    ];
    const store = mockStore(items);

    const { taskId } = await assembleTaskBrief(store, undefined, {
      epicId: "epic-auth",
    });
    expect(taskId).toBe("task-pending");
  });

  it("throws when all epic tasks are completed", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-api",
        title: "API",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "task-1",
            title: "Auth endpoint",
            status: "completed",
            level: "task",
          },
          {
            id: "task-2",
            title: "User endpoint",
            status: "completed",
            level: "task",
          },
        ],
      },
    ];
    const store = mockStore(items);

    await expect(
      assembleTaskBrief(store, undefined, { epicId: "epic-api" }),
    ).rejects.toThrow("No actionable tasks found in epic");
  });

  it("selects actionable epic task despite completed siblings", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-web",
        title: "Web",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "task-done-1",
            title: "Homepage",
            status: "completed",
            level: "task",
          },
          {
            id: "task-pending",
            title: "Contact page",
            status: "pending",
            level: "task",
          },
          {
            id: "task-done-2",
            title: "About page",
            status: "completed",
            level: "task",
          },
        ],
      },
    ];
    const store = mockStore(items);

    const { taskId, brief } = await assembleTaskBrief(store, undefined, {
      epicId: "epic-web",
    });
    expect(taskId).toBe("task-pending");
    expect(brief.task.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Subtask completed filtering
// ---------------------------------------------------------------------------

describe("assembleTaskBrief — subtask completed filtering", () => {
  it("skips completed subtasks in auto-selection", async () => {
    const items: PRDItem[] = [
      {
        id: "feature-1",
        title: "Feature",
        level: "feature",
        status: "pending",
        children: [
          {
            id: "task-1",
            title: "Task",
            level: "task",
            status: "pending",
            children: [
              {
                id: "subtask-done",
                title: "Completed subtask",
                status: "completed",
                level: "subtask",
              },
              {
                id: "subtask-pending",
                title: "Pending subtask",
                status: "pending",
                level: "subtask",
              },
            ],
          },
        ],
      },
    ];
    const store = mockStore(items);

    const { taskId } = await assembleTaskBrief(store);
    expect(taskId).toBe("subtask-pending");
  });
});

// ---------------------------------------------------------------------------
// Mixed status scenarios
// ---------------------------------------------------------------------------

describe("assembleTaskBrief — mixed completed and other non-actionable statuses", () => {
  it("skips both completed and deferred tasks", async () => {
    const items: PRDItem[] = [
      {
        id: "done-task",
        title: "Completed",
        status: "completed",
        level: "task",
      },
      {
        id: "defer-task",
        title: "Deferred",
        status: "deferred",
        level: "task",
      },
      {
        id: "pending-task",
        title: "Pending",
        status: "pending",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const { taskId } = await assembleTaskBrief(store);
    expect(taskId).toBe("pending-task");
  });

  it("throws when only completed or deferred tasks exist", async () => {
    const items: PRDItem[] = [
      {
        id: "done-1",
        title: "Completed",
        status: "completed",
        level: "task",
      },
      {
        id: "defer-1",
        title: "Deferred",
        status: "deferred",
        level: "task",
      },
    ];
    const store = mockStore(items);

    await expect(assembleTaskBrief(store)).rejects.toThrow(
      "No actionable tasks found in PRD",
    );
  });
});

// ---------------------------------------------------------------------------
// collectEpicTaskIds includes completed tasks (as expected)
// ---------------------------------------------------------------------------

describe("collectEpicTaskIds — includes completed tasks in epic scope", () => {
  it("includes completed tasks in the collected set (they are still epic members)", () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "task-done",
            title: "Completed",
            level: "task",
            status: "completed",
          },
          {
            id: "task-pending",
            title: "Pending",
            level: "task",
            status: "pending",
          },
        ],
      },
    ];

    const ids = collectEpicTaskIds(items, "epic-1");
    // Both tasks should be in the set — completed tasks are still members of the epic
    expect(ids.has("task-done")).toBe(true);
    expect(ids.has("task-pending")).toBe(true);
  });

  it("filters completed out in the selection layer, not the epic scope layer", () => {
    // This validates that epic scope collection includes completed tasks,
    // but the selection layer (assembleTaskBrief with epicId) filters them out
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "task-only-done",
            title: "Only completed",
            level: "task",
            status: "completed",
          },
        ],
      },
    ];

    // Step 1: Epic collection includes completed tasks
    const epicIds = collectEpicTaskIds(items, "epic-1");
    expect(epicIds.has("task-only-done")).toBe(true);

    // Step 2: Selection layer filters them out (would throw on assembly)
    // This is verified by the "throws when all epic tasks are completed" test
  });
});
