import { describe, it, expect } from "vitest";
import {
  formatTaskBrief,
  assembleTaskBrief,
  getActionableTasks,
  TaskNotActionableError,
  collectEpicTaskIds,
} from "../../../src/agent/planning/brief.js";
import type { TaskBrief } from "../../../src/schema/v1.js";
import type { PRDStore, PRDItem } from "@n-dx/rex";

describe("formatTaskBrief", () => {
  const minimalBrief: TaskBrief = {
    task: {
      id: "task-1",
      title: "Implement login form",
      level: "task",
      status: "pending",
    },
    parentChain: [],
    siblings: [],
    requirements: [],
    project: { name: "my-app" },
    workflow: "",
    recentLog: [],
  };

  it("formats minimal brief", () => {
    const output = formatTaskBrief(minimalBrief);
    expect(output).toContain("## Current Task");
    expect(output).toContain("Implement login form");
    expect(output).toContain("task-1");
    expect(output).toContain("pending");
    expect(output).toContain("my-app");
  });

  it("includes description when present", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      task: {
        ...minimalBrief.task,
        description: "Create a login form with email/password fields",
      },
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("Create a login form with email/password fields");
  });

  it("includes acceptance criteria", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      task: {
        ...minimalBrief.task,
        acceptanceCriteria: ["Form validates email format", "Shows error on invalid login"],
      },
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("Acceptance Criteria:");
    expect(output).toContain("Form validates email format");
    expect(output).toContain("Shows error on invalid login");
  });

  it("includes acceptance criteria with file paths on tasks", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      task: {
        ...minimalBrief.task,
        acceptanceCriteria: [
          "Add validation to src/components/Form.tsx",
          "Update tests in tests/form.test.ts",
        ],
      },
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("Acceptance Criteria:");
    expect(output).toContain("src/components/Form.tsx");
    expect(output).toContain("tests/form.test.ts");
  });

  it("includes parent chain", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      parentChain: [
        { id: "epic-1", title: "Authentication", level: "epic" },
        { id: "feat-1", title: "Login Flow", level: "feature", description: "User login" },
      ],
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("## Context (Parent Chain)");
    expect(output).toContain("Authentication");
    expect(output).toContain("Login Flow");
    expect(output).toContain("User login");
  });

  it("includes siblings", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      siblings: [
        { id: "t2", title: "Signup form", status: "completed" },
        { id: "t3", title: "Forgot password", status: "pending" },
      ],
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("## Sibling Tasks");
    expect(output).toContain("[x] Signup form");
    expect(output).toContain("[ ] Forgot password");
  });

  it("includes workflow", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      workflow: "1. Read code\n2. Make changes\n3. Test",
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("## Workflow");
    expect(output).toContain("1. Read code");
  });

  it("includes project commands", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      project: {
        name: "my-app",
        validateCommand: "npm run typecheck",
        testCommand: "npm test",
      },
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("`npm run typecheck`");
    expect(output).toContain("`npm test`");
  });

  it("includes recent log entries", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      recentLog: [
        { timestamp: "2025-01-01T00:00:00Z", event: "task_started", detail: "Starting work" },
      ],
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("## Recent Activity");
    expect(output).toContain("task_started");
    expect(output).toContain("Starting work");
  });

  it("includes blockedBy when present", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      task: {
        ...minimalBrief.task,
        blockedBy: ["dep-1", "dep-2"],
      },
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("Blocked by: dep-1, dep-2");
  });

  it("omits blockedBy when not present", () => {
    const output = formatTaskBrief(minimalBrief);
    expect(output).not.toContain("Blocked by:");
  });

  it("includes PREVIOUS FAILURE section when failureReason is present", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      task: {
        ...minimalBrief.task,
        status: "failing",
        failureReason: "Tests broken: login form validation fails",
      },
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("## PREVIOUS FAILURE");
    expect(output).toContain("Tests broken: login form validation fails");
  });

  it("omits PREVIOUS FAILURE when failureReason is not present", () => {
    const output = formatTaskBrief(minimalBrief);
    expect(output).not.toContain("PREVIOUS FAILURE");
  });
});

