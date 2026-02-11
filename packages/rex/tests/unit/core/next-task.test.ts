import { describe, it, expect } from "vitest";
import { findNextTask, findActionableTasks, collectCompletedIds, explainSelection } from "../../../src/core/next-task.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("collectCompletedIds", () => {
  it("collects completed item ids", () => {
    const items: PRDItem[] = [
      makeItem({ id: "1", title: "A", status: "completed" }),
      makeItem({ id: "2", title: "B", status: "pending" }),
      makeItem({
        id: "3",
        title: "C",
        level: "epic",
        children: [
          makeItem({ id: "4", title: "D", status: "completed" }),
        ],
      }),
    ];
    const ids = collectCompletedIds(items);
    expect(ids).toEqual(new Set(["1", "4"]));
  });
});

describe("findNextTask", () => {
  it("returns first pending leaf", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("t1");
  });

  it("skips completed items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "completed" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set(["t1"]));
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("t2");
  });

  it("skips deferred items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "deferred" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("skips blocked items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "blocked" }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("skips items with unresolved blockers", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", blockedBy: ["t3"] }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("unblocks items when blockers are completed", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", blockedBy: ["t0"] }),
      makeItem({ id: "t2", title: "Task 2" }),
    ];
    const result = findNextTask(items, new Set(["t0"]));
    expect(result!.item.id).toBe("t1");
  });

  it("prioritizes by priority (critical first)", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Low", priority: "low" }),
      makeItem({ id: "t2", title: "Critical", priority: "critical" }),
      makeItem({ id: "t3", title: "High", priority: "high" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("goes depth-first into children", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Deep Task" }),
            ],
          }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t1");
    expect(result!.parents.map((p) => p.id)).toEqual(["e1", "f1"]);
  });

  it("returns null when all done", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "completed" }),
      makeItem({ id: "t2", title: "Task 2", status: "deferred" }),
    ];
    const result = findNextTask(items, new Set(["t1"]));
    expect(result).toBeNull();
  });

  it("returns null for empty tree", () => {
    expect(findNextTask([], new Set())).toBeNull();
  });

  it("returns parent when all children are done", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set(["t1", "t2"]));
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("e1");
  });

  it("selects critical task in low-priority epic over medium task in high-priority epic", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "High Epic",
        level: "epic",
        priority: "high",
        children: [
          makeItem({ id: "t1", title: "Medium Task", priority: "medium" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Low Epic",
        level: "epic",
        priority: "low",
        children: [
          makeItem({ id: "t2", title: "Critical Task", priority: "critical" }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("skips children when parent has unresolved blockedBy", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Blocked Epic",
        level: "epic",
        blockedBy: ["external"],
        children: [
          makeItem({ id: "t1", title: "Child of blocked" }),
        ],
      }),
      makeItem({ id: "t2", title: "Free task" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("skips children when ancestor has unresolved blockedBy", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Blocked Epic",
        level: "epic",
        blockedBy: ["external"],
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Deep child of blocked" }),
            ],
          }),
        ],
      }),
      makeItem({ id: "t2", title: "Free task" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("prefers in_progress tasks over pending tasks of same priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Pending high", priority: "high" }),
      makeItem({ id: "t2", title: "In progress high", priority: "high", status: "in_progress" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("prefers in_progress tasks even at lower priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Pending critical", priority: "critical" }),
      makeItem({ id: "t2", title: "In progress medium", priority: "medium", status: "in_progress" }),
    ];
    // in_progress should always come first — finish what you started
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("prefers failing tasks over in_progress tasks", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "In progress", status: "in_progress", priority: "critical" }),
      makeItem({ id: "t2", title: "Failing task", status: "failing", priority: "medium" }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t2");
  });

  it("includes failing tasks as actionable", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Done", status: "completed" }),
      makeItem({ id: "t2", title: "Failing", status: "failing" }),
    ];
    const result = findNextTask(items, new Set(["t1"]));
    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("t2");
  });

  it("uses ancestor priority as tiebreaker for same-priority tasks", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Critical Epic",
        level: "epic",
        priority: "critical",
        children: [
          makeItem({ id: "t1", title: "AAA Task", priority: "medium" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Low Epic",
        level: "epic",
        priority: "low",
        children: [
          makeItem({ id: "t2", title: "AAA Task", priority: "medium" }),
        ],
      }),
    ];
    const result = findNextTask(items, new Set());
    expect(result!.item.id).toBe("t1");
  });
});

