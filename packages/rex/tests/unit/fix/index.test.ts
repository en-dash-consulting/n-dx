import { describe, it, expect } from "vitest";
import {
  detectTimestampIssues,
  detectOrphanBlockedBy,
  detectParentChildMisalignment,
  detectStuckParents,
  detectIssues,
  applyFixes,
} from "../../../src/fix/index.js";

type PRDItem = {
  id: string;
  title: string;
  level?: string;
  status: "pending" | "in_progress" | "completed" | "deferred" | "blocked" | "cancelled" | "deleted";
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
    // `pending`, not `in_progress`: AUTO_COMPLETABLE_STATUSES is {pending}
    // since #368, so reopening to in_progress strands the parent forever.
    expect(actions[0].description).toContain("pending");
    expect(actions[0].description).not.toContain("in_progress");
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

  // GitHub #364: a completed parent holding a deferred child is the
  // "half-migration reported as done" bug. `rex validate` has warned about it
  // since #364 narrowed SUCCESSFUL_CHILD_STATUSES to {completed}; `rex fix`
  // kept a private set that still counted deferred as terminal, so it proposed
  // nothing. Both now read the same predicate.
  it("detects completed parent with a deferred child, matching rex validate", () => {
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
    const actions = detectParentChildMisalignment(items);
    expect(actions).toHaveLength(1);
    expect(actions[0].itemId).toBe("e1");
    expect(actions[0].description).toContain("1 unfinished child");
  });

  it.each(["cancelled", "deleted"] as const)(
    "detects completed parent with a %s child",
    (status) => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          status: "completed",
          startedAt: NOW,
          completedAt: NOW,
          children: [makeItem({ id: "t1", title: "Child", status })],
        }),
      ];
      expect(detectParentChildMisalignment(items)).toHaveLength(1);
    },
  );

  it("ignores completed parent whose children are all completed", () => {
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
// detectStuckParents
// ---------------------------------------------------------------------------

describe("detectStuckParents", () => {
  it("detects a pending parent whose children are all completed", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task", status: "completed", startedAt: NOW, completedAt: NOW }),
        ],
      }),
    ];
    const actions = detectStuckParents(items);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("stuck_parent");
    expect(actions[0].itemId).toBe("f1");
  });

  // #368 made in_progress an explicit claim that auto-completion must not
  // close. The operator-run sweep honours the same refusal; `rex status`
  // surfaces these for a human instead.
  it("never closes an in_progress parent", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature",
        level: "feature",
        status: "in_progress",
        startedAt: NOW,
        children: [
          makeItem({ id: "t1", title: "Task", status: "completed", startedAt: NOW, completedAt: NOW }),
        ],
      }),
    ];
    expect(detectStuckParents(items)).toHaveLength(0);
  });

  it.each(["pending", "in_progress", "deferred", "blocked"] as const)(
    "leaves a parent alone while a %s child is outstanding",
    (status) => {
      const items: PRDItem[] = [
        makeItem({
          id: "f1",
          title: "Feature",
          level: "feature",
          status: "pending",
          children: [
            makeItem({ id: "t1", title: "Done", status: "completed", startedAt: NOW, completedAt: NOW }),
            makeItem({ id: "t2", title: "Outstanding", status }),
          ],
        }),
      ];
      expect(detectStuckParents(items)).toHaveLength(0);
    },
  );

  it("never completes a childless item", () => {
    const items: PRDItem[] = [makeItem({ id: "t1", title: "Leaf", status: "pending" })];
    expect(detectStuckParents(items)).toHaveLength(0);
  });

  // The whole-tree scenario from the task: F1 was stranded by a lost cascade,
  // so completing T under F2 could never reach E. The scoped sweep an agent run
  // performs cannot see F1; this one can.
  it("heals a stranded sibling so the epic above it can close too", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "f1",
            title: "Stranded Feature",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t1", title: "T1", status: "completed", startedAt: NOW, completedAt: NOW }),
            ],
          }),
          makeItem({
            id: "f2",
            title: "Feature Two",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t2", title: "T2", status: "completed", startedAt: NOW, completedAt: NOW }),
            ],
          }),
        ],
      }),
    ];
    const actions = detectStuckParents(items);
    // Bottom-up: both features before the epic they share.
    expect(actions.map((a) => a.itemId)).toEqual(["f1", "f2", "e1"]);
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

  it("reopens a falsely-completed parent to pending, not in_progress", () => {
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
    // in_progress would be outside AUTO_COMPLETABLE_STATUSES, so the epic
    // could never close again when t1 finished.
    expect(items[0].status).toBe("pending");
    expect(items[0].completedAt).toBeUndefined();
  });

  it("reopens a completed parent that is holding a deferred child", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "completed",
        startedAt: NOW,
        completedAt: NOW,
        children: [
          makeItem({ id: "t1", title: "Done", status: "completed", startedAt: NOW, completedAt: NOW }),
          makeItem({ id: "t2", title: "Deferred", status: "deferred" }),
        ],
      }),
    ];
    const result = applyFixes(items, NOW);
    expect(items[0].status).toBe("pending");
    expect(items[0].completedAt).toBeUndefined();
    expect(result.actions.some((a) => a.kind === "parent_child_alignment")).toBe(true);
  });

  it("completes a stuck pending parent and stamps completedAt", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature",
        level: "feature",
        status: "pending",
        startedAt: NOW,
        children: [
          makeItem({ id: "t1", title: "Task", status: "completed", startedAt: NOW, completedAt: NOW }),
        ],
      }),
    ];
    const result = applyFixes(items, NOW);
    expect(items[0].status).toBe("completed");
    expect(items[0].completedAt).toBe(NOW);
    expect(result.actions.some((a) => a.kind === "stuck_parent")).toBe(true);
  });

  it("backfills startedAt on a stuck parent that never had one", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature",
        level: "feature",
        status: "pending",
        children: [
          makeItem({ id: "t1", title: "Task", status: "completed", startedAt: NOW, completedAt: NOW }),
        ],
      }),
    ];
    applyFixes(items, NOW);
    // Otherwise the very next `rex fix` flags it as a missing timestamp.
    expect(items[0].startedAt).toBe(NOW);
  });

  it("completes a stuck feature before the epic above it, in one pass", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          makeItem({
            id: "f1",
            title: "Feature",
            level: "feature",
            status: "pending",
            children: [
              makeItem({ id: "t1", title: "Task", status: "completed", startedAt: NOW, completedAt: NOW }),
            ],
          }),
        ],
      }),
    ];
    applyFixes(items, NOW);
    expect(items[0].children![0].status).toBe("completed");
    expect(items[0].status).toBe("completed");
  });

  // The two parent repairs must not fight: reopening runs first, and the item
  // it reopens still holds an unfinished child, so the sweep cannot re-close it.
  it("does not re-close a parent it just reopened", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "completed",
        startedAt: NOW,
        completedAt: NOW,
        children: [
          makeItem({ id: "t1", title: "Done", status: "completed", startedAt: NOW, completedAt: NOW }),
          makeItem({ id: "t2", title: "Deferred", status: "deferred" }),
        ],
      }),
    ];
    applyFixes(items, NOW);
    expect(items[0].status).toBe("pending");
  });

  // Reopening does not touch startedAt — it records when the work began, which
  // reopening does not undo. This matches cascadeParentReset in
  // core/parent-reset.ts, which writes only {status, completedAt}.
  it("preserves the original startedAt when reopening a parent", () => {
    const earlier = "2026-01-01T00:00:00.000Z";
    const items: PRDItem[] = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "completed",
        startedAt: earlier,
        completedAt: NOW,
        children: [
          makeItem({ id: "t1", title: "Task", status: "pending" }),
        ],
      }),
    ];
    applyFixes(items, NOW);
    expect(items[0].status).toBe("pending");
    expect(items[0].startedAt).toBe(earlier);
  });

  // The timestamp pass runs first and sees the parent while it is still
  // `completed`, so a missing startedAt is backfilled there rather than by the
  // reopen itself.
  it("backfills a missing startedAt via the timestamp pass before reopening", () => {
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