// ---------------------------------------------------------------------------
// Mock store helper
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
    // Unused in these tests
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
// TaskNotActionableError
// ---------------------------------------------------------------------------

describe("TaskNotActionableError", () => {
  it("stores taskId, status, and suggestion", () => {
    const err = new TaskNotActionableError("abc-123", "completed", "Do something else");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TaskNotActionableError");
    expect(err.taskId).toBe("abc-123");
    expect(err.status).toBe("completed");
    expect(err.suggestion).toBe("Do something else");
    expect(err.message).toContain("completed");
    expect(err.message).toContain("abc-123");
  });
});

// ---------------------------------------------------------------------------
// assembleTaskBrief — invalid task status errors
// ---------------------------------------------------------------------------

describe("assembleTaskBrief — invalid task selection", () => {
  it("throws TaskNotActionableError for a completed task", async () => {
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

    try {
      await assembleTaskBrief(store, "done-1");
    } catch (err) {
      const e = err as TaskNotActionableError;
      expect(e.status).toBe("completed");
      expect(e.taskId).toBe("done-1");
      expect(e.message).toContain("completed");
      expect(e.suggestion).toBeTruthy();
    }
  });

  it("throws TaskNotActionableError for a deferred task", async () => {
    const items: PRDItem[] = [
      {
        id: "defer-1",
        title: "Put on hold",
        status: "deferred",
        level: "task",
      },
    ];
    const store = mockStore(items);

    await expect(assembleTaskBrief(store, "defer-1")).rejects.toThrow(TaskNotActionableError);

    try {
      await assembleTaskBrief(store, "defer-1");
    } catch (err) {
      const e = err as TaskNotActionableError;
      expect(e.status).toBe("deferred");
      expect(e.taskId).toBe("defer-1");
      expect(e.message).toContain("deferred");
      expect(e.suggestion).toContain("rex update");
    }
  });

  it("suggests using rex status for completed tasks", async () => {
    const items: PRDItem[] = [
      {
        id: "done-2",
        title: "Finished task",
        status: "completed",
        level: "task",
      },
    ];
    const store = mockStore(items);

    try {
      await assembleTaskBrief(store, "done-2");
    } catch (err) {
      const e = err as TaskNotActionableError;
      expect(e.suggestion).toContain("n-dx status");
    }
  });

  it("suggests reactivating for deferred tasks", async () => {
    const items: PRDItem[] = [
      {
        id: "defer-2",
        title: "Deferred task",
        status: "deferred",
        level: "task",
      },
    ];
    const store = mockStore(items);

    try {
      await assembleTaskBrief(store, "defer-2");
    } catch (err) {
      const e = err as TaskNotActionableError;
      expect(e.suggestion).toContain("rex update");
      expect(e.suggestion).toContain("pending");
    }
  });

  it("throws TaskNotActionableError for a blocked task", async () => {
    const items: PRDItem[] = [
      {
        id: "blocked-1",
        title: "Waiting on API",
        status: "blocked",
        level: "task",
        blockedBy: ["dep-1"],
      },
    ];
    const store = mockStore(items);

    await expect(assembleTaskBrief(store, "blocked-1")).rejects.toThrow(TaskNotActionableError);

    try {
      await assembleTaskBrief(store, "blocked-1");
    } catch (err) {
      const e = err as TaskNotActionableError;
      expect(e.status).toBe("blocked");
      expect(e.taskId).toBe("blocked-1");
      expect(e.message).toContain("blocked");
      expect(e.suggestion).toContain("blocked");
      expect(e.suggestion).toContain("rex update");
    }
  });

  it("allows pending tasks through", async () => {
    const items: PRDItem[] = [
      {
        id: "ok-1",
        title: "Ready to go",
        status: "pending",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const { brief, taskId } = await assembleTaskBrief(store, "ok-1");
    expect(taskId).toBe("ok-1");
    expect(brief.task.status).toBe("pending");
  });

  it("allows in_progress tasks through", async () => {
    const items: PRDItem[] = [
      {
        id: "wip-1",
        title: "Work in progress",
        status: "in_progress",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const { brief, taskId } = await assembleTaskBrief(store, "wip-1");
    expect(taskId).toBe("wip-1");
    expect(brief.task.status).toBe("in_progress");
  });

  it("includes the invalid value in the error message", async () => {
    const items: PRDItem[] = [
      {
        id: "blocked-test",
        title: "Blocked task",
        status: "blocked",
        level: "task",
      },
    ];
    const store = mockStore(items);

    try {
      await assembleTaskBrief(store, "blocked-test");
    } catch (err) {
      const e = err as TaskNotActionableError;
      // Error message should include the status value
      expect(e.message).toContain("blocked");
      // And the status property should match
      expect(e.status).toBe("blocked");
    }
  });

  it("includes task title in error message", async () => {
    const items: PRDItem[] = [
      {
        id: "done-3",
        title: "Setup CI pipeline",
        status: "completed",
        level: "task",
      },
    ];
    const store = mockStore(items);

    try {
      await assembleTaskBrief(store, "done-3");
    } catch (err) {
      const e = err as TaskNotActionableError;
      expect(e.message).toContain("Setup CI pipeline");
    }
  });

  it("includes blockedBy in task brief", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Depends on dep",
        status: "pending",
        level: "task",
        blockedBy: ["dep-1"],
      },
    ];
    const store = mockStore(items);

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.task.blockedBy).toEqual(["dep-1"]);
  });
});

