import { describe, it, expect } from "vitest";
import {
  detectTimestampIssues,
  detectOrphanBlockedBy,
  detectParentChildMisalignment,
  detectIssues,
  applyFixes,
} from "../../../src/core/fix.js";

type PRDItem = {
  id: string;
  title: string;
  level?: string;
  status: "pending" | "in_progress" | "completed" | "deferred" | "deleted";
  startedAt?: string;
  completedAt?: string;
  blockedBy?: string[];
  children?: PRDItem[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<PRDItem> & Pick<PRDItem, "id" | "title">): PRDItem {
  return {
    level: "task",
    status: "pending",
    ...overrides,
  };
}

const NOW = "2026-02-09T12:00:00.000Z";

// ---------------------------------------------------------------------------
// detectTimestampIssues
// ---------------------------------------------------------------------------

describe("detectTimestampIssues", () => {
  it("detects completed item without completedAt", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "completed", startedAt: NOW }),
    ];
    const actions = detectTimestampIssues(items);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("missing_timestamp");
    expect(actions[0].itemId).toBe("t1");
    expect(actions[0].description).toContain("completedAt");
  });

  it("detects in_progress item without startedAt", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "in_progress" }),
    ];
    const actions = detectTimestampIssues(items);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("missing_timestamp");
    expect(actions[0].description).toContain("startedAt");
  });

  it("detects completed item without both startedAt and completedAt", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", status: "completed" }),
    ];
    const actions = detectTimestampIssues(items);
    // Should detect both: missing completedAt AND missing startedAt
    expect(actions).toHaveLength(2);
    const kinds = actions.map((a) => a.description);
    expect(kinds.some((d) => d.includes("completedAt"))).toBe(true);
    expect(kinds.some((d) => d.includes("startedAt"))).toBe(true);
  });

  it("detects stale completedAt on non-completed item", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "Task 1",
        status: "pending",
        completedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    const actions = detectTimestampIssues(items);
    expect(actions).toHaveLength(1);
    expect(actions[0].description).toContain("stale completedAt");
  });

  it("returns empty for healthy items", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "Task 1",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-02T00:00:00.000Z",
      }),
      makeItem({ id: "t2", title: "Task 2", status: "pending" }),
    ];
    expect(detectTimestampIssues(items)).toHaveLength(0);
  });

  it("walks into nested children", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Nested Task", status: "completed" }),
        ],
      }),
    ];
    const actions = detectTimestampIssues(items);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].itemId).toBe("t1");
  });
});

// ---------------------------------------------------------------------------
// detectOrphanBlockedBy
// ---------------------------------------------------------------------------

