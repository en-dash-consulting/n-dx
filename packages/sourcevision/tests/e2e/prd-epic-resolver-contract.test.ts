/**
 * Contract test for prd-epic-resolver.ts.
 *
 * Documents and locks down the output format of resolveBranchScopedCompletedRexWorkFromData
 * — the function that core/ci.js and the pr-markdown pipeline depend on. This is
 * the only cross-tier contract in the codebase with a coupling that cannot be
 * enforced by static analysis tools (filesystem-level: file paths, log format,
 * branch field conventions).
 *
 * These tests explicitly exercise:
 *   1. The discriminated union output shape ("found" | "empty" with exact fields)
 *   2. The branch field resolution fallback chain
 *   3. Sort order of epicTitles and completedItems
 *   4. Filtering behaviour (deleted items, non-task/subtask levels, deleted epic parents)
 *
 * @see packages/sourcevision/src/cli/commands/prd-epic-resolver.ts
 * @see CLAUDE.md — Injection seam registry (cross-tier coupling note)
 */

import { describe, it, expect } from "vitest";
import { resolveBranchScopedCompletedRexWorkFromData } from "../../src/cli/commands/prd-epic-resolver.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEpic(id: string, title: string, children: unknown[] = []) {
  return { id, title, level: "epic", status: "in_progress", children };
}

function makeFeature(id: string, title: string, children: unknown[] = []) {
  return { id, title, level: "feature", status: "in_progress", children };
}

function makeTask(id: string, title: string, status = "completed") {
  return { id, title, level: "task", status };
}

// ─── Output shape contract ────────────────────────────────────────────────────

describe("output shape contract", () => {
  it("found result has exact required fields", () => {
    const prd = [
      makeEpic("epic-1", "Alpha", [
        makeFeature("feat-1", "Feature One", [makeTask("t-1", "Task One")]),
      ]),
    ];
    const logs = [{ itemId: "t-1", branch: "main" }];

    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "main");

    expect(result.status).toBe("found");
    expect(Array.isArray(result.epicTitles)).toBe(true);
    expect(Array.isArray(result.completedItems)).toBe(true);
  });

  it("found completedItems have all required fields", () => {
    const prd = [
      makeEpic("epic-1", "Alpha", [
        makeFeature("feat-1", "Feature One", [makeTask("t-1", "Task One")]),
      ]),
    ];
    const logs = [{ itemId: "t-1", branch: "main" }];
    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "main");

    if (result.status !== "found") throw new Error("expected found");
    const item = result.completedItems[0]!;
    expect(typeof item.id).toBe("string");
    expect(typeof item.title).toBe("string");
    expect(typeof item.level).toBe("string");
    expect(typeof item.status).toBe("string");
    expect(typeof item.epicTitle).toBe("string");
    expect(typeof item.executionState).toBe("string");
    // featureTitle is string | null
    expect(item.featureTitle === null || typeof item.featureTitle === "string").toBe(true);
  });

  it("empty result has exact required fields with empty arrays", () => {
    const result = resolveBranchScopedCompletedRexWorkFromData([], [], "main");

    expect(result).toEqual({
      status: "empty",
      signal: "no_branch_scoped_completed_rex_items",
      epicTitles: [],
      completedItems: [],
    });
  });

  it("empty branch string returns empty result immediately", () => {
    const prd = [makeEpic("e", "E", [makeTask("t", "T")])];
    const logs = [{ itemId: "t", branch: "" }];
    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "  ");
    expect(result.status).toBe("empty");
  });
});

// ─── Branch field resolution fallback chain ───────────────────────────────────

describe("branch field fallback chain", () => {
  const prd = [
    makeEpic("epic-1", "Epic", [
      makeFeature("feat-1", "Feature", [makeTask("task-1", "Task")]),
    ]),
  ];

  function assertFound(logs: unknown[], branch: string): void {
    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, branch);
    expect(result.status).toBe("found");
  }

  it("resolves branch from top-level 'branch' field", () => {
    assertFound([{ itemId: "task-1", branch: "feature/x" }], "feature/x");
  });

  it("resolves branch from 'branchName' field when 'branch' absent", () => {
    assertFound([{ itemId: "task-1", branchName: "feature/x" }], "feature/x");
  });

  it("resolves branch from 'gitBranch' field", () => {
    assertFound([{ itemId: "task-1", gitBranch: "feature/x" }], "feature/x");
  });

  it("resolves branch from 'context.branch' field", () => {
    assertFound([{ itemId: "task-1", context: { branch: "feature/x" } }], "feature/x");
  });

  it("resolves branch from 'git.branch' field", () => {
    assertFound([{ itemId: "task-1", git: { branch: "feature/x" } }], "feature/x");
  });

  it("resolves branch from 'metadata.branch' field", () => {
    assertFound([{ itemId: "task-1", metadata: { branch: "feature/x" } }], "feature/x");
  });

  it("prefers 'branch' over 'branchName'", () => {
    // entry.branch='main', entry.branchName='other'
    const logs = [{ itemId: "task-1", branch: "main", branchName: "other" }];
    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "main");
    expect(result.status).toBe("found");
    const result2 = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "other");
    expect(result2.status).toBe("empty");
  });
});

