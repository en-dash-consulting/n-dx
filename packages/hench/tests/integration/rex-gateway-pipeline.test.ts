/**
 * Integration test for the hench → rex-gateway pipeline.
 *
 * Exercises the in-process data flow through the rex-gateway module:
 * resolveStore → findNextTask → status updates → auto-completion.
 *
 * Unlike the unit-level contract test (rex-gateway.test.ts) which only
 * validates that exports exist, this test exercises real composed behavior
 * with a live PRDStore instance.
 *
 * @see packages/hench/src/prd/rex-gateway.ts
 * @see TESTING.md — gateway admission criterion
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveStore,
  findNextTask,
  findActionableTasks,
  collectCompletedIds,
  computeTimestampUpdates,
  findAutoCompletions,
  walkTree,
  findItem,
  isWorkItem,
  isRootLevel,
  SCHEMA_VERSION,
  isCompatibleSchema,
  assertSchemaVersion,
} from "../../src/prd/rex-gateway.js";

describe("hench → rex-gateway integration pipeline", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-gw-test-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Write a PRD document to disk. */
  async function writePRD(items: unknown[]) {
    const doc = {
      schema: SCHEMA_VERSION,
      title: "Gateway Test",
      items,
    };
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(doc), "utf-8");
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
      "utf-8",
    );
  }

  describe("store → task selection pipeline", () => {
    it("resolveStore loads a document, findNextTask selects from it", async () => {
      await writePRD([
        {
          id: "epic-1",
          title: "Test Epic",
          level: "epic",
          status: "pending",
          priority: "high",
          children: [
            {
              id: "feat-1",
              title: "Test Feature",
              level: "feature",
              status: "pending",
              priority: "high",
              children: [
                {
                  id: "task-1",
                  title: "First Task",
                  level: "task",
                  status: "pending",
                  priority: "high",
                  children: [],
                },
              ],
            },
          ],
        },
      ]);

      const store = await resolveStore(rexDir);
      const doc = await store.loadDocument();
      expect(doc.items.length).toBe(1);

      const next = findNextTask(doc.items);
      expect(next).not.toBeNull();
      expect(next!.item.id).toBe("task-1");
      expect(next!.parents.length).toBe(2); // epic + feature
    });

    it("status update timestamps flow through computeTimestampUpdates", async () => {
      const timestamps = computeTimestampUpdates("pending", "in_progress");
      expect(timestamps.startedAt).toBeDefined();
      expect(timestamps.completedAt).toBeUndefined();

      const completeTimestamps = computeTimestampUpdates("in_progress", "completed");
      expect(completeTimestamps.completedAt).toBeDefined();
    });

    it("findAutoCompletions detects parent completion after all children done", async () => {
      const items = [
        {
          id: "feat-1",
          title: "Feature",
          level: "feature",
          status: "pending",
          priority: "high",
          children: [
            { id: "task-1", title: "Done", level: "task", status: "completed", children: [] },
            { id: "task-2", title: "Also Done", level: "task", status: "completed", children: [] },
          ],
        },
      ];

      const completions = findAutoCompletions(items, "task-2");
      expect(completions).toBeDefined();
      // If all children are completed, the parent should be auto-completable
      expect(completions.completedIds).toContain("feat-1");
    });
  });

  describe("tree traversal through gateway", () => {
    it("walkTree yields items in depth-first order", () => {
      const items = [
        {
          id: "a",
          children: [
            { id: "b", children: [{ id: "c", children: [] }] },
            { id: "d", children: [] },
          ],
        },
      ];

      const visited: Array<{ id: string; depth: number }> = [];
      for (const entry of walkTree(items)) {
        visited.push({ id: entry.item.id, depth: entry.parents.length });
      }

      expect(visited).toEqual([
        { id: "a", depth: 0 },
        { id: "b", depth: 1 },
        { id: "c", depth: 2 },
        { id: "d", depth: 1 },
      ]);
    });

    it("findItem returns correct parent chain", () => {
      const items = [
        {
          id: "epic-1",
          children: [
            {
              id: "feat-1",
              children: [{ id: "task-1", children: [] }],
            },
          ],
        },
      ];

      const entry = findItem(items, "task-1");
      expect(entry).not.toBeNull();
      expect(entry!.item.id).toBe("task-1");
      expect(entry!.parents.map((p: { id: string }) => p.id)).toEqual(["epic-1", "feat-1"]);
    });

    it("collectCompletedIds skips non-completed items", () => {
      const items = [
        {
          id: "epic-1",
          status: "pending",
          children: [
            { id: "task-done", status: "completed", children: [] },
            { id: "task-pending", status: "pending", children: [] },
            { id: "task-deferred", status: "deferred", children: [] },
          ],
        },
      ];

      const completed = collectCompletedIds(items);
      expect(completed.has("task-done")).toBe(true);
      expect(completed.has("task-pending")).toBe(false);
      expect(completed.has("task-deferred")).toBe(false);
      expect(completed.has("epic-1")).toBe(false);
    });
  });

  describe("schema version through gateway", () => {
    it("SCHEMA_VERSION is a valid version string", () => {
      expect(SCHEMA_VERSION).toBe("rex/v1");
    });

    it("isCompatibleSchema validates current version", () => {
      expect(isCompatibleSchema("rex/v1")).toBe(true);
      expect(isCompatibleSchema("rex/v999")).toBe(false);
    });

    it("assertSchemaVersion throws on incompatible versions", () => {
      expect(() => assertSchemaVersion({ schema: "rex/v1" })).not.toThrow();
      expect(() => assertSchemaVersion({ schema: "incompatible/v1" })).toThrow();
    });
  });

  describe("level helpers through gateway", () => {
    it("isWorkItem correctly classifies levels", () => {
      expect(isWorkItem("task")).toBe(true);
      expect(isWorkItem("subtask")).toBe(true);
      expect(isWorkItem("epic")).toBe(false);
      expect(isWorkItem("feature")).toBe(false);
    });

    it("isRootLevel identifies top-level containers", () => {
      expect(isRootLevel("epic")).toBe(true);
      expect(isRootLevel("feature")).toBe(false);
      expect(isRootLevel("task")).toBe(false);
    });
  });

  describe("multi-task selection", () => {
    it("findActionableTasks returns multiple tasks sorted by priority", async () => {
      await writePRD([
        {
          id: "epic-1",
          title: "Epic",
          level: "epic",
          status: "pending",
          priority: "high",
          children: [
            {
              id: "task-low",
              title: "Low Priority",
              level: "task",
              status: "pending",
              priority: "low",
              children: [],
            },
            {
              id: "task-critical",
              title: "Critical Priority",
              level: "task",
              status: "pending",
              priority: "critical",
              children: [],
            },
            {
              id: "task-done",
              title: "Already Done",
              level: "task",
              status: "completed",
              priority: "high",
              children: [],
            },
          ],
        },
      ]);

      const store = await resolveStore(rexDir);
      const doc = await store.loadDocument();

      const completed = collectCompletedIds(doc.items);
      const actionable = findActionableTasks(doc.items, completed);
      expect(actionable.length).toBe(2); // task-low and task-critical, not task-done
      // Critical should come first
      expect(actionable[0].item.id).toBe("task-critical");
      expect(actionable[1].item.id).toBe("task-low");
    });
  });
});