describe("explainSelection", () => {
  it("explains basic selection with priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", priority: "high" }),
      makeItem({ id: "t2", title: "Task 2", priority: "low" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.summary).toContain("high");
    expect(explanation.priority).toBeDefined();
    expect(explanation.priority.itemPriority).toBe("high");
  });

  it("explains default medium priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.priority.itemPriority).toBe("medium");
    expect(explanation.summary).toContain("medium");
  });

  it("includes resolved dependency info", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Blocker", status: "completed" }),
      makeItem({ id: "t2", title: "Task 2", blockedBy: ["t1"] }),
    ];
    const completedIds = new Set(["t1"]);
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.dependencies.status).toBe("resolved");
    expect(explanation.dependencies.resolvedBlockers).toContain("t1");
  });

  it("reports no dependencies when none exist", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.dependencies.status).toBe("none");
  });

  it("counts skipped items by reason", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Done", status: "completed" }),
      makeItem({ id: "t2", title: "Deferred", status: "deferred" }),
      makeItem({ id: "t3", title: "Blocked", status: "blocked" }),
      makeItem({ id: "t4", title: "Waiting", blockedBy: ["t99"] }),
      makeItem({ id: "t5", title: "Selected" }),
    ];
    const completedIds = new Set(["t1"]);
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("t5");

    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.skipped.completed).toBe(1);
    expect(explanation.skipped.deferred).toBe(1);
    expect(explanation.skipped.blocked).toBe(1);
    expect(explanation.skipped.unresolvedDeps).toBe(1);
    expect(explanation.skipped.total).toBe(4);
  });

  it("explains depth-first traversal path", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic 1",
        level: "epic",
        priority: "high",
        children: [
          makeItem({
            id: "f1",
            title: "Feature 1",
            level: "feature",
            children: [
              makeItem({ id: "t1", title: "Deep Task" }),
            ],
          }),
        ],
      }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.summary).toContain("Deep Task");
    expect(explanation.traversalPath).toEqual(["Epic 1", "Feature 1"]);
  });

  it("notes when higher-priority items exist but are blocked", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Critical blocked", priority: "critical", blockedBy: ["t99"] }),
      makeItem({ id: "t2", title: "Low available", priority: "low" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("t2");

    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.priority.higherPriorityBlocked).toBe(1);
  });

  it("explains in-progress task selection", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "In progress", status: "in_progress" }),
      makeItem({ id: "t2", title: "Pending" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("t1");

    const explanation = explainSelection(items, result, completedIds);
    expect(explanation.summary).toContain("in_progress");
  });

  it("explains parent completion selection", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "t1", title: "Done", status: "completed" }),
          makeItem({ id: "t2", title: "Done too", status: "completed" }),
        ],
      }),
    ];
    const completedIds = new Set(["t1", "t2"]);
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("e1");

    const explanation = explainSelection(items, result, completedIds);
    expect(explanation.summary).toContain("children completed");
  });
});