// ---------------------------------------------------------------------------
// assembleTaskBrief — auto-selection and context assembly
// ---------------------------------------------------------------------------

describe("assembleTaskBrief — auto-selection", () => {
  it("selects the first actionable task when no taskId provided", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "First task",
        status: "pending",
        level: "task",
      },
      {
        id: "task-2",
        title: "Second task",
        status: "pending",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const { taskId, brief } = await assembleTaskBrief(store);
    expect(taskId).toBe("task-1");
    expect(brief.task.title).toBe("First task");
  });

  it("selects in_progress task over pending when auto-selecting", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Pending task",
        status: "pending",
        level: "task",
      },
      {
        id: "task-2",
        title: "In progress task",
        status: "in_progress",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const { taskId, brief } = await assembleTaskBrief(store);
    expect(taskId).toBe("task-2");
    expect(brief.task.status).toBe("in_progress");
  });

  it("skips completed tasks during auto-selection", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Completed task",
        status: "completed",
        level: "task",
      },
      {
        id: "task-2",
        title: "Actionable task",
        status: "pending",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const { taskId } = await assembleTaskBrief(store);
    expect(taskId).toBe("task-2");
  });

  it("throws when no actionable tasks exist", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Completed",
        status: "completed",
        level: "task",
      },
      {
        id: "task-2",
        title: "Also completed",
        status: "completed",
        level: "task",
      },
    ];
    const store = mockStore(items);

    await expect(assembleTaskBrief(store)).rejects.toThrow("No actionable tasks found in PRD");
  });

  it("throws when task not found with explicit taskId", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Existing task",
        status: "pending",
        level: "task",
      },
    ];
    const store = mockStore(items);

    await expect(assembleTaskBrief(store, "non-existent")).rejects.toThrow(
      "Task not found: non-existent",
    );
  });

  it("excludeTaskIds marks tasks as completed for dependency resolution", async () => {
    // If a task is blocked by another task and we mark the blocker as excluded/completed,
    // the blocked task becomes actionable because its dependency is considered resolved.
    // This is used for skipping stuck tasks - if a task is stuck, its dependents can
    // still make progress.
    const items: PRDItem[] = [
      {
        id: "blocker-task",
        title: "Blocker task",
        status: "pending",
        level: "task",
        priority: "low", // Lower priority so blocked-task wins when both are actionable
      },
      {
        id: "blocked-task",
        title: "Blocked task",
        status: "pending",
        level: "task",
        priority: "high",
        blockedBy: ["blocker-task"],
      },
    ];
    const store = mockStore(items);

    // Without exclusion, blocked-task is not actionable because blocker-task isn't done
    const { taskId: firstSelection } = await assembleTaskBrief(store);
    expect(firstSelection).toBe("blocker-task");

    // With blocker excluded, its ID is treated as "completed" for dependency resolution.
    // Now blocked-task has its dependency resolved and becomes actionable.
    // Since blocked-task has higher priority, it gets selected.
    const { taskId: withExclusion } = await assembleTaskBrief(store, undefined, {
      excludeTaskIds: new Set(["blocker-task"]),
    });
    expect(withExclusion).toBe("blocked-task");
  });
});

