import { describe, it, expect } from "vitest";
import type { PRDItem, PRDStore } from "@n-dx/rex";
import {
  getOrderedEpics,
  printEpicByEpicSummary,
  type EpicRunSummary,
  type EpicScopeInfo,
} from "../../../../src/cli/commands/run.js";

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
// getOrderedEpics
// ---------------------------------------------------------------------------

describe("getOrderedEpics", () => {
  it("returns empty array for PRD with no epics", async () => {
    const items: PRDItem[] = [
      { id: "task-1", title: "Orphan Task", level: "task", status: "pending" },
    ];
    const store = mockStore(items);
    const result = await getOrderedEpics(store);
    expect(result).toEqual([]);
  });

  it("returns epics in PRD order with scope info", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "First Epic",
        level: "epic",
        status: "pending",
        children: [
          { id: "task-1", title: "Task 1", level: "task", status: "pending" },
          { id: "task-2", title: "Task 2", level: "task", status: "completed" },
        ],
      },
      {
        id: "epic-2",
        title: "Second Epic",
        level: "epic",
        status: "pending",
        children: [
          { id: "task-3", title: "Task 3", level: "task", status: "pending" },
        ],
      },
    ];
    const store = mockStore(items);
    const result = await getOrderedEpics(store);

    expect(result).toHaveLength(2);

    // First epic
    expect(result[0].id).toBe("epic-1");
    expect(result[0].title).toBe("First Epic");
    expect(result[0].totalTasks).toBe(2);
    expect(result[0].completedTasks).toBe(1);
    expect(result[0].actionableTasks).toBe(1);
    expect(result[0].isComplete).toBe(false);
    expect(result[0].hasActionableTasks).toBe(true);

    // Second epic
    expect(result[1].id).toBe("epic-2");
    expect(result[1].title).toBe("Second Epic");
    expect(result[1].totalTasks).toBe(1);
    expect(result[1].completedTasks).toBe(0);
    expect(result[1].actionableTasks).toBe(1);
  });

  it("includes completed epics in the result", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-done",
        title: "Done Epic",
        level: "epic",
        status: "completed",
        children: [
          { id: "task-1", title: "Task 1", level: "task", status: "completed" },
        ],
      },
      {
        id: "epic-todo",
        title: "Todo Epic",
        level: "epic",
        status: "pending",
        children: [
          { id: "task-2", title: "Task 2", level: "task", status: "pending" },
        ],
      },
    ];
    const store = mockStore(items);
    const result = await getOrderedEpics(store);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("epic-done");
    expect(result[0].isComplete).toBe(true);
    expect(result[1].id).toBe("epic-todo");
    expect(result[1].isComplete).toBe(false);
  });

  it("handles epics with nested feature/task hierarchy", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Deep Epic",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "feat-1",
            title: "Feature",
            level: "feature",
            status: "pending",
            children: [
              { id: "task-1", title: "Task 1", level: "task", status: "pending" },
              {
                id: "task-2",
                title: "Task 2",
                level: "task",
                status: "pending",
                children: [
                  { id: "sub-1", title: "Subtask 1", level: "subtask", status: "completed" },
                ],
              },
            ],
          },
        ],
      },
    ];
    const store = mockStore(items);
    const result = await getOrderedEpics(store);

    expect(result).toHaveLength(1);
    expect(result[0].totalTasks).toBe(3); // task-1, task-2, sub-1
    expect(result[0].completedTasks).toBe(1); // sub-1
    expect(result[0].actionableTasks).toBe(2); // task-1, task-2
  });

  it("handles all-blocked epics", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Blocked Epic",
        level: "epic",
        status: "pending",
        children: [
          { id: "task-1", title: "Task 1", level: "task", status: "blocked" },
          { id: "task-2", title: "Task 2", level: "task", status: "deferred" },
        ],
      },
    ];
    const store = mockStore(items);
    const result = await getOrderedEpics(store);

    expect(result).toHaveLength(1);
    expect(result[0].isComplete).toBe(false);
    expect(result[0].hasActionableTasks).toBe(false);
    expect(result[0].actionableTasks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// printEpicByEpicSummary
// ---------------------------------------------------------------------------

describe("printEpicByEpicSummary", () => {
  it("prints summary for completed epics", () => {
    const summaries: EpicRunSummary[] = [
      { id: "epic-1", title: "Auth", tasksCompleted: 3, tasksFailed: 0, outcome: "completed" },
      { id: "epic-2", title: "Dashboard", tasksCompleted: 2, tasksFailed: 1, outcome: "completed" },
    ];

    // Just verify it doesn't throw — output goes to info/output sinks
    expect(() => printEpicByEpicSummary(summaries)).not.toThrow();
  });

  it("prints summary for mixed outcomes", () => {
    const summaries: EpicRunSummary[] = [
      { id: "epic-1", title: "Auth", tasksCompleted: 3, tasksFailed: 0, outcome: "completed" },
      { id: "epic-2", title: "Dashboard", tasksCompleted: 0, tasksFailed: 0, outcome: "no_actionable_tasks" },
      { id: "epic-3", title: "Settings", tasksCompleted: 0, tasksFailed: 0, outcome: "interrupted" },
    ];

    expect(() => printEpicByEpicSummary(summaries)).not.toThrow();
  });

  it("prints summary with zero summaries", () => {
    expect(() => printEpicByEpicSummary([])).not.toThrow();
  });

  it("prints summary for skipped epics", () => {
    const summaries: EpicRunSummary[] = [
      { id: "epic-1", title: "Skipped", tasksCompleted: 0, tasksFailed: 0, outcome: "skipped" },
    ];

    expect(() => printEpicByEpicSummary(summaries)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EpicRunSummary type shape
// ---------------------------------------------------------------------------

describe("EpicRunSummary", () => {
  it("has the expected shape", () => {
    const summary: EpicRunSummary = {
      id: "epic-1",
      title: "Test Epic",
      tasksCompleted: 5,
      tasksFailed: 1,
      outcome: "completed",
    };

    expect(summary.id).toBe("epic-1");
    expect(summary.title).toBe("Test Epic");
    expect(summary.tasksCompleted).toBe(5);
    expect(summary.tasksFailed).toBe(1);
    expect(summary.outcome).toBe("completed");
  });
});
