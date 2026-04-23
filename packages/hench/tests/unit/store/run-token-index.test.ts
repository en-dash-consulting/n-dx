import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  listCompletedRunTokens,
  runTokenTupleFromRecord,
} from "../../../src/store/run-token-index.js";
import { saveRun, loadRun } from "../../../src/store/runs.js";
import { normalizeRunTokens } from "../../../src/schema/index.js";
import type { RunRecord, RunStatus } from "../../../src/schema/index.js";

/**
 * Build a minimal RunRecord with sensible defaults. Callers override the
 * fields relevant to the scenario under test.
 */
function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-id",
    taskId: "item-id",
    taskTitle: "Test run",
    startedAt: "2026-04-23T00:00:00.000Z",
    status: "completed",
    turns: 1,
    tokenUsage: {
      input: 100,
      output: 50,
      cacheCreationInput: 10,
      cacheReadInput: 20,
    },
    toolCalls: [],
    model: "sonnet",
    ...overrides,
  };
}

describe("run-token-index", () => {
  let tmpBase: string;
  let henchDir: string;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), "hench-run-token-index-"));
    henchDir = join(tmpBase, ".hench");
    await mkdir(join(henchDir, "runs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  describe("saveRun normalization (acceptance criterion 1)", () => {
    it("stamps a normalized `tokens` tuple on every write", async () => {
      const run = makeRun({ id: "r1", taskId: "task-abc" });
      await saveRun(henchDir, run);

      // In-memory record is mutated so concurrent readers see the same value.
      expect(run.tokens).toEqual({ input: 100, output: 50, cached: 30, total: 180 });

      const loaded = await loadRun(henchDir, "r1");
      expect(loaded.tokens).toEqual({ input: 100, output: 50, cached: 30, total: 180 });
    });
  });

  describe("listCompletedRunTokens — run with a task ID", () => {
    it("returns { itemId, tokens } for a completed task run", async () => {
      await saveRun(
        henchDir,
        makeRun({
          id: "r-task",
          taskId: "task-1",
          status: "completed",
          finishedAt: "2026-04-23T00:01:00.000Z",
        }),
      );

      const tuples = await listCompletedRunTokens(henchDir);

      expect(tuples).toHaveLength(1);
      expect(tuples[0]).toEqual({
        runId: "r-task",
        itemId: "task-1",
        tokens: { input: 100, output: 50, cached: 30, total: 180 },
        status: "completed",
        finishedAt: "2026-04-23T00:01:00.000Z",
      });
    });
  });

  describe("listCompletedRunTokens — run with a subtask ID", () => {
    it("returns the tuple unchanged regardless of PRD level (the item ID is opaque)", async () => {
      await saveRun(
        henchDir,
        makeRun({
          id: "r-subtask",
          taskId: "subtask-xyz",
          status: "completed",
          tokenUsage: { input: 40, output: 10 }, // no cache fields
        }),
      );

      const tuples = await listCompletedRunTokens(henchDir);

      expect(tuples).toHaveLength(1);
      expect(tuples[0].itemId).toBe("subtask-xyz");
      expect(tuples[0].tokens).toEqual({ input: 40, output: 10, cached: 0, total: 50 });
    });
  });

  describe("listCompletedRunTokens — run aborted mid-loop (acceptance criterion 3)", () => {
    it("still records whatever usage was consumed before the abort", async () => {
      // Simulate an agent that ran two turns, consumed tokens, then was cancelled.
      await saveRun(
        henchDir,
        makeRun({
          id: "r-aborted",
          taskId: "task-aborted",
          status: "cancelled",
          turns: 2,
          tokenUsage: {
            input: 500,
            output: 200,
            cacheCreationInput: 50,
            cacheReadInput: 150,
          },
          error: "Run interrupted by user",
          finishedAt: "2026-04-23T00:05:00.000Z",
        }),
      );

      const tuples = await listCompletedRunTokens(henchDir);

      expect(tuples).toHaveLength(1);
      expect(tuples[0]).toEqual({
        runId: "r-aborted",
        itemId: "task-aborted",
        tokens: { input: 500, output: 200, cached: 200, total: 900 },
        status: "cancelled",
        finishedAt: "2026-04-23T00:05:00.000Z",
      });
    });

    it("also includes failed runs so rollups are not silently undercounted", async () => {
      await saveRun(
        henchDir,
        makeRun({
          id: "r-failed",
          taskId: "task-failed",
          status: "failed",
          tokenUsage: { input: 30, output: 5 },
        }),
      );

      const tuples = await listCompletedRunTokens(henchDir);
      expect(tuples).toHaveLength(1);
      expect(tuples[0].status).toBe("failed");
      expect(tuples[0].tokens.total).toBe(35);
    });

    it("excludes runs still in the `running` state (provisional totals)", async () => {
      await saveRun(henchDir, makeRun({ id: "r-running", status: "running" }));
      await saveRun(henchDir, makeRun({ id: "r-done", status: "completed" }));

      const tuples = await listCompletedRunTokens(henchDir);
      const ids = tuples.map((t) => t.runId);
      expect(ids).toContain("r-done");
      expect(ids).not.toContain("r-running");
    });
  });

  describe("listCompletedRunTokens — run with zero usage (acceptance criterion 4)", () => {
    it("returns a zeroed tuple without tripping over missing cache fields", async () => {
      await saveRun(
        henchDir,
        makeRun({
          id: "r-zero",
          taskId: "task-zero",
          status: "failed",
          tokenUsage: { input: 0, output: 0 },
        }),
      );

      const tuples = await listCompletedRunTokens(henchDir);
      expect(tuples).toHaveLength(1);
      expect(tuples[0].tokens).toEqual({ input: 0, output: 0, cached: 0, total: 0 });
    });
  });

  describe("runTokenTupleFromRecord backward compatibility", () => {
    it("computes `tokens` from `tokenUsage` when the record predates auto-stamping", async () => {
      const legacy: RunRecord = makeRun({
        id: "legacy",
        taskId: "legacy-task",
        tokenUsage: { input: 7, output: 3, cacheReadInput: 5 },
      });
      // Simulate a legacy record that was never run through the new saveRun.
      delete (legacy as { tokens?: unknown }).tokens;

      const tuple = runTokenTupleFromRecord(legacy);
      expect(tuple.tokens).toEqual({ input: 7, output: 3, cached: 5, total: 15 });
    });
  });

  describe("normalizeRunTokens", () => {
    it("accepts undefined usage and returns all zeros", () => {
      expect(normalizeRunTokens(undefined)).toEqual({
        input: 0,
        output: 0,
        cached: 0,
        total: 0,
      });
    });

    it("sums cacheCreationInput and cacheReadInput into a single `cached` figure", () => {
      expect(
        normalizeRunTokens({
          input: 1,
          output: 2,
          cacheCreationInput: 3,
          cacheReadInput: 4,
        }),
      ).toEqual({ input: 1, output: 2, cached: 7, total: 10 });
    });
  });

  describe("listCompletedRunTokens — sorting + multi-run behavior", () => {
    it("returns tuples for every terminal-state run, exactly one per file", async () => {
      const statuses: Array<{ id: string; status: RunStatus; taskId: string }> = [
        { id: "r-a", status: "completed", taskId: "t-1" },
        { id: "r-b", status: "failed", taskId: "t-2" },
        { id: "r-c", status: "timeout", taskId: "t-3" },
        { id: "r-d", status: "cancelled", taskId: "t-4" },
        { id: "r-e", status: "budget_exceeded", taskId: "t-5" },
        { id: "r-f", status: "error_transient", taskId: "t-6" },
        { id: "r-g", status: "running", taskId: "t-7" }, // excluded
      ];
      for (const { id, status, taskId } of statuses) {
        await saveRun(henchDir, makeRun({ id, status, taskId }));
      }

      const tuples = await listCompletedRunTokens(henchDir);
      expect(tuples.map((t) => t.runId).sort()).toEqual([
        "r-a",
        "r-b",
        "r-c",
        "r-d",
        "r-e",
        "r-f",
      ]);
      expect(tuples.find((t) => t.runId === "r-g")).toBeUndefined();
    });
  });
});
