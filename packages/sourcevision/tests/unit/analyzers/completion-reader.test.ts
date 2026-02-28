import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  readCompletionStatus,
  extractItemCompletion,
  computeCompletionStats,
  detectInconsistencies,
  computeCompletionTimeline,
} from "../../../src/analyzers/completion-reader.js";
import type {
  CompletionState,
  CompletionStats,
  CompletionTimeline,
  CompletionInconsistency,
  CompletionStatusResult,
} from "../../../src/analyzers/completion-reader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal PRD document factory. */
function makePRD(items: Record<string, unknown>[] = []) {
  return {
    schema: "rex/v1",
    title: "Test PRD",
    items,
  };
}

/** Minimal item factory with sensible defaults. */
function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "item-1",
    title: overrides.title ?? "Test item",
    status: overrides.status ?? "pending",
    level: overrides.level ?? "task",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("completion-reader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-cr-"));
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  // ── extractItemCompletion ──────────────────────────────────────

  describe("extractItemCompletion", () => {
    it("extracts completion state for a completed item with timestamps", () => {
      const item = makeItem({
        id: "task-1",
        title: "Auth task",
        status: "completed",
        level: "task",
        startedAt: "2026-02-24T08:00:00.000Z",
        completedAt: "2026-02-24T10:00:00.000Z",
        priority: "high",
        tags: ["backend"],
      });

      const state = extractItemCompletion(item);

      expect(state.id).toBe("task-1");
      expect(state.title).toBe("Auth task");
      expect(state.status).toBe("completed");
      expect(state.level).toBe("task");
      expect(state.startedAt).toBe("2026-02-24T08:00:00.000Z");
      expect(state.completedAt).toBe("2026-02-24T10:00:00.000Z");
      expect(state.durationMs).toBe(2 * 60 * 60 * 1000); // 2 hours
      expect(state.priority).toBe("high");
      expect(state.tags).toEqual(["backend"]);
    });

    it("returns null durationMs when startedAt is missing", () => {
      const item = makeItem({
        status: "completed",
        completedAt: "2026-02-24T10:00:00.000Z",
      });

      const state = extractItemCompletion(item);

      expect(state.completedAt).toBe("2026-02-24T10:00:00.000Z");
      expect(state.durationMs).toBeNull();
    });

    it("returns null durationMs when completedAt is missing", () => {
      const item = makeItem({
        status: "in_progress",
        startedAt: "2026-02-24T08:00:00.000Z",
      });

      const state = extractItemCompletion(item);

      expect(state.startedAt).toBe("2026-02-24T08:00:00.000Z");
      expect(state.durationMs).toBeNull();
    });

    it("handles pending items with no timestamps", () => {
      const item = makeItem({ status: "pending" });

      const state = extractItemCompletion(item);

      expect(state.status).toBe("pending");
      expect(state.startedAt).toBeUndefined();
      expect(state.completedAt).toBeUndefined();
      expect(state.durationMs).toBeNull();
    });

    it("preserves parent chain when provided", () => {
      const item = makeItem({ status: "completed" });
      const parents = [
        { id: "epic-1", title: "Epic One", level: "epic" },
        { id: "feat-1", title: "Feature One", level: "feature" },
      ];

      const state = extractItemCompletion(item, parents);

      expect(state.parentChain).toEqual(parents);
    });

    it("defaults to empty parent chain when not provided", () => {
      const item = makeItem({ status: "completed" });
      const state = extractItemCompletion(item);
      expect(state.parentChain).toEqual([]);
    });

    it("returns null durationMs for invalid timestamp strings", () => {
      const item = makeItem({
        status: "completed",
        startedAt: "not-a-date",
        completedAt: "also-not-a-date",
      });

      const state = extractItemCompletion(item);
      expect(state.durationMs).toBeNull();
    });
  });

  // ── computeCompletionStats ─────────────────────────────────────

  describe("computeCompletionStats", () => {
    it("computes stats for a mixed-status tree", () => {
      const items = [
        makeItem({
          id: "epic-1",
          level: "epic",
          status: "in_progress",
          children: [
            makeItem({
              id: "feat-1",
              level: "feature",
              status: "in_progress",
              children: [
                makeItem({ id: "t1", level: "task", status: "completed" }),
                makeItem({ id: "t2", level: "task", status: "completed" }),
                makeItem({ id: "t3", level: "task", status: "in_progress" }),
                makeItem({ id: "t4", level: "task", status: "pending" }),
              ],
            }),
          ],
        }),
      ];

      const stats = computeCompletionStats(items);

      // Only tasks and subtasks count (like rex)
      expect(stats.total).toBe(4);
      expect(stats.completed).toBe(2);
      expect(stats.inProgress).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.percentComplete).toBeCloseTo(50, 0);
    });

    it("computes per-level breakdown", () => {
      const items = [
        makeItem({
          id: "epic-1",
          level: "epic",
          status: "completed",
          children: [
            makeItem({
              id: "feat-1",
              level: "feature",
              status: "completed",
              children: [
                makeItem({ id: "t1", level: "task", status: "completed" }),
                makeItem({
                  id: "t2",
                  level: "task",
                  status: "completed",
                  children: [
                    makeItem({ id: "st1", level: "subtask", status: "completed" }),
                    makeItem({ id: "st2", level: "subtask", status: "pending" }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ];

      const stats = computeCompletionStats(items);

      expect(stats.byLevel.epic).toEqual({ total: 1, completed: 1 });
      expect(stats.byLevel.feature).toEqual({ total: 1, completed: 1 });
      expect(stats.byLevel.task).toEqual({ total: 2, completed: 2 });
      expect(stats.byLevel.subtask).toEqual({ total: 2, completed: 1 });
    });

    it("returns zero stats for empty item list", () => {
      const stats = computeCompletionStats([]);

      expect(stats.total).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.percentComplete).toBe(0);
    });

    it("excludes deleted items from totals", () => {
      const items = [
        makeItem({ id: "t1", level: "task", status: "completed" }),
        makeItem({ id: "t2", level: "task", status: "deleted" }),
        makeItem({ id: "t3", level: "task", status: "pending" }),
      ];

      const stats = computeCompletionStats(items);

      // total should exclude deleted
      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(1);
      expect(stats.deleted).toBe(1);
    });

    it("handles deferred and blocked statuses", () => {
      const items = [
        makeItem({ id: "t1", level: "task", status: "deferred" }),
        makeItem({ id: "t2", level: "task", status: "blocked" }),
        makeItem({ id: "t3", level: "task", status: "failing" }),
      ];

      const stats = computeCompletionStats(items);

      expect(stats.deferred).toBe(1);
      expect(stats.blocked).toBe(1);
      expect(stats.failing).toBe(1);
      expect(stats.total).toBe(3);
    });
  });

  // ── detectInconsistencies ──────────────────────────────────────

  describe("detectInconsistencies", () => {
    it("detects completed item without completedAt", () => {
      const items = [
        makeItem({ id: "t1", level: "task", status: "completed" }),
      ];

      const issues = detectInconsistencies(items);

      expect(issues).toHaveLength(1);
      expect(issues[0].itemId).toBe("t1");
      expect(issues[0].type).toBe("missing_completed_at");
    });

    it("detects non-completed item with stale completedAt", () => {
      const items = [
        makeItem({
          id: "t1",
          level: "task",
          status: "in_progress",
          completedAt: "2026-02-24T10:00:00.000Z",
        }),
      ];

      const issues = detectInconsistencies(items);

      expect(issues).toHaveLength(1);
      expect(issues[0].itemId).toBe("t1");
      expect(issues[0].type).toBe("stale_completed_at");
    });

    it("detects completedAt before startedAt", () => {
      const items = [
        makeItem({
          id: "t1",
          level: "task",
          status: "completed",
          startedAt: "2026-02-25T10:00:00.000Z",
          completedAt: "2026-02-24T10:00:00.000Z",
        }),
      ];

      const issues = detectInconsistencies(items);

      expect(issues.some(i => i.type === "completed_before_started")).toBe(true);
    });

    it("returns empty array for consistent data", () => {
      const items = [
        makeItem({
          id: "t1",
          level: "task",
          status: "completed",
          startedAt: "2026-02-24T08:00:00.000Z",
          completedAt: "2026-02-24T10:00:00.000Z",
        }),
        makeItem({
          id: "t2",
          level: "task",
          status: "pending",
        }),
      ];

      const issues = detectInconsistencies(items);

      expect(issues).toHaveLength(0);
    });

    it("walks nested children for inconsistencies", () => {
      const items = [
        makeItem({
          id: "epic-1",
          level: "epic",
          status: "pending",
          children: [
            makeItem({
              id: "feat-1",
              level: "feature",
              status: "pending",
              children: [
                makeItem({ id: "t1", level: "task", status: "completed" }), // missing completedAt
              ],
            }),
          ],
        }),
      ];

      const issues = detectInconsistencies(items);

      expect(issues).toHaveLength(1);
      expect(issues[0].itemId).toBe("t1");
    });

    it("handles empty item list", () => {
      expect(detectInconsistencies([])).toEqual([]);
    });
  });

  // ── computeCompletionTimeline ──────────────────────────────────

  describe("computeCompletionTimeline", () => {
    it("returns completed items sorted by completedAt ascending", () => {
      const items = [
        makeItem({
          id: "t1",
          level: "task",
          status: "completed",
          completedAt: "2026-02-24T12:00:00.000Z",
        }),
        makeItem({
          id: "t2",
          level: "task",
          status: "completed",
          completedAt: "2026-02-24T08:00:00.000Z",
        }),
        makeItem({
          id: "t3",
          level: "task",
          status: "completed",
          completedAt: "2026-02-24T10:00:00.000Z",
        }),
      ];

      const timeline = computeCompletionTimeline(items);

      expect(timeline.entries).toHaveLength(3);
      expect(timeline.entries[0].id).toBe("t2"); // earliest
      expect(timeline.entries[1].id).toBe("t3");
      expect(timeline.entries[2].id).toBe("t1"); // latest
    });

    it("excludes non-completed items", () => {
      const items = [
        makeItem({ id: "t1", level: "task", status: "completed", completedAt: "2026-02-24T10:00:00.000Z" }),
        makeItem({ id: "t2", level: "task", status: "pending" }),
        makeItem({ id: "t3", level: "task", status: "in_progress" }),
      ];

      const timeline = computeCompletionTimeline(items);

      expect(timeline.entries).toHaveLength(1);
      expect(timeline.entries[0].id).toBe("t1");
    });

    it("includes items without completedAt at the end", () => {
      const items = [
        makeItem({
          id: "t1",
          level: "task",
          status: "completed",
          completedAt: "2026-02-24T10:00:00.000Z",
        }),
        makeItem({
          id: "t2",
          level: "task",
          status: "completed",
          // no completedAt
        }),
      ];

      const timeline = computeCompletionTimeline(items);

      expect(timeline.entries).toHaveLength(2);
      // item with completedAt comes first
      expect(timeline.entries[0].id).toBe("t1");
      // item without completedAt sorted to end
      expect(timeline.entries[1].id).toBe("t2");
    });

    it("walks nested children", () => {
      const items = [
        makeItem({
          id: "epic-1",
          level: "epic",
          status: "completed",
          completedAt: "2026-02-24T14:00:00.000Z",
          children: [
            makeItem({
              id: "t1",
              level: "task",
              status: "completed",
              completedAt: "2026-02-24T10:00:00.000Z",
            }),
          ],
        }),
      ];

      const timeline = computeCompletionTimeline(items);

      expect(timeline.entries).toHaveLength(2);
      expect(timeline.entries[0].id).toBe("t1"); // earlier completion
      expect(timeline.entries[1].id).toBe("epic-1");
    });

    it("provides earliest and latest timestamps", () => {
      const items = [
        makeItem({
          id: "t1",
          level: "task",
          status: "completed",
          completedAt: "2026-02-24T08:00:00.000Z",
        }),
        makeItem({
          id: "t2",
          level: "task",
          status: "completed",
          completedAt: "2026-02-24T16:00:00.000Z",
        }),
      ];

      const timeline = computeCompletionTimeline(items);

      expect(timeline.earliest).toBe("2026-02-24T08:00:00.000Z");
      expect(timeline.latest).toBe("2026-02-24T16:00:00.000Z");
    });

    it("returns empty timeline for no completed items", () => {
      const items = [
        makeItem({ id: "t1", level: "task", status: "pending" }),
      ];

      const timeline = computeCompletionTimeline(items);

      expect(timeline.entries).toEqual([]);
      expect(timeline.earliest).toBeUndefined();
      expect(timeline.latest).toBeUndefined();
    });
  });

  // ── readCompletionStatus (integration) ─────────────────────────

  describe("readCompletionStatus", () => {
    it("reads completion status from a valid PRD file", async () => {
      const prd = makePRD([
        makeItem({
          id: "epic-1",
          level: "epic",
          status: "in_progress",
          children: [
            makeItem({
              id: "feat-1",
              level: "feature",
              status: "in_progress",
              children: [
                makeItem({
                  id: "t1",
                  level: "task",
                  status: "completed",
                  startedAt: "2026-02-24T08:00:00.000Z",
                  completedAt: "2026-02-24T10:00:00.000Z",
                }),
                makeItem({
                  id: "t2",
                  level: "task",
                  status: "pending",
                }),
              ],
            }),
          ],
        }),
      ]);

      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd, null, 2));

      const result = await readCompletionStatus({ dir: tmpDir });

      expect(result.items).toHaveLength(4); // all items in tree
      expect(result.stats.total).toBe(2); // only tasks count
      expect(result.stats.completed).toBe(1);
      expect(result.timeline.entries).toHaveLength(1); // 1 completed item
      expect(result.inconsistencies).toEqual([]);
      expect(result.readAt).toBeTruthy();
    });

    it("returns empty result when .rex/prd.json does not exist", async () => {
      const result = await readCompletionStatus({ dir: tmpDir });

      expect(result.items).toEqual([]);
      expect(result.stats.total).toBe(0);
      expect(result.timeline.entries).toEqual([]);
    });

    it("handles corrupted PRD gracefully", async () => {
      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      await writeFile(join(rexDir, "prd.json"), "{{{malformed json");

      const result = await readCompletionStatus({ dir: tmpDir });

      expect(result.items).toEqual([]);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("detects inconsistencies in the PRD", async () => {
      const prd = makePRD([
        makeItem({
          id: "t1",
          level: "task",
          status: "completed",
          // missing completedAt — inconsistency
        }),
      ]);

      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd, null, 2));

      const result = await readCompletionStatus({ dir: tmpDir });

      expect(result.inconsistencies).toHaveLength(1);
      expect(result.inconsistencies[0].type).toBe("missing_completed_at");
    });

    it("filters items by IDs when itemIds option is provided", async () => {
      const prd = makePRD([
        makeItem({
          id: "t1",
          level: "task",
          status: "completed",
          completedAt: "2026-02-24T10:00:00.000Z",
        }),
        makeItem({
          id: "t2",
          level: "task",
          status: "completed",
          completedAt: "2026-02-24T11:00:00.000Z",
        }),
        makeItem({
          id: "t3",
          level: "task",
          status: "pending",
        }),
      ]);

      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd, null, 2));

      const result = await readCompletionStatus({
        dir: tmpDir,
        itemIds: new Set(["t1", "t3"]),
      });

      expect(result.items).toHaveLength(2);
      const ids = result.items.map((i) => i.id);
      expect(ids).toContain("t1");
      expect(ids).toContain("t3");
      expect(ids).not.toContain("t2");
    });

    it("preserves PRD document title in result", async () => {
      const prd = {
        schema: "rex/v1",
        title: "My Project PRD",
        items: [makeItem({ id: "t1", level: "task", status: "pending" })],
      };

      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd, null, 2));

      const result = await readCompletionStatus({ dir: tmpDir });

      expect(result.prdTitle).toBe("My Project PRD");
    });

    it("handles empty PRD items array", async () => {
      const prd = makePRD([]);

      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd, null, 2));

      const result = await readCompletionStatus({ dir: tmpDir });

      expect(result.items).toEqual([]);
      expect(result.stats.total).toBe(0);
      expect(result.stats.percentComplete).toBe(0);
    });

    it("handles PRD with only non-task levels", async () => {
      const prd = makePRD([
        makeItem({ id: "e1", level: "epic", status: "pending" }),
        makeItem({ id: "f1", level: "feature", status: "pending" }),
      ]);

      const rexDir = join(tmpDir, ".rex");
      await mkdir(rexDir, { recursive: true });
      await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd, null, 2));

      const result = await readCompletionStatus({ dir: tmpDir });

      // Items are returned for all levels
      expect(result.items).toHaveLength(2);
      // But stats.total only counts tasks/subtasks
      expect(result.stats.total).toBe(0);
      // byLevel still tracks non-work levels
      expect(result.stats.byLevel.epic).toEqual({ total: 1, completed: 0 });
    });
  });
});
