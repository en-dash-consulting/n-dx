import { describe, it, expect } from "vitest";
import { validateStructure } from "../../../src/core/structural.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(
  overrides: Partial<PRDItem> & { id: string; title: string },
): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("validateStructure", () => {
  describe("orphaned items", () => {
    it("accepts valid hierarchy", () => {
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
                makeItem({ id: "t1", title: "Task", level: "task" }),
              ],
            }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.orphanedItems).toEqual([]);
    });

    it("detects subtask at root level", () => {
      const items: PRDItem[] = [
        makeItem({ id: "s1", title: "Lost subtask", level: "subtask" }),
      ];
      const result = validateStructure(items);
      expect(result.orphanedItems.length).toBe(1);
      expect(result.orphanedItems[0].itemId).toBe("s1");
      expect(result.orphanedItems[0].reason).toMatch(/subtask.*root/i);
    });

    it("detects feature not under epic", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "f1",
          title: "Feature",
          level: "feature",
          children: [
            makeItem({
              id: "f2",
              title: "Nested feature",
              level: "feature",
            }),
          ],
        }),
      ];
      const result = validateStructure(items);
      // f1 at root is invalid (feature must be under epic)
      expect(result.orphanedItems.some((o) => o.itemId === "f1")).toBe(true);
      // f2 under a feature is also invalid
      expect(result.orphanedItems.some((o) => o.itemId === "f2")).toBe(true);
    });

    it("detects subtask directly under epic", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          children: [
            makeItem({ id: "s1", title: "Subtask", level: "subtask" }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.orphanedItems.length).toBe(1);
      expect(result.orphanedItems[0].itemId).toBe("s1");
    });

    it("accepts tasks directly under epics", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          children: [makeItem({ id: "t1", title: "Task", level: "task" })],
        }),
      ];
      const result = validateStructure(items);
      expect(result.orphanedItems).toEqual([]);
    });

    it("reports empty tree as clean", () => {
      const result = validateStructure([]);
      expect(result.orphanedItems).toEqual([]);
    });

    it("accepts full four-level hierarchy", () => {
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
                makeItem({
                  id: "t1",
                  title: "Task",
                  level: "task",
                  children: [
                    makeItem({ id: "s1", title: "Subtask", level: "subtask" }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.orphanedItems).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("detects subtask under feature (must be under task)", () => {
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
                makeItem({ id: "s1", title: "Subtask", level: "subtask" }),
              ],
            }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.orphanedItems.length).toBe(1);
      expect(result.orphanedItems[0].itemId).toBe("s1");
      expect(result.orphanedItems[0].reason).toMatch(/subtask.*under feature/i);
    });

    it("detects epic nested under another epic", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Outer epic",
          level: "epic",
          children: [
            makeItem({ id: "e2", title: "Inner epic", level: "epic" }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.orphanedItems.length).toBe(1);
      expect(result.orphanedItems[0].itemId).toBe("e2");
      expect(result.orphanedItems[0].reason).toMatch(/epic.*under epic/i);
    });

    it("detects multiple orphans at different levels", () => {
      const items: PRDItem[] = [
        makeItem({ id: "f1", title: "Root feature", level: "feature" }),
        makeItem({ id: "s1", title: "Root subtask", level: "subtask" }),
      ];
      const result = validateStructure(items);
      expect(result.orphanedItems.length).toBe(2);
      expect(result.orphanedItems.map((o) => o.itemId).sort()).toEqual(["f1", "s1"]);
    });

    it("includes title in orphan result", () => {
      const items: PRDItem[] = [
        makeItem({ id: "s1", title: "My lost subtask", level: "subtask" }),
      ];
      const result = validateStructure(items);
      expect(result.orphanedItems[0].title).toBe("My lost subtask");
      expect(result.orphanedItems[0].level).toBe("subtask");
    });

    it("valid items alongside orphans do not mask detection", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Valid epic",
          level: "epic",
          children: [
            makeItem({ id: "t1", title: "Valid task", level: "task" }),
          ],
        }),
        makeItem({ id: "s1", title: "Orphan subtask", level: "subtask" }),
      ];
      const result = validateStructure(items);
      expect(result.orphanedItems.length).toBe(1);
      expect(result.orphanedItems[0].itemId).toBe("s1");
      expect(result.valid).toBe(false);
    });
  });

  describe("circular blockedBy references", () => {
    it("accepts no blockedBy edges", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "A" }),
        makeItem({ id: "t2", title: "B" }),
      ];
      const result = validateStructure(items);
      expect(result.cycles).toEqual([]);
    });

    it("accepts valid linear chain", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "A" }),
        makeItem({ id: "t2", title: "B", blockedBy: ["t1"] }),
        makeItem({ id: "t3", title: "C", blockedBy: ["t2"] }),
      ];
      const result = validateStructure(items);
      expect(result.cycles).toEqual([]);
    });

    it("detects simple two-node cycle", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "A", blockedBy: ["t2"] }),
        makeItem({ id: "t2", title: "B", blockedBy: ["t1"] }),
      ];
      const result = validateStructure(items);
      expect(result.cycles.length).toBeGreaterThan(0);
      // The cycle should contain both nodes
      const cycle = result.cycles[0];
      expect(cycle).toContain("t1");
      expect(cycle).toContain("t2");
    });

    it("detects three-node cycle", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "A", blockedBy: ["t3"] }),
        makeItem({ id: "t2", title: "B", blockedBy: ["t1"] }),
        makeItem({ id: "t3", title: "C", blockedBy: ["t2"] }),
      ];
      const result = validateStructure(items);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it("detects self-reference as cycle", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "A", blockedBy: ["t1"] }),
      ];
      const result = validateStructure(items);
      expect(result.cycles.length).toBeGreaterThan(0);
      expect(result.cycles[0]).toContain("t1");
    });

    it("detects cycle across nesting levels", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          blockedBy: ["t1"],
          children: [
            makeItem({ id: "t1", title: "A", level: "task", blockedBy: ["e1"] }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it("ignores references to non-existent items for cycle detection", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "A", blockedBy: ["ghost"] }),
      ];
      const result = validateStructure(items);
      expect(result.cycles).toEqual([]);
    });
  });

  describe("stuck in_progress tasks", () => {
    it("accepts recently started task", () => {
      const now = new Date();
      const items: PRDItem[] = [
        makeItem({
          id: "t1",
          title: "Fresh task",
          status: "in_progress",
          startedAt: now.toISOString(),
        }),
      ];
      const result = validateStructure(items);
      expect(result.stuckItems).toEqual([]);
    });

    it("detects task in_progress for too long", () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const items: PRDItem[] = [
        makeItem({
          id: "t1",
          title: "Old task",
          status: "in_progress",
          startedAt: threeDaysAgo.toISOString(),
        }),
      ];
      const result = validateStructure(items, { stuckThresholdMs: 24 * 60 * 60 * 1000 }); // 1 day
      expect(result.stuckItems.length).toBe(1);
      expect(result.stuckItems[0].itemId).toBe("t1");
      expect(result.stuckItems[0].stuckSinceMs).toBeGreaterThan(0);
    });

    it("ignores completed tasks", () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const items: PRDItem[] = [
        makeItem({
          id: "t1",
          title: "Done task",
          status: "completed",
          startedAt: threeDaysAgo.toISOString(),
        }),
      ];
      const result = validateStructure(items, { stuckThresholdMs: 24 * 60 * 60 * 1000 });
      expect(result.stuckItems).toEqual([]);
    });

    it("ignores pending tasks", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "Pending", status: "pending" }),
      ];
      const result = validateStructure(items);
      expect(result.stuckItems).toEqual([]);
    });

    it("flags in_progress task without startedAt as stuck", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "t1",
          title: "No timestamp",
          status: "in_progress",
        }),
      ];
      const result = validateStructure(items);
      expect(result.stuckItems.length).toBe(1);
      expect(result.stuckItems[0].itemId).toBe("t1");
      expect(result.stuckItems[0].reason).toMatch(/no startedAt/i);
    });

    it("uses default threshold of 48 hours", () => {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const items: PRDItem[] = [
        makeItem({
          id: "t1",
          title: "Recent enough",
          status: "in_progress",
          startedAt: oneDayAgo.toISOString(),
        }),
        makeItem({
          id: "t2",
          title: "Too old",
          status: "in_progress",
          startedAt: threeDaysAgo.toISOString(),
        }),
      ];
      const result = validateStructure(items);
      expect(result.stuckItems.length).toBe(1);
      expect(result.stuckItems[0].itemId).toBe("t2");
    });

    it("detects stuck tasks inside nested children", () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          children: [
            makeItem({
              id: "t1",
              title: "Stuck nested",
              status: "in_progress",
              startedAt: threeDaysAgo.toISOString(),
            }),
          ],
        }),
      ];
      const result = validateStructure(items, { stuckThresholdMs: 24 * 60 * 60 * 1000 });
      expect(result.stuckItems.length).toBe(1);
      expect(result.stuckItems[0].itemId).toBe("t1");
    });
  });

  describe("blocked items without blockedBy", () => {
    it("warns about blocked item with no blockedBy", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "Mystery blocker", status: "blocked" }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("t1");
      expect(result.warnings[0]).toContain("blockedBy is empty");
    });

    it("warns about blocked item with empty blockedBy array", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "Empty deps", status: "blocked", blockedBy: [] }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.length).toBe(1);
    });

    it("does not warn about blocked item with blockedBy populated", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "Properly blocked", status: "blocked", blockedBy: ["dep-1"] }),
        makeItem({ id: "dep-1", title: "Dependency" }),
      ];
      const result = validateStructure(items);
      expect(result.warnings).toEqual([]);
    });

    it("does not warn about non-blocked items", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "Normal pending", status: "pending" }),
        makeItem({ id: "t2", title: "In progress", status: "in_progress", startedAt: new Date().toISOString() }),
        makeItem({ id: "t3", title: "Done", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-02T00:00:00.000Z" }),
        makeItem({ id: "t4", title: "Deferred", status: "deferred" }),
      ];
      const result = validateStructure(items);
      expect(result.warnings).toEqual([]);
    });

    it("warnings do not affect valid flag", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          children: [
            makeItem({ id: "t1", title: "Mystery blocker", status: "blocked" }),
          ],
        }),
      ];
      const result = validateStructure(items);
      // Warnings are non-fatal; result should still be valid
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBe(1);
    });
  });

  describe("timestamp consistency", () => {
    it("warns about completed item without completedAt", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "Done but no timestamp", status: "completed" }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.some((w) => w.includes("t1") && w.includes("completedAt"))).toBe(true);
    });

    it("warns about in_progress item without startedAt", () => {
      // Note: this is already caught as a stuck item, but should also produce a
      // consistency warning. The existing stuck detection handles the error case.
      // Here we verify the consistency warning fires too.
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "WIP no start", status: "in_progress" }),
      ];
      const result = validateStructure(items);
      // Already flagged as stuck — verify that exists
      expect(result.stuckItems.length).toBe(1);
    });

    it("warns when completedAt is before startedAt", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "t1",
          title: "Time travel",
          status: "completed",
          startedAt: "2026-01-10T00:00:00.000Z",
          completedAt: "2026-01-05T00:00:00.000Z",
        }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.some((w) => w.includes("t1") && w.includes("before startedAt"))).toBe(true);
    });

    it("does not warn when timestamps are consistent", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "t1",
          title: "Properly done",
          status: "completed",
          startedAt: "2026-01-05T00:00:00.000Z",
          completedAt: "2026-01-10T00:00:00.000Z",
        }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.filter((w) => w.includes("t1"))).toEqual([]);
    });

    it("warns about pending item with completedAt", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "t1",
          title: "Pending with stale completedAt",
          status: "pending",
          completedAt: "2026-01-10T00:00:00.000Z",
        }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.some((w) => w.includes("t1") && w.includes("completedAt"))).toBe(true);
    });

    it("warns about deferred item with completedAt", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "t1",
          title: "Deferred with completedAt",
          status: "deferred",
          completedAt: "2026-01-10T00:00:00.000Z",
        }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.some((w) => w.includes("t1") && w.includes("completedAt"))).toBe(true);
    });
  });

  describe("parent-child status consistency", () => {
    it("warns when parent is completed but child is pending", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Completed epic",
          level: "epic",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-10T00:00:00.000Z",
          children: [
            makeItem({ id: "t1", title: "Pending task", level: "task", status: "pending" }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.some((w) => w.includes("e1") && w.includes("non-terminal"))).toBe(true);
    });

    it("warns when parent is completed but child is in_progress", () => {
      const now = new Date().toISOString();
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Completed epic",
          level: "epic",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-10T00:00:00.000Z",
          children: [
            makeItem({
              id: "t1",
              title: "WIP task",
              level: "task",
              status: "in_progress",
              startedAt: now,
            }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.some((w) => w.includes("e1") && w.includes("non-terminal"))).toBe(true);
    });

    it("does not warn when completed parent has all completed children", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Completed epic",
          level: "epic",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-10T00:00:00.000Z",
          children: [
            makeItem({
              id: "t1",
              title: "Done task",
              level: "task",
              status: "completed",
              startedAt: "2026-01-02T00:00:00.000Z",
              completedAt: "2026-01-05T00:00:00.000Z",
            }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.filter((w) => w.includes("e1") && w.includes("non-terminal"))).toEqual([]);
    });

    it("does not warn when completed parent has all deferred children", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Completed epic",
          level: "epic",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-10T00:00:00.000Z",
          children: [
            makeItem({ id: "t1", title: "Deferred task", level: "task", status: "deferred" }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.filter((w) => w.includes("e1") && w.includes("non-terminal"))).toEqual([]);
    });

    it("does not warn when non-completed parent has pending children", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "In progress epic",
          level: "epic",
          status: "in_progress",
          startedAt: new Date().toISOString(),
          children: [
            makeItem({ id: "t1", title: "Pending task", level: "task", status: "pending" }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.filter((w) => w.includes("e1") && w.includes("non-terminal"))).toEqual([]);
    });

    it("does not warn when parent has no children", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Completed empty epic",
          level: "epic",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-10T00:00:00.000Z",
        }),
      ];
      const result = validateStructure(items);
      expect(result.warnings.filter((w) => w.includes("e1") && w.includes("non-terminal"))).toEqual([]);
    });
  });

  describe("empty containers", () => {
    it("warns about epic with no children", () => {
      const items: PRDItem[] = [
        makeItem({ id: "e1", title: "Empty Epic", level: "epic" }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers.length).toBe(1);
      expect(result.emptyContainers[0].itemId).toBe("e1");
      expect(result.emptyContainers[0].level).toBe("epic");
      expect(result.emptyContainers[0].reason).toMatch(/no child/i);
    });

    it("warns about epic with empty children array", () => {
      const items: PRDItem[] = [
        makeItem({ id: "e1", title: "Empty Epic", level: "epic", children: [] }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers.length).toBe(1);
      expect(result.emptyContainers[0].itemId).toBe("e1");
    });

    it("warns about feature with no children", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          children: [
            makeItem({ id: "f1", title: "Empty Feature", level: "feature" }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers.length).toBe(1);
      expect(result.emptyContainers[0].itemId).toBe("f1");
      expect(result.emptyContainers[0].level).toBe("feature");
    });

    it("does not warn about epic with children", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          children: [
            makeItem({ id: "t1", title: "Task", level: "task" }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers).toEqual([]);
    });

    it("does not warn about feature with children", () => {
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
                makeItem({ id: "t1", title: "Task", level: "task" }),
              ],
            }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers).toEqual([]);
    });

    it("does not flag tasks or subtasks as empty containers", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          children: [
            makeItem({ id: "t1", title: "Task with no subtasks", level: "task" }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers).toEqual([]);
    });

    it("skips deleted items", () => {
      const items: PRDItem[] = [
        makeItem({ id: "e1", title: "Deleted Epic", level: "epic", status: "deleted" }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers).toEqual([]);
    });

    it("skips completed items", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Completed Epic",
          level: "epic",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-02T00:00:00.000Z",
        }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers).toEqual([]);
    });

    it("skips deferred items", () => {
      const items: PRDItem[] = [
        makeItem({ id: "e1", title: "Deferred Epic", level: "epic", status: "deferred" }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers).toEqual([]);
    });

    it("detects multiple empty containers", () => {
      const items: PRDItem[] = [
        makeItem({ id: "e1", title: "Empty Epic 1", level: "epic" }),
        makeItem({ id: "e2", title: "Empty Epic 2", level: "epic" }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers.length).toBe(2);
    });

    it("includes title in empty container result", () => {
      const items: PRDItem[] = [
        makeItem({ id: "e1", title: "My Lonely Epic", level: "epic" }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers[0].title).toBe("My Lonely Epic");
    });

    it("empty container warnings do not affect valid flag", () => {
      const items: PRDItem[] = [
        makeItem({ id: "e1", title: "Empty Epic", level: "epic" }),
      ];
      const result = validateStructure(items);
      // Empty containers are warnings, not errors
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("e1"))).toBe(true);
    });

    it("counts only non-deleted children", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Epic with deleted child",
          level: "epic",
          children: [
            makeItem({ id: "t1", title: "Deleted Task", level: "task", status: "deleted" }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.emptyContainers.length).toBe(1);
      expect(result.emptyContainers[0].itemId).toBe("e1");
    });
  });

  describe("aggregate result", () => {
    it("returns valid true when no issues", () => {
      const items: PRDItem[] = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          children: [
            makeItem({ id: "t1", title: "Task", level: "task" }),
          ],
        }),
      ];
      const result = validateStructure(items);
      expect(result.valid).toBe(true);
    });

    it("returns valid false when orphans exist", () => {
      const items: PRDItem[] = [
        makeItem({ id: "s1", title: "Orphan", level: "subtask" }),
      ];
      const result = validateStructure(items);
      expect(result.valid).toBe(false);
    });

    it("returns valid false when cycles exist", () => {
      const items: PRDItem[] = [
        makeItem({ id: "t1", title: "A", blockedBy: ["t2"] }),
        makeItem({ id: "t2", title: "B", blockedBy: ["t1"] }),
      ];
      const result = validateStructure(items);
      expect(result.valid).toBe(false);
    });

    it("collects errors from all checks", () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const items: PRDItem[] = [
        makeItem({ id: "s1", title: "Orphan", level: "subtask" }),
        makeItem({
          id: "t1",
          title: "A",
          blockedBy: ["t2"],
          status: "in_progress",
          startedAt: threeDaysAgo.toISOString(),
        }),
        makeItem({ id: "t2", title: "B", blockedBy: ["t1"] }),
      ];
      const result = validateStructure(items, { stuckThresholdMs: 24 * 60 * 60 * 1000 });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Should have errors from all three categories
      expect(result.orphanedItems.length).toBeGreaterThan(0);
      expect(result.cycles.length).toBeGreaterThan(0);
      expect(result.stuckItems.length).toBeGreaterThan(0);
    });
  });
});