describe("findActionableTasks", () => {
  it("returns actionable tasks sorted by priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Low", priority: "low" }),
      makeItem({ id: "t2", title: "Critical", priority: "critical" }),
      makeItem({ id: "t3", title: "Medium", priority: "medium" }),
    ];
    const results = findActionableTasks(items, new Set());
    expect(results.map((r) => r.item.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("ranks in_progress tasks before pending at same priority", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Pending high", priority: "high" }),
      makeItem({ id: "t2", title: "In progress high", priority: "high", status: "in_progress" }),
      makeItem({ id: "t3", title: "Pending medium", priority: "medium" }),
    ];
    const results = findActionableTasks(items, new Set());
    expect(results[0].item.id).toBe("t2");
  });

  it("skips children of blocked parents", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Blocked Epic",
        level: "epic",
        blockedBy: ["external"],
        children: [
          makeItem({ id: "t1", title: "Child of blocked" }),
        ],
      }),
      makeItem({ id: "t2", title: "Free task" }),
    ];
    const results = findActionableTasks(items, new Set());
    expect(results.map((r) => r.item.id)).toEqual(["t2"]);
  });

  it("selects critical tasks across epics regardless of epic priority", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "High Epic",
        level: "epic",
        priority: "high",
        children: [
          makeItem({ id: "t1", title: "Medium Task", priority: "medium" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Low Epic",
        level: "epic",
        priority: "low",
        children: [
          makeItem({ id: "t2", title: "Critical Task", priority: "critical" }),
        ],
      }),
    ];
    const results = findActionableTasks(items, new Set());
    expect(results[0].item.id).toBe("t2");
  });

  it("interleaves tasks from many epics by own priority, not epic order", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Alpha Epic",
        level: "epic",
        priority: "low",
        children: [
          makeItem({ id: "t1", title: "High in low epic", priority: "high" }),
          makeItem({ id: "t2", title: "Low in low epic", priority: "low" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Beta Epic",
        level: "epic",
        priority: "critical",
        children: [
          makeItem({ id: "t3", title: "Critical in critical epic", priority: "critical" }),
          makeItem({ id: "t4", title: "Medium in critical epic", priority: "medium" }),
        ],
      }),
      makeItem({
        id: "e3",
        title: "Gamma Epic",
        level: "epic",
        priority: "medium",
        children: [
          makeItem({ id: "t5", title: "Critical in medium epic", priority: "critical" }),
        ],
      }),
    ];
    const results = findActionableTasks(items, new Set());
    const ids = results.map((r) => r.item.id);
    // critical tasks first (t3 before t5 due to higher ancestor), then high, medium, low
    expect(ids).toEqual(["t3", "t5", "t1", "t4", "t2"]);
  });

  it("selects deeply nested critical task over shallow medium task", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Shallow Epic",
        level: "epic",
        priority: "high",
        children: [
          makeItem({ id: "t1", title: "Shallow Medium", priority: "medium" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Deep Epic",
        level: "epic",
        priority: "low",
        children: [
          makeItem({
            id: "f1",
            title: "Deep Feature",
            level: "feature",
            priority: "low",
            children: [
              makeItem({ id: "t2", title: "Deep Critical", priority: "critical" }),
            ],
          }),
        ],
      }),
    ];
    const results = findActionableTasks(items, new Set());
    expect(results[0].item.id).toBe("t2");
    expect(results[0].parents.map((p) => p.id)).toEqual(["e2", "f1"]);
  });

  it("picks unblocked critical from one epic when another epic's critical is blocked", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic A",
        level: "epic",
        priority: "high",
        children: [
          makeItem({ id: "t1", title: "Blocked Critical", priority: "critical", blockedBy: ["ext"] }),
          makeItem({ id: "t2", title: "Available Medium", priority: "medium" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Epic B",
        level: "epic",
        priority: "low",
        children: [
          makeItem({ id: "t3", title: "Available Critical", priority: "critical" }),
        ],
      }),
    ];
    const results = findActionableTasks(items, new Set());
    // t3 wins: critical and unblocked; t1 is critical but blocked
    expect(results[0].item.id).toBe("t3");
    expect(results.map((r) => r.item.id)).toEqual(["t3", "t2"]);
  });

  it("uses ancestor priority to break ties between same-priority cross-epic tasks", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Critical Epic",
        level: "epic",
        priority: "critical",
        children: [
          makeItem({ id: "t1", title: "ZZZ Task", priority: "high" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "Low Epic",
        level: "epic",
        priority: "low",
        children: [
          makeItem({ id: "t2", title: "AAA Task", priority: "high" }),
        ],
      }),
    ];
    const results = findActionableTasks(items, new Set());
    // Both high priority — ancestor breaks tie: critical epic wins over low epic
    expect(results[0].item.id).toBe("t1");
    expect(results[1].item.id).toBe("t2");
  });

  it("respects limit parameter", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "A" }),
      makeItem({ id: "t2", title: "B" }),
      makeItem({ id: "t3", title: "C" }),
    ];
    const results = findActionableTasks(items, new Set(), 2);
    expect(results).toHaveLength(2);
  });

  it("handles root-level tasks with no parents in ancestor tiebreaker", () => {
    // Root-level tasks (no parents) should sort stably without NaN/Infinity issues
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "B Root", priority: "medium" }),
      makeItem({ id: "t2", title: "A Root", priority: "medium" }),
    ];
    const results = findActionableTasks(items, new Set());
    // Same priority, no parents → alphabetical tiebreak
    expect(results.map((r) => r.item.id)).toEqual(["t2", "t1"]);
  });

  it("findNextTask returns same result as findActionableTasks[0]", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Low", priority: "low" }),
      makeItem({ id: "t2", title: "Critical", priority: "critical" }),
      makeItem({ id: "t3", title: "High", priority: "high", status: "in_progress" }),
    ];
    const completedIds = new Set<string>();
    const next = findNextTask(items, completedIds);
    const all = findActionableTasks(items, completedIds);
    expect(next).not.toBeNull();
    expect(all.length).toBeGreaterThan(0);
    expect(next!.item.id).toBe(all[0].item.id);
  });

  it("skips items with partially resolved blockers", () => {
    // t1 depends on both t0a and t0b, only t0a is completed
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Partially blocked", blockedBy: ["t0a", "t0b"] }),
      makeItem({ id: "t2", title: "Free" }),
    ];
    const results = findActionableTasks(items, new Set(["t0a"]));
    expect(results.map((r) => r.item.id)).toEqual(["t2"]);
  });

  it("includes item when all multiple blockers resolved", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Was blocked", priority: "critical", blockedBy: ["t0a", "t0b"] }),
      makeItem({ id: "t2", title: "Free", priority: "low" }),
    ];
    const results = findActionableTasks(items, new Set(["t0a", "t0b"]));
    expect(results[0].item.id).toBe("t1");
  });

  it("returns empty array when all items blocked", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Blocked 1", blockedBy: ["ext1"] }),
      makeItem({ id: "t2", title: "Blocked 2", status: "blocked" }),
      makeItem({ id: "t3", title: "Done", status: "completed" }),
    ];
    const results = findActionableTasks(items, new Set(["t3"]));
    expect(results).toHaveLength(0);
  });
});