describe("detectOrphanBlockedBy", () => {
  it("detects references to non-existent IDs", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", blockedBy: ["missing-id"] }),
    ];
    const actions = detectOrphanBlockedBy(items);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("orphan_blocked_by");
    expect(actions[0].itemId).toBe("t1");
  });

  it("ignores valid blockedBy references", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
      makeItem({ id: "t2", title: "Task 2", blockedBy: ["t1"] }),
    ];
    expect(detectOrphanBlockedBy(items)).toHaveLength(0);
  });

  it("detects partial orphans (mix of valid and invalid refs)", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
      makeItem({ id: "t2", title: "Task 2", blockedBy: ["t1", "nonexistent"] }),
    ];
    const actions = detectOrphanBlockedBy(items);
    expect(actions).toHaveLength(1);
    expect(actions[0].description).toContain("1 orphan");
  });

  it("reports multiple orphan refs in a single action", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1", blockedBy: ["gone1", "gone2", "gone3"] }),
    ];
    const actions = detectOrphanBlockedBy(items);
    expect(actions).toHaveLength(1);
    expect(actions[0].description).toContain("3 orphan");
  });

  it("returns empty when no blockedBy fields exist", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
    ];
    expect(detectOrphanBlockedBy(items)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// detectParentChildMisalignment
// ---------------------------------------------------------------------------

describe("detectParentChildMisalignment", () => {
  it("detects completed parent with pending child", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "completed",
        startedAt: NOW,
        completedAt: NOW,
        children: [
          makeItem({ id: "t1", title: "Pending Task", status: "pending" }),
        ],
      }),
    ];
    const actions = detectParentChildMisalignment(items);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("parent_child_alignment");
    expect(actions[0].itemId).toBe("e1");
    expect(actions[0].description).toContain("in_progress");
  });

  it("detects completed parent with in_progress child", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "completed",
        startedAt: NOW,
        completedAt: NOW,
        children: [
          makeItem({ id: "t1", title: "Active Task", status: "in_progress", startedAt: NOW }),
        ],
      }),
    ];
    const actions = detectParentChildMisalignment(items);
    expect(actions).toHaveLength(1);
  });

  it("ignores completed parent with all terminal children", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "completed",
        startedAt: NOW,
        completedAt: NOW,
        children: [
          makeItem({ id: "t1", title: "Done Task", status: "completed", startedAt: NOW, completedAt: NOW }),
          makeItem({ id: "t2", title: "Deferred Task", status: "deferred" }),
        ],
      }),
    ];
    expect(detectParentChildMisalignment(items)).toHaveLength(0);
  });

  it("ignores non-completed parents", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "in_progress",
        startedAt: NOW,
        children: [
          makeItem({ id: "t1", title: "Task", status: "pending" }),
        ],
      }),
    ];
    expect(detectParentChildMisalignment(items)).toHaveLength(0);
  });

  it("ignores completed items without children", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Leaf", status: "completed", startedAt: NOW, completedAt: NOW }),
    ];
    expect(detectParentChildMisalignment(items)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// detectIssues (aggregation)
// ---------------------------------------------------------------------------

describe("detectIssues", () => {
  it("combines all issue types", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "completed",
        children: [
          makeItem({
            id: "t1",
            title: "Pending Task",
            status: "pending",
            blockedBy: ["nonexistent"],
          }),
        ],
      }),
    ];
    const actions = detectIssues(items);
    const kinds = new Set(actions.map((a) => a.kind));
    expect(kinds.has("missing_timestamp")).toBe(true);
    expect(kinds.has("orphan_blocked_by")).toBe(true);
    expect(kinds.has("parent_child_alignment")).toBe(true);
  });

  it("returns empty for a clean tree", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task", status: "pending" }),
        ],
      }),
    ];
    expect(detectIssues(items)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyFixes
// ---------------------------------------------------------------------------

describe("applyFixes", () => {
  it("adds completedAt to completed items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task", status: "completed", startedAt: NOW }),
    ];
    const result = applyFixes(items, NOW);
    expect(items[0].completedAt).toBe(NOW);
    expect(result.mutatedCount).toBeGreaterThan(0);
  });

  it("adds startedAt to in_progress items", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task", status: "in_progress" }),
    ];
    applyFixes(items, NOW);
    expect(items[0].startedAt).toBe(NOW);
  });

  it("adds both startedAt and completedAt to completed items missing both", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task", status: "completed" }),
    ];
    applyFixes(items, NOW);
    expect(items[0].startedAt).toBe(NOW);
    expect(items[0].completedAt).toBe(NOW);
  });

  it("clears stale completedAt from non-completed items", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "t1",
        title: "Task",
        status: "pending",
        completedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    applyFixes(items, NOW);
    expect(items[0].completedAt).toBeUndefined();
  });

  it("removes orphan blockedBy references", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task 1" }),
      makeItem({ id: "t2", title: "Task 2", blockedBy: ["t1", "gone"] }),
    ];
    applyFixes(items, NOW);
    expect(items[1].blockedBy).toEqual(["t1"]);
  });

  it("deletes blockedBy array when all refs are orphans", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task", blockedBy: ["gone1", "gone2"] }),
    ];
    applyFixes(items, NOW);
    expect(items[0].blockedBy).toBeUndefined();
  });

  it("resets completed parent to in_progress when children are non-terminal", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "completed",
        startedAt: NOW,
        completedAt: NOW,
        children: [
          makeItem({ id: "t1", title: "Task", status: "pending" }),
        ],
      }),
    ];
    applyFixes(items, NOW);
    expect(items[0].status).toBe("in_progress");
    expect(items[0].completedAt).toBeUndefined();
  });

  it("sets startedAt when resetting parent that lacks it", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "completed",
        completedAt: NOW,
        children: [
          makeItem({ id: "t1", title: "Task", status: "pending" }),
        ],
      }),
    ];
    applyFixes(items, NOW);
    expect(items[0].startedAt).toBe(NOW);
  });

  it("returns zero mutations for a clean tree", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task", status: "pending" }),
    ];
    const result = applyFixes(items, NOW);
    expect(result.mutatedCount).toBe(0);
    expect(result.actions).toHaveLength(0);
  });

  it("reports actions even when mutations happen", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task", status: "completed" }),
    ];
    const result = applyFixes(items, NOW);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.mutatedCount).toBeGreaterThan(0);
  });

  it("uses current time when no timestamp provided", () => {
    const items: PRDItem[] = [
      makeItem({ id: "t1", title: "Task", status: "completed" }),
    ];
    const result = applyFixes(items);
    expect(items[0].completedAt).toBeDefined();
    expect(result.mutatedCount).toBeGreaterThan(0);
  });
});
