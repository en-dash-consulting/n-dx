import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PRDItem, PRDStore } from "@n-dx/rex";
import {
  listEpics,
  findEpicByIdOrTitle,
  resolveEpicFlag,
  collectEpicTaskIds,
  getEpicScopeInfo,
  type EpicScopeInfo,
} from "../../../../src/cli/commands/run.js";
import { EpicNotFoundError } from "../../../../src/cli/errors.js";

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
// listEpics
// ---------------------------------------------------------------------------

describe("listEpics", () => {
  it("returns empty array for empty items", () => {
    const epics = listEpics([]);
    expect(epics).toEqual([]);
  });

  it("returns only epic-level items", () => {
    const items: PRDItem[] = [
      { id: "epic-1", title: "Epic One", level: "epic", status: "pending" },
      { id: "feat-1", title: "Feature One", level: "feature", status: "pending" },
      { id: "task-1", title: "Task One", level: "task", status: "pending" },
      { id: "epic-2", title: "Epic Two", level: "epic", status: "in_progress" },
    ];

    const epics = listEpics(items);
    expect(epics).toHaveLength(2);
    expect(epics).toContainEqual({ id: "epic-1", title: "Epic One" });
    expect(epics).toContainEqual({ id: "epic-2", title: "Epic Two" });
  });

  it("ignores nested items (only checks root level)", () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "pending",
        children: [
          { id: "feat-1", title: "Feature One", level: "feature", status: "pending" },
        ],
      },
    ];

    const epics = listEpics(items);
    expect(epics).toHaveLength(1);
    expect(epics[0]).toEqual({ id: "epic-1", title: "Epic One" });
  });
});

// ---------------------------------------------------------------------------
// findEpicByIdOrTitle
// ---------------------------------------------------------------------------