// ---------------------------------------------------------------------------
// collectEpicTaskIds
// ---------------------------------------------------------------------------

describe("collectEpicTaskIds", () => {
  it("returns empty set for non-existent epic", () => {
    const items: PRDItem[] = [
      { id: "epic-1", title: "Epic", level: "epic", status: "pending" },
    ];
    const ids = collectEpicTaskIds(items, "nonexistent");
    expect(ids.size).toBe(0);
  });

  it("collects task IDs from epic with flat tasks", () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          { id: "task-1", title: "Task 1", level: "task", status: "pending" },
          { id: "task-2", title: "Task 2", level: "task", status: "completed" },
        ],
      },
    ];

    const ids = collectEpicTaskIds(items, "epic-1");
    expect(ids.size).toBe(2);
    expect(ids.has("task-1")).toBe(true);
    expect(ids.has("task-2")).toBe(true);
  });

  it("collects task and subtask IDs from nested structure", () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "feat-1",
            title: "Feature",
            level: "feature",
            status: "pending",
            children: [
              {
                id: "task-1",
                title: "Task 1",
                level: "task",
                status: "pending",
                children: [
                  { id: "subtask-1", title: "Subtask 1", level: "subtask", status: "pending" },
                ],
              },
            ],
          },
        ],
      },
    ];

    const ids = collectEpicTaskIds(items, "epic-1");
    expect(ids.size).toBe(2);
    expect(ids.has("task-1")).toBe(true);
    expect(ids.has("subtask-1")).toBe(true);
    // Feature should not be included
    expect(ids.has("feat-1")).toBe(false);
  });

  it("excludes tasks from other epics", () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "pending",
        children: [
          { id: "task-1", title: "Task 1", level: "task", status: "pending" },
        ],
      },
      {
        id: "epic-2",
        title: "Epic Two",
        level: "epic",
        status: "pending",
        children: [
          { id: "task-2", title: "Task 2", level: "task", status: "pending" },
        ],
      },
    ];

    const ids = collectEpicTaskIds(items, "epic-1");
    expect(ids.size).toBe(1);
    expect(ids.has("task-1")).toBe(true);
    expect(ids.has("task-2")).toBe(false);
  });

  it("handles epic with no children", () => {
    const items: PRDItem[] = [
      { id: "epic-1", title: "Empty Epic", level: "epic", status: "pending" },
    ];

    const ids = collectEpicTaskIds(items, "epic-1");
    expect(ids.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// assembleTaskBrief — epic-filtered task selection
// ---------------------------------------------------------------------------

describe("assembleTaskBrief — epic-filtered selection", () => {
  it("only returns tasks from filtered epic", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-auth",
        title: "Authentication",
        level: "epic",
        status: "in_progress",
        children: [
          { id: "task-auth-1", title: "Auth Task 1", level: "task", status: "pending" },
        ],
      },
      {
        id: "epic-dashboard",
        title: "Dashboard",
        level: "epic",
        status: "in_progress",
        children: [
          { id: "task-dash-1", title: "Dashboard Task 1", level: "task", status: "pending", priority: "critical" },
        ],
      },
    ];
    const store = mockStore(items);

    // Without epic filter, highest priority task is selected (critical > medium)
    const { taskId: noFilter } = await assembleTaskBrief(store);
    expect(noFilter).toBe("task-dash-1");

    // With epic filter, only tasks from that epic are considered
    const { taskId: withFilter } = await assembleTaskBrief(store, undefined, {
      epicId: "epic-auth",
    });
    expect(withFilter).toBe("task-auth-1");
  });

  it("maintains priority ordering within epic", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [
          { id: "task-low", title: "Low Priority", level: "task", status: "pending", priority: "low" },
          { id: "task-high", title: "High Priority", level: "task", status: "pending", priority: "high" },
          { id: "task-medium", title: "Medium Priority", level: "task", status: "pending" },
        ],
      },
    ];
    const store = mockStore(items);

    const { taskId } = await assembleTaskBrief(store, undefined, { epicId: "epic-1" });
    expect(taskId).toBe("task-high");
  });

  it("prefers in_progress task within epic", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [
          { id: "task-pending", title: "Pending Task", level: "task", status: "pending", priority: "critical" },
          { id: "task-wip", title: "In Progress Task", level: "task", status: "in_progress", priority: "low" },
        ],
      },
    ];
    const store = mockStore(items);

    const { taskId } = await assembleTaskBrief(store, undefined, { epicId: "epic-1" });
    expect(taskId).toBe("task-wip");
  });

  it("returns null when no actionable tasks remain in epic", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [
          { id: "task-done", title: "Completed Task", level: "task", status: "completed" },
        ],
      },
      {
        id: "task-other",
        title: "Other Task",
        level: "task",
        status: "pending",
      },
    ];
    const store = mockStore(items);

    await expect(
      assembleTaskBrief(store, undefined, { epicId: "epic-1" }),
    ).rejects.toThrow("No actionable tasks found in epic");
  });

  it("respects dependency ordering within epic", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "task-blocker",
            title: "Blocker Task",
            level: "task",
            status: "pending",
            priority: "low",
          },
          {
            id: "task-blocked",
            title: "Blocked Task",
            level: "task",
            status: "pending",
            priority: "critical",
            blockedBy: ["task-blocker"],
          },
        ],
      },
    ];
    const store = mockStore(items);

    // Even though blocked task is critical priority, blocker must be done first
    const { taskId } = await assembleTaskBrief(store, undefined, { epicId: "epic-1" });
    expect(taskId).toBe("task-blocker");
  });

  it("selects task when dependency is resolved within epic", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "task-blocker",
            title: "Blocker Task",
            level: "task",
            status: "completed",
          },
          {
            id: "task-ready",
            title: "Ready Task",
            level: "task",
            status: "pending",
            blockedBy: ["task-blocker"],
          },
        ],
      },
    ];
    const store = mockStore(items);

    const { taskId } = await assembleTaskBrief(store, undefined, { epicId: "epic-1" });
    expect(taskId).toBe("task-ready");
  });

  it("combines epic filter with excludeTaskIds", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [
          { id: "task-1", title: "First Task", level: "task", status: "pending", priority: "high" },
          { id: "task-2", title: "Second Task", level: "task", status: "pending", priority: "medium" },
        ],
      },
    ];
    const store = mockStore(items);

    // First task excluded (e.g., stuck), should select second task
    const { taskId } = await assembleTaskBrief(store, undefined, {
      epicId: "epic-1",
      excludeTaskIds: new Set(["task-1"]),
    });
    expect(taskId).toBe("task-2");
  });

  it("includes subtasks in epic filtering", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "feat-1",
            title: "Feature One",
            level: "feature",
            status: "in_progress",
            children: [
              {
                id: "task-1",
                title: "Task with subtasks",
                level: "task",
                status: "in_progress",
                children: [
                  { id: "subtask-1", title: "Subtask 1", level: "subtask", status: "pending" },
                ],
              },
            ],
          },
        ],
      },
      // Subtask outside the epic (root level) should be excluded
      { id: "subtask-other", title: "Other Subtask", level: "subtask", status: "pending", priority: "critical" },
    ];
    const store = mockStore(items);

    const { taskId } = await assembleTaskBrief(store, undefined, { epicId: "epic-1" });
    expect(taskId).toBe("subtask-1");
  });
});