// ─── Sort order ───────────────────────────────────────────────────────────────

describe("sort order", () => {
  it("epicTitles are sorted alphabetically", () => {
    const prd = [
      makeEpic("epic-z", "Zeta", [makeFeature("f-z", "FZ", [makeTask("t-z", "T Z")])]),
      makeEpic("epic-a", "Alpha", [makeFeature("f-a", "FA", [makeTask("t-a", "T A")])]),
      makeEpic("epic-m", "Mu", [makeFeature("f-m", "FM", [makeTask("t-m", "T M")])]),
    ];
    const logs = [
      { itemId: "t-z", branch: "main" },
      { itemId: "t-a", branch: "main" },
      { itemId: "t-m", branch: "main" },
    ];
    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "main");
    if (result.status !== "found") throw new Error("expected found");
    expect(result.epicTitles).toEqual(["Alpha", "Mu", "Zeta"]);
  });

  it("completedItems are sorted by epicTitle, then featureTitle, then title", () => {
    const prd = [
      makeEpic("epic-b", "B Epic", [
        makeFeature("feat-b2", "B Feature 2", [makeTask("t-b2", "Z Task")]),
        makeFeature("feat-b1", "B Feature 1", [makeTask("t-b1", "A Task")]),
      ]),
      makeEpic("epic-a", "A Epic", [
        makeFeature("feat-a", "A Feature", [makeTask("t-a", "A Task")]),
      ]),
    ];
    const logs = [
      { itemId: "t-b2", branch: "main" },
      { itemId: "t-b1", branch: "main" },
      { itemId: "t-a", branch: "main" },
    ];
    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "main");
    if (result.status !== "found") throw new Error("expected found");
    const ids = result.completedItems.map((i) => i.id);
    expect(ids).toEqual(["t-a", "t-b1", "t-b2"]);
  });
});

// ─── Filtering ────────────────────────────────────────────────────────────────

describe("filtering", () => {
  it("excludes items with deleted status", () => {
    const prd = [
      makeEpic("epic-1", "Epic", [
        makeFeature("feat-1", "Feature", [
          makeTask("t-del", "Deleted Task", "deleted"),
          makeTask("t-ok", "Active Task", "completed"),
        ]),
      ]),
    ];
    const logs = [
      { itemId: "t-del", branch: "main" },
      { itemId: "t-ok", branch: "main" },
    ];
    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "main");
    if (result.status !== "found") throw new Error("expected found");
    expect(result.completedItems.map((i) => i.id)).toEqual(["t-ok"]);
  });

  it("excludes items at epic and feature levels (only task/subtask included)", () => {
    const prd = [
      makeEpic("epic-1", "Epic", [
        makeFeature("feat-1", "Feature", [makeTask("t-1", "Task")]),
      ]),
    ];
    // Log touches both the feature and the task
    const logs = [
      { itemId: "epic-1", branch: "main" },
      { itemId: "feat-1", branch: "main" },
      { itemId: "t-1", branch: "main" },
    ];
    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "main");
    if (result.status !== "found") throw new Error("expected found");
    expect(result.completedItems.map((i) => i.id)).toEqual(["t-1"]);
  });

  it("excludes items whose parent epic is deleted", () => {
    const prd = [
      {
        id: "epic-del",
        title: "Deleted Epic",
        level: "epic",
        status: "deleted",
        children: [
          makeFeature("feat-1", "Feature", [makeTask("t-1", "Task")]),
        ],
      },
    ];
    const logs = [{ itemId: "t-1", branch: "main" }];
    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "main");
    expect(result.status).toBe("empty");
  });

  it("entries from other branches are ignored", () => {
    const prd = [
      makeEpic("epic-1", "Epic", [makeFeature("f-1", "F", [makeTask("t-1", "T")])]),
    ];
    const logs = [
      { itemId: "t-1", branch: "other-branch" },
    ];
    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "main");
    expect(result.status).toBe("empty");
  });

  it("executionState is 'completed' for completed tasks and 'executed' otherwise", () => {
    const prd = [
      makeEpic("epic-1", "Epic", [
        makeFeature("f-1", "F", [
          makeTask("t-done", "Done", "completed"),
          makeTask("t-pending", "Pending", "pending"),
        ]),
      ]),
    ];
    const logs = [
      { itemId: "t-done", branch: "main" },
      { itemId: "t-pending", branch: "main" },
    ];
    const result = resolveBranchScopedCompletedRexWorkFromData(prd, logs, "main");
    if (result.status !== "found") throw new Error("expected found");
    const byId = Object.fromEntries(result.completedItems.map((i) => [i.id, i]));
    expect(byId["t-done"]!.executionState).toBe("completed");
    expect(byId["t-pending"]!.executionState).toBe("executed");
  });
});