describe("findEpicByIdOrTitle", () => {
  const items: PRDItem[] = [
    { id: "epic-auth", title: "Authentication", level: "epic", status: "pending" },
    { id: "epic-dashboard", title: "Dashboard", level: "epic", status: "in_progress" },
    { id: "feat-login", title: "Login", level: "feature", status: "pending" },
  ];

  it("finds epic by exact ID match", () => {
    const result = findEpicByIdOrTitle(items, "epic-auth");
    expect(result).toEqual({ id: "epic-auth", title: "Authentication" });
  });

  it("finds epic by exact title match", () => {
    const result = findEpicByIdOrTitle(items, "Dashboard");
    expect(result).toEqual({ id: "epic-dashboard", title: "Dashboard" });
  });

  it("finds epic by case-insensitive title match", () => {
    const result = findEpicByIdOrTitle(items, "authentication");
    expect(result).toEqual({ id: "epic-auth", title: "Authentication" });
  });

  it("finds epic by uppercase title match", () => {
    const result = findEpicByIdOrTitle(items, "DASHBOARD");
    expect(result).toEqual({ id: "epic-dashboard", title: "Dashboard" });
  });

  it("returns null for non-existent epic", () => {
    const result = findEpicByIdOrTitle(items, "epic-nonexistent");
    expect(result).toBeNull();
  });

  it("returns null for feature ID (not an epic)", () => {
    const result = findEpicByIdOrTitle(items, "feat-login");
    expect(result).toBeNull();
  });

  it("returns first matching epic (by ID or title)", () => {
    // When searching, the first epic that matches (by ID or title) wins
    const items: PRDItem[] = [
      { id: "epic-1", title: "First Epic", level: "epic", status: "pending" },
      { id: "epic-2", title: "Second Epic", level: "epic", status: "pending" },
    ];

    // ID match on first item
    const result1 = findEpicByIdOrTitle(items, "epic-1");
    expect(result1).toEqual({ id: "epic-1", title: "First Epic" });

    // ID match on second item
    const result2 = findEpicByIdOrTitle(items, "epic-2");
    expect(result2).toEqual({ id: "epic-2", title: "Second Epic" });
  });

  it("returns null for empty items", () => {
    const result = findEpicByIdOrTitle([], "anything");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveEpicFlag
// ---------------------------------------------------------------------------

describe("resolveEpicFlag", () => {
  const items: PRDItem[] = [
    { id: "epic-auth", title: "Authentication", level: "epic", status: "pending" },
    { id: "epic-dashboard", title: "Dashboard", level: "epic", status: "in_progress" },
  ];

  it("resolves valid epic by ID", async () => {
    const store = mockStore(items);
    const result = await resolveEpicFlag(store, "epic-auth");
    expect(result).toEqual({ id: "epic-auth", title: "Authentication" });
  });

  it("resolves valid epic by title", async () => {
    const store = mockStore(items);
    const result = await resolveEpicFlag(store, "Dashboard");
    expect(result).toEqual({ id: "epic-dashboard", title: "Dashboard" });
  });

  it("throws EpicNotFoundError for non-existent epic", async () => {
    const store = mockStore(items);
    await expect(resolveEpicFlag(store, "nonexistent")).rejects.toThrow(EpicNotFoundError);
  });

  it("includes available epics in EpicNotFoundError", async () => {
    const store = mockStore(items);

    try {
      await resolveEpicFlag(store, "nonexistent");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EpicNotFoundError);
      const e = err as EpicNotFoundError;
      expect(e.searchTerm).toBe("nonexistent");
      expect(e.availableEpics).toHaveLength(2);
      expect(e.availableEpics).toContainEqual({ id: "epic-auth", title: "Authentication" });
      expect(e.availableEpics).toContainEqual({ id: "epic-dashboard", title: "Dashboard" });
    }
  });

  it("shows 'no epics found' when PRD has no epics", async () => {
    const store = mockStore([
      { id: "task-1", title: "Task", level: "task", status: "pending" },
    ]);

    try {
      await resolveEpicFlag(store, "anything");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EpicNotFoundError);
      const e = err as EpicNotFoundError;
      expect(e.availableEpics).toHaveLength(0);
      expect(e.suggestion).toContain("No epics found in PRD");
    }
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
// EpicNotFoundError
// ---------------------------------------------------------------------------

describe("EpicNotFoundError", () => {
  it("stores searchTerm and availableEpics", () => {
    const err = new EpicNotFoundError("my-search", [
      { id: "epic-1", title: "Epic One" },
    ]);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("EpicNotFoundError");
    expect(err.searchTerm).toBe("my-search");
    expect(err.availableEpics).toHaveLength(1);
    expect(err.message).toContain("my-search");
  });

  it("includes available epics in suggestion", () => {
    const err = new EpicNotFoundError("search", [
      { id: "epic-1", title: "Epic One" },
      { id: "epic-2", title: "Epic Two" },
    ]);

    expect(err.suggestion).toContain("Epic One");
    expect(err.suggestion).toContain("epic-1");
    expect(err.suggestion).toContain("Epic Two");
    expect(err.suggestion).toContain("epic-2");
  });

  it("shows no epics message when none available", () => {
    const err = new EpicNotFoundError("search", []);
    expect(err.suggestion).toContain("No epics found in PRD");
  });
});

// ---------------------------------------------------------------------------
// getEpicScopeInfo
// ---------------------------------------------------------------------------

describe("getEpicScopeInfo", () => {
  it("returns correct counts for epic with all pending tasks", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "pending",
        children: [
          { id: "task-1", title: "Task 1", level: "task", status: "pending" },
          { id: "task-2", title: "Task 2", level: "task", status: "pending" },
        ],
      },
    ];
    const store = mockStore(items);

    const info = await getEpicScopeInfo(store, "epic-1");
    expect(info).toEqual({
      id: "epic-1",
      title: "Epic One",
      totalTasks: 2,
      completedTasks: 0,
      actionableTasks: 2,
      isComplete: false,
      hasActionableTasks: true,
    });
  });

  it("returns correct counts for epic with mixed task statuses", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [
          { id: "task-1", title: "Task 1", level: "task", status: "completed" },
          { id: "task-2", title: "Task 2", level: "task", status: "pending" },
          { id: "task-3", title: "Task 3", level: "task", status: "deferred" },
          { id: "task-4", title: "Task 4", level: "task", status: "blocked" },
        ],
      },
    ];
    const store = mockStore(items);

    const info = await getEpicScopeInfo(store, "epic-1");
    expect(info.totalTasks).toBe(4);
    expect(info.completedTasks).toBe(1);
    expect(info.actionableTasks).toBe(1); // only pending task-2
    expect(info.isComplete).toBe(false);
    expect(info.hasActionableTasks).toBe(true);
  });

  it("detects when all tasks in epic are complete", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "completed",
        children: [
          { id: "task-1", title: "Task 1", level: "task", status: "completed" },
          { id: "task-2", title: "Task 2", level: "task", status: "completed" },
        ],
      },
    ];
    const store = mockStore(items);

    const info = await getEpicScopeInfo(store, "epic-1");
    expect(info.totalTasks).toBe(2);
    expect(info.completedTasks).toBe(2);
    expect(info.actionableTasks).toBe(0);
    expect(info.isComplete).toBe(true);
    expect(info.hasActionableTasks).toBe(false);
  });

  it("handles epic with no actionable tasks but incomplete", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "pending",
        children: [
          { id: "task-1", title: "Task 1", level: "task", status: "deferred" },
          { id: "task-2", title: "Task 2", level: "task", status: "blocked" },
        ],
      },
    ];
    const store = mockStore(items);

    const info = await getEpicScopeInfo(store, "epic-1");
    expect(info.totalTasks).toBe(2);
    expect(info.completedTasks).toBe(0);
    expect(info.actionableTasks).toBe(0);
    expect(info.isComplete).toBe(false);
    expect(info.hasActionableTasks).toBe(false);
  });

  it("handles nested tasks within features", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "feat-1",
            title: "Feature",
            level: "feature",
            status: "pending",
            children: [
              { id: "task-1", title: "Task 1", level: "task", status: "completed" },
              {
                id: "task-2",
                title: "Task 2",
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
    const store = mockStore(items);

    const info = await getEpicScopeInfo(store, "epic-1");
    // Counts: task-1 (completed), task-2 (pending), subtask-1 (pending)
    expect(info.totalTasks).toBe(3);
    expect(info.completedTasks).toBe(1);
    expect(info.actionableTasks).toBe(2);
    expect(info.isComplete).toBe(false);
    expect(info.hasActionableTasks).toBe(true);
  });

  it("handles empty epic with no children", async () => {
    const items: PRDItem[] = [
      { id: "epic-1", title: "Empty Epic", level: "epic", status: "pending" },
    ];
    const store = mockStore(items);

    const info = await getEpicScopeInfo(store, "epic-1");
    expect(info.totalTasks).toBe(0);
    expect(info.completedTasks).toBe(0);
    expect(info.actionableTasks).toBe(0);
    expect(info.isComplete).toBe(true); // No tasks means nothing left to do
    expect(info.hasActionableTasks).toBe(false);
  });

  it("counts in_progress tasks as actionable", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "in_progress",
        children: [
          { id: "task-1", title: "Task 1", level: "task", status: "in_progress" },
          { id: "task-2", title: "Task 2", level: "task", status: "pending" },
        ],
      },
    ];
    const store = mockStore(items);

    const info = await getEpicScopeInfo(store, "epic-1");
    expect(info.totalTasks).toBe(2);
    expect(info.actionableTasks).toBe(2); // both in_progress and pending are actionable
    expect(info.hasActionableTasks).toBe(true);
  });
});
