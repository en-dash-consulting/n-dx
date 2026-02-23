import { describe, expect, it } from "vitest";
import { resolveBranchScopedCompletedRexWorkFromData } from "../../../src/cli/commands/prd-epic-resolver.js";

describe("resolveBranchScopedCompletedRexWorkFromData", () => {
  it("returns unique parent epic titles for completed and executed branch-scoped tasks", () => {
    const prd = [
      {
        id: "epic-a",
        title: "Epic A",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "feature-a1",
            title: "Feature A1",
            level: "feature",
            status: "in_progress",
            children: [
              { id: "task-a1", title: "Task A1", level: "task", status: "completed" },
              { id: "task-a2", title: "Task A2", level: "task", status: "in_progress" },
            ],
          },
        ],
      },
      {
        id: "epic-b",
        title: "Epic B",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "feature-b1",
            title: "Feature B1",
            level: "feature",
            status: "in_progress",
            children: [{ id: "task-b1", title: "Task B1", level: "task", status: "completed" }],
          },
        ],
      },
    ];

    const logs = [
      { timestamp: "2026-02-20T08:00:00.000Z", itemId: "task-a1", branch: "feature/active" },
      { timestamp: "2026-02-20T09:00:00.000Z", itemId: "task-a2", branch: "feature/active" },
      { timestamp: "2026-02-20T09:30:00.000Z", itemId: "task-a1", branch: "feature/active" },
      { timestamp: "2026-02-20T10:00:00.000Z", itemId: "task-b1", branch: "feature/active" },
    ];

    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "feature/active");
    expect(result.status).toBe("found");
    expect(result.epicTitles).toEqual(["Epic A", "Epic B"]);
    if (result.status === "found") {
      expect(result.completedItems.map((item) => item.id)).toEqual(["task-a1", "task-a2", "task-b1"]);
      expect(result.completedItems.map((item) => item.executionState)).toEqual(["completed", "executed", "completed"]);
    }
  });

  it("excludes deleted items and entries from other branches", () => {
    const prd = [
      {
        id: "epic-main",
        title: "Main Epic",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "feature-main",
            title: "Feature",
            level: "feature",
            status: "in_progress",
            children: [
              { id: "task-touched-done", title: "Touched Done", level: "task", status: "completed" },
              { id: "task-touched-pending", title: "Touched Pending", level: "task", status: "pending" },
              { id: "task-touched-deleted", title: "Touched Deleted", level: "task", status: "deleted" },
              { id: "task-untouched-done", title: "Untouched Done", level: "task", status: "completed" },
            ],
          },
        ],
      },
    ];

    const logs = [
      { timestamp: "2026-02-21T08:00:00.000Z", itemId: "task-touched-done", branchName: "feature/current" },
      { timestamp: "2026-02-21T09:00:00.000Z", itemId: "task-touched-pending", branchName: "feature/current" },
      { timestamp: "2026-02-21T10:00:00.000Z", itemId: "task-touched-deleted", branchName: "feature/current" },
      { timestamp: "2026-02-21T11:00:00.000Z", itemId: "task-untouched-done", branchName: "feature/other" },
    ];

    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "feature/current");
    expect(result.status).toBe("found");
    expect(result.epicTitles).toEqual(["Main Epic"]);
    if (result.status === "found") {
      expect(result.completedItems).toHaveLength(2);
      expect(result.completedItems.map((item) => item.id)).toEqual(["task-touched-done", "task-touched-pending"]);
    }
  });

  it("returns an explicit empty signal when no branch-scoped completed items exist", () => {
    const prd = [
      {
        id: "epic-a",
        title: "Alpha Epic",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "feature-a",
            title: "Feature A",
            level: "feature",
            status: "in_progress",
            children: [
              { id: "task-a", title: "Task A", level: "task", status: "completed" },
            ],
          },
        ],
      },
    ];

    const logs = [
      { timestamp: "2026-02-21T03:00:00.000Z", itemId: "task-a", branch: "feature/other" },
    ];

    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "feature/current");
    expect(result).toEqual({
      status: "empty",
      signal: "no_branch_scoped_completed_rex_items",
      epicTitles: [],
      completedItems: [],
    });
  });
});