// ---------------------------------------------------------------------------
// assembleTaskBrief — context assembly verification
// ---------------------------------------------------------------------------

describe("assembleTaskBrief — context assembly", () => {
  it("includes task priority in brief", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "High priority task",
        status: "pending",
        level: "task",
        priority: "high",
      },
    ];
    const store = mockStore(items);

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.task.priority).toBe("high");
  });

  it("includes task tags in brief", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Tagged task",
        status: "pending",
        level: "task",
        tags: ["frontend", "auth"],
      },
    ];
    const store = mockStore(items);

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.task.tags).toEqual(["frontend", "auth"]);
  });

  it("includes task description in brief", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Described task",
        status: "pending",
        level: "task",
        description: "This is a detailed description of the task",
      },
    ];
    const store = mockStore(items);

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.task.description).toBe("This is a detailed description of the task");
  });

  it("includes acceptance criteria in brief", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Task with criteria",
        status: "pending",
        level: "task",
        acceptanceCriteria: ["Criterion 1", "Criterion 2"],
      },
    ];
    const store = mockStore(items);

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.task.acceptanceCriteria).toEqual(["Criterion 1", "Criterion 2"]);
  });

  it("assembles parent chain correctly", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        description: "Epic description",
        children: [
          {
            id: "feat-1",
            title: "Feature One",
            level: "feature",
            status: "in_progress",
            description: "Feature description",
            children: [
              {
                id: "task-1",
                title: "Task One",
                level: "task",
                status: "pending",
              },
            ],
          },
        ],
      },
    ];
    const store = mockStore(items);

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.parentChain).toHaveLength(2);
    expect(brief.parentChain[0]).toEqual({
      id: "epic-1",
      title: "Epic One",
      level: "epic",
      description: "Epic description",
    });
    expect(brief.parentChain[1]).toEqual({
      id: "feat-1",
      title: "Feature One",
      level: "feature",
      description: "Feature description",
    });
  });

  it("assembles siblings correctly", async () => {
    const items: PRDItem[] = [
      {
        id: "feat-1",
        title: "Feature",
        level: "feature",
        status: "in_progress",
        children: [
          {
            id: "task-1",
            title: "First Task",
            level: "task",
            status: "pending",
          },
          {
            id: "task-2",
            title: "Second Task",
            level: "task",
            status: "completed",
          },
          {
            id: "task-3",
            title: "Third Task",
            level: "task",
            status: "pending",
          },
        ],
      },
    ];
    const store = mockStore(items);

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.siblings).toHaveLength(2);
    expect(brief.siblings).toContainEqual({
      id: "task-2",
      title: "Second Task",
      status: "completed",
    });
    expect(brief.siblings).toContainEqual({
      id: "task-3",
      title: "Third Task",
      status: "pending",
    });
  });

  it("includes project configuration in brief", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Task",
        status: "pending",
        level: "task",
      },
    ];
    const store: PRDStore = {
      ...mockStore(items),
      loadConfig: async () => ({
        schema: "rex/v1",
        project: "test-project",
        adapter: "file",
        validate: "npm run typecheck",
        test: "npm test",
      }),
    };

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.project).toEqual({
      name: "test-project",
      validateCommand: "npm run typecheck",
      testCommand: "npm test",
    });
  });

  it("includes workflow in brief when available", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Task",
        status: "pending",
        level: "task",
      },
    ];
    const store: PRDStore = {
      ...mockStore(items),
      loadWorkflow: async () => "1. Read code\n2. Make changes\n3. Test",
    };

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.workflow).toBe("1. Read code\n2. Make changes\n3. Test");
  });

  it("handles missing workflow gracefully", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Task",
        status: "pending",
        level: "task",
      },
    ];
    const store: PRDStore = {
      ...mockStore(items),
      loadWorkflow: async () => {
        throw new Error("ENOENT: workflow.md not found");
      },
    };

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.workflow).toBe("");
  });

  it("includes recent log entries in brief", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Task",
        status: "pending",
        level: "task",
      },
    ];
    const logEntries = [
      { timestamp: "2025-01-01T10:00:00Z", event: "task_started", detail: "Started task-0" },
      { timestamp: "2025-01-01T11:00:00Z", event: "task_completed", detail: "Finished task-0" },
      { timestamp: "2025-01-01T12:00:00Z", event: "status_changed", detail: "Task-1 now pending" },
    ];
    const store: PRDStore = {
      ...mockStore(items),
      readLog: async () => logEntries,
    };

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.recentLog).toHaveLength(3);
    expect(brief.recentLog[0]).toEqual({
      timestamp: "2025-01-01T10:00:00Z",
      event: "task_started",
      detail: "Started task-0",
    });
  });

  it("maps log entries without detail correctly", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Task",
        status: "pending",
        level: "task",
      },
    ];
    const logEntries = [
      { timestamp: "2025-01-01T10:00:00Z", event: "system_init" },
    ];
    const store: PRDStore = {
      ...mockStore(items),
      readLog: async () => logEntries,
    };

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.recentLog[0]).toEqual({
      timestamp: "2025-01-01T10:00:00Z",
      event: "system_init",
      detail: undefined,
    });
  });

  it("handles root-level tasks with no siblings from other parents", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Root Task 1",
        level: "task",
        status: "pending",
      },
      {
        id: "task-2",
        title: "Root Task 2",
        level: "task",
        status: "pending",
      },
    ];
    const store = mockStore(items);

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.parentChain).toHaveLength(0);
    expect(brief.siblings).toHaveLength(1);
    expect(brief.siblings[0]).toEqual({
      id: "task-2",
      title: "Root Task 2",
      status: "pending",
    });
  });
});

