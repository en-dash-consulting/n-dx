import { describe, it, expect } from "vitest";
import {
  formatTaskBrief,
  assembleTaskBrief,
  TaskNotActionableError,
} from "../../../src/agent/brief.js";
import type { TaskBrief } from "../../../src/schema/v1.js";
import type { PRDStore } from "rex/dist/store/types.js";
import type { PRDItem } from "rex/dist/schema/v1.js";

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