describe("explainSelection — enhanced", () => {
  it("counts only leaf-level skipped items, not branch parents", () => {
    // Epic with a completed child and a pending child — the epic itself
    // should not be counted as skipped
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          makeItem({ id: "t1", title: "Done", status: "completed" }),
          makeItem({ id: "t2", title: "Selected" }),
        ],
      }),
    ];
    const completedIds = new Set(["t1"]);
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("t2");

    const explanation = explainSelection(items, result, completedIds);
    // Only t1 is a skip — e1 is not because it has actionable children
    expect(explanation.skipped.completed).toBe(1);
    expect(explanation.skipped.total).toBe(1);
  });

  it("counts higher-priority items with unresolved deps in blocked count", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Critical with deps", priority: "critical", blockedBy: ["ext"] }),
      makeItem({ id: "t2", title: "Critical blocked", priority: "critical", status: "blocked" }),
      makeItem({ id: "t3", title: "Selected", priority: "low" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("t3");

    const explanation = explainSelection(items, result, completedIds);
    expect(explanation.priority.higherPriorityBlocked).toBe(2);
  });

  it("includes blocker titles in dependency resolution summary when available", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Setup DB", status: "completed" }),
      makeItem({ id: "t2", title: "Run Migrations", blockedBy: ["t1"] }),
    ];
    const completedIds = new Set(["t1"]);
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.dependencies.status).toBe("resolved");
    expect(explanation.summary).toContain("blocker");
  });

  it("provides summary for items with no dependencies and no special status", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Simple task", priority: "high" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    const explanation = explainSelection(items, result, completedIds);

    expect(explanation.summary).toContain("Simple task");
    expect(explanation.summary).toContain("high");
    expect(explanation.dependencies.status).toBe("none");
    expect(explanation.skipped.total).toBe(0);
  });

  it("includes in_progress count in skipped breakdown", () => {
    // Two in_progress tasks — one wins, the other is skipped
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "AAA in progress", priority: "high", status: "in_progress" }),
      makeItem({ id: "t2", title: "ZZZ in progress", priority: "high", status: "in_progress" }),
      makeItem({ id: "t3", title: "Pending low", priority: "low" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("t1");

    const explanation = explainSelection(items, result, completedIds);
    expect(explanation.skipped.inProgress).toBe(1);
    expect(explanation.skipped.total).toBe(2); // t2 (in_progress) + t3 (actionable)
  });

  it("counts actionable but lower-priority items as skipped", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Critical", priority: "critical" }),
      makeItem({ id: "t2", title: "Medium", priority: "medium" }),
      makeItem({ id: "t3", title: "Low", priority: "low" }),
    ];
    const completedIds = new Set<string>();
    const result = findNextTask(items, completedIds)!;
    expect(result.item.id).toBe("t1");

    const explanation = explainSelection(items, result, completedIds);
    // t2 and t3 are actionable but skipped
    expect(explanation.skipped.actionable).toBe(2);
    expect(explanation.skipped.total).toBe(2);
  });
});