// ---------------------------------------------------------------------------
// getActionableTasks
// ---------------------------------------------------------------------------

describe("getActionableTasks", () => {
  it("returns actionable tasks sorted by priority", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Low priority",
        status: "pending",
        level: "task",
        priority: "low",
      },
      {
        id: "task-2",
        title: "High priority",
        status: "pending",
        level: "task",
        priority: "high",
      },
      {
        id: "task-3",
        title: "Medium priority",
        status: "pending",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const tasks = await getActionableTasks(store);
    expect(tasks[0].id).toBe("task-2"); // high
    expect(tasks[1].id).toBe("task-3"); // medium (default)
    expect(tasks[2].id).toBe("task-1"); // low
  });

  it("excludes completed and deferred tasks", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Completed",
        status: "completed",
        level: "task",
      },
      {
        id: "task-2",
        title: "Deferred",
        status: "deferred",
        level: "task",
      },
      {
        id: "task-3",
        title: "Pending",
        status: "pending",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const tasks = await getActionableTasks(store);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("task-3");
  });

  it("respects the limit parameter", async () => {
    const items: PRDItem[] = [
      { id: "task-1", title: "Task 1", status: "pending", level: "task" },
      { id: "task-2", title: "Task 2", status: "pending", level: "task" },
      { id: "task-3", title: "Task 3", status: "pending", level: "task" },
      { id: "task-4", title: "Task 4", status: "pending", level: "task" },
      { id: "task-5", title: "Task 5", status: "pending", level: "task" },
    ];
    const store = mockStore(items);

    const tasks = await getActionableTasks(store, 2);
    expect(tasks).toHaveLength(2);
  });

  it("includes parent chain in formatted output", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "feat-1",
            title: "Feature",
            level: "feature",
            status: "in_progress",
            children: [
              {
                id: "task-1",
                title: "Task",
                level: "task",
                status: "pending",
              },
            ],
          },
        ],
      },
    ];
    const store = mockStore(items);

    const tasks = await getActionableTasks(store);
    expect(tasks[0].parentChain).toBe("Epic > Feature");
  });

  it("returns empty array when no actionable tasks", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Done",
        status: "completed",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const tasks = await getActionableTasks(store);
    expect(tasks).toEqual([]);
  });

  it("includes priority defaulting to medium", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "No priority set",
        status: "pending",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const tasks = await getActionableTasks(store);
    expect(tasks[0].priority).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// assembleTaskBrief — requirements in brief
// ---------------------------------------------------------------------------

describe("assembleTaskBrief — requirements", () => {
  it("includes own requirements in brief", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Task with requirements",
        status: "pending",
        level: "task",
        requirements: [
          {
            id: "req-1",
            title: "Test coverage > 80%",
            category: "quality",
            validationType: "metric",
            acceptanceCriteria: ["Statement coverage >= 80%"],
            validationCommand: "echo 85",
            threshold: 80,
          },
        ],
      },
    ];
    const store = mockStore(items);

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.requirements).toHaveLength(1);
    expect(brief.requirements[0].id).toBe("req-1");
    expect(brief.requirements[0].title).toBe("Test coverage > 80%");
    expect(brief.requirements[0].category).toBe("quality");
    expect(brief.requirements[0].validationType).toBe("metric");
    expect(brief.requirements[0].acceptanceCriteria).toEqual(["Statement coverage >= 80%"]);
    expect(brief.requirements[0].source).toBe("Task with requirements");
  });

  it("inherits requirements from parent chain", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        requirements: [
          {
            id: "req-epic",
            title: "Security audit",
            category: "security",
            validationType: "manual",
            acceptanceCriteria: ["All endpoints reviewed"],
          },
        ],
        children: [
          {
            id: "feat-1",
            title: "Feature One",
            level: "feature",
            status: "in_progress",
            requirements: [
              {
                id: "req-feat",
                title: "Browser support",
                category: "compatibility",
                validationType: "automated",
                acceptanceCriteria: ["Chrome 120+", "Firefox 120+"],
                validationCommand: "echo ok",
              },
            ],
            children: [
              {
                id: "task-1",
                title: "Task One",
                level: "task",
                status: "pending",
              },
            ],
          },
        ],
      },
    ];
    const store = mockStore(items);

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.requirements).toHaveLength(2);

    // Feature requirement comes first (closer parent)
    const featReq = brief.requirements.find(r => r.id === "req-feat");
    expect(featReq).toBeDefined();
    expect(featReq!.source).toBe("Feature One");

    // Epic requirement comes after
    const epicReq = brief.requirements.find(r => r.id === "req-epic");
    expect(epicReq).toBeDefined();
    expect(epicReq!.source).toBe("Epic One");
  });

  it("returns empty requirements when none exist", async () => {
    const items: PRDItem[] = [
      {
        id: "task-1",
        title: "Plain task",
        status: "pending",
        level: "task",
      },
    ];
    const store = mockStore(items);

    const { brief } = await assembleTaskBrief(store, "task-1");
    expect(brief.requirements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatTaskBrief — requirements rendering
// ---------------------------------------------------------------------------

describe("formatTaskBrief — requirements", () => {
  const minimalBriefForReqs: TaskBrief = {
    task: {
      id: "task-1",
      title: "Task",
      level: "task",
      status: "pending",
    },
    parentChain: [],
    siblings: [],
    requirements: [],
    project: { name: "test" },
    workflow: "",
    recentLog: [],
  };

  it("omits requirements section when empty", () => {
    const output = formatTaskBrief(minimalBriefForReqs);
    expect(output).not.toContain("## Requirements");
  });

  it("renders requirements section when present", () => {
    const brief: TaskBrief = {
      ...minimalBriefForReqs,
      requirements: [
        {
          id: "req-1",
          title: "Test coverage",
          category: "quality",
          validationType: "metric",
          acceptanceCriteria: ["Coverage >= 80%"],
          source: "Epic One",
        },
        {
          id: "req-2",
          title: "Auth required",
          category: "security",
          validationType: "manual",
          acceptanceCriteria: ["All endpoints require auth", "RBAC enforced"],
          source: "Feature One",
        },
      ],
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("## Requirements");
    expect(output).toContain("**Test coverage** [quality/metric] (from: Epic One)");
    expect(output).toContain("Coverage >= 80%");
    expect(output).toContain("**Auth required** [security/manual] (from: Feature One)");
    expect(output).toContain("All endpoints require auth");
    expect(output).toContain("RBAC enforced");
  });
});
