/**
 * Tests for IncrementalTaskUsageAggregator.
 *
 * Covers:
 * - Initial full aggregation of all run files
 * - Incremental updates for added/modified/deleted files
 * - Accuracy of totals after incremental updates
 * - Edge cases: missing directory, empty runs, malformed files
 * - Stale entry pruning for deleted PRD tasks
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, unlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IncrementalTaskUsageAggregator } from "../../../src/server/task-usage/incremental-task-usage.js";

describe("IncrementalTaskUsageAggregator", () => {
  let tmpDir: string;
  let runsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "incr-task-usage-"));
    runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Write a run file with the given task ID and token usage. */
  async function writeRun(
    filename: string,
    taskId: string,
    tokens: { input?: number; output?: number; cacheCreationInput?: number; cacheReadInput?: number } = {},
  ): Promise<void> {
    await writeFile(
      join(runsDir, filename),
      JSON.stringify({
        id: filename.replace(/\.json$/, ""),
        taskId,
        startedAt: new Date().toISOString(),
        status: "completed",
        tokenUsage: {
          input: tokens.input ?? 0,
          output: tokens.output ?? 0,
          ...(tokens.cacheCreationInput !== undefined ? { cacheCreationInput: tokens.cacheCreationInput } : {}),
          ...(tokens.cacheReadInput !== undefined ? { cacheReadInput: tokens.cacheReadInput } : {}),
        },
      }),
      "utf-8",
    );
  }

  // ---------------------------------------------------------------------------
  // Initial full aggregation
  // ---------------------------------------------------------------------------

  describe("initial aggregation", () => {
    it("processes all existing run files on first call", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-b", { input: 200, output: 100 });
      await writeRun("run-3.json", "task-a", { input: 50, output: 25 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const usage = await aggregator.getTaskUsage();

      expect(usage["task-a"]).toEqual({ totalTokens: 225, runCount: 2 });
      expect(usage["task-b"]).toEqual({ totalTokens: 300, runCount: 1 });
    });

    it("returns empty object when no run files exist", async () => {
      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const usage = await aggregator.getTaskUsage();
      expect(usage).toEqual({});
    });

    it("handles missing runs directory gracefully", async () => {
      const missingDir = join(tmpDir, "missing", "runs");
      const aggregator = new IncrementalTaskUsageAggregator(missingDir);
      const usage = await aggregator.getTaskUsage();
      expect(usage).toEqual({});
    });

    it("includes cache tokens in total", async () => {
      await writeRun("run-1.json", "task-a", {
        input: 100,
        output: 50,
        cacheCreationInput: 30,
        cacheReadInput: 20,
      });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const usage = await aggregator.getTaskUsage();

      expect(usage["task-a"]).toEqual({ totalTokens: 200, runCount: 1 });
    });

    it("skips files without a taskId", async () => {
      await writeFile(
        join(runsDir, "orphan.json"),
        JSON.stringify({ id: "orphan", status: "completed", tokenUsage: { input: 100, output: 50 } }),
        "utf-8",
      );

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const usage = await aggregator.getTaskUsage();
      expect(usage).toEqual({});
    });

    it("skips malformed JSON files", async () => {
      await writeRun("good.json", "task-a", { input: 100, output: 50 });
      await writeFile(join(runsDir, "bad.json"), "not json {{{", "utf-8");

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const usage = await aggregator.getTaskUsage();

      expect(usage["task-a"]).toEqual({ totalTokens: 150, runCount: 1 });
      expect(Object.keys(usage)).toHaveLength(1);
    });

    it("ignores hidden files (dot-prefixed)", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeFile(
        join(runsDir, ".aggregation-checkpoint.json"),
        JSON.stringify({ timestamp: "now", files: {} }),
        "utf-8",
      );

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const usage = await aggregator.getTaskUsage();

      expect(Object.keys(usage)).toHaveLength(1);
      expect(usage["task-a"]).toEqual({ totalTokens: 150, runCount: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // Incremental updates — added files
  // ---------------------------------------------------------------------------

  describe("incremental: added files", () => {
    it("picks up newly added run files without re-processing existing ones", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      // Initial aggregation
      const first = await aggregator.getTaskUsage();
      expect(first["task-a"]).toEqual({ totalTokens: 150, runCount: 1 });

      // Add a new file
      await writeRun("run-2.json", "task-a", { input: 200, output: 100 });

      // Incremental update
      const second = await aggregator.getTaskUsage();
      expect(second["task-a"]).toEqual({ totalTokens: 450, runCount: 2 });
    });

    it("handles new files for new tasks", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      await aggregator.getTaskUsage();

      // Add file for a different task
      await writeRun("run-2.json", "task-b", { input: 300, output: 200 });

      const usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toEqual({ totalTokens: 150, runCount: 1 });
      expect(usage["task-b"]).toEqual({ totalTokens: 500, runCount: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // Incremental updates — modified files
  // ---------------------------------------------------------------------------

  describe("incremental: modified files", () => {
    it("re-reads modified files and updates totals correctly", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const first = await aggregator.getTaskUsage();
      expect(first["task-a"]).toEqual({ totalTokens: 150, runCount: 1 });

      // Modify the file with different token counts (changes size → detected)
      await writeRun("run-1.json", "task-a", { input: 500, output: 250 });

      const second = await aggregator.getTaskUsage();
      expect(second["task-a"]).toEqual({ totalTokens: 750, runCount: 1 });
    });

    it("handles task ID change in a modified file", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      await aggregator.getTaskUsage();

      // Re-write the same file but with a different taskId
      await writeRun("run-1.json", "task-b", { input: 100, output: 50 });

      const usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toBeUndefined();
      expect(usage["task-b"]).toEqual({ totalTokens: 150, runCount: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // Incremental updates — deleted files
  // ---------------------------------------------------------------------------

  describe("incremental: deleted files", () => {
    it("subtracts contributions from deleted files", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-a", { input: 200, output: 100 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const first = await aggregator.getTaskUsage();
      expect(first["task-a"]).toEqual({ totalTokens: 450, runCount: 2 });

      // Delete one run
      await unlink(join(runsDir, "run-1.json"));

      const second = await aggregator.getTaskUsage();
      expect(second["task-a"]).toEqual({ totalTokens: 300, runCount: 1 });
    });

    it("removes task entry when all runs are deleted", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      await aggregator.getTaskUsage();

      await unlink(join(runsDir, "run-1.json"));

      const usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toBeUndefined();
      expect(Object.keys(usage)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Mixed operations
  // ---------------------------------------------------------------------------

  describe("mixed add/modify/delete", () => {
    it("handles concurrent add, modify, and delete correctly", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-b", { input: 200, output: 100 });
      await writeRun("run-3.json", "task-a", { input: 50, output: 25 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      await aggregator.getTaskUsage();

      // Delete run-1 (task-a, 150 tokens)
      await unlink(join(runsDir, "run-1.json"));
      // Modify run-2 (task-b, 300→500 tokens)
      await writeRun("run-2.json", "task-b", { input: 300, output: 200 });
      // Add run-4 (task-c, new task)
      await writeRun("run-4.json", "task-c", { input: 400, output: 200 });

      const usage = await aggregator.getTaskUsage();

      // task-a: only run-3 remains (75 tokens)
      expect(usage["task-a"]).toEqual({ totalTokens: 75, runCount: 1 });
      // task-b: run-2 updated (500 tokens)
      expect(usage["task-b"]).toEqual({ totalTokens: 500, runCount: 1 });
      // task-c: run-4 added (600 tokens)
      expect(usage["task-c"]).toEqual({ totalTokens: 600, runCount: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // No-change short-circuit
  // ---------------------------------------------------------------------------

  describe("no-change short-circuit", () => {
    it("returns cached results when no files have changed", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      const first = await aggregator.getTaskUsage();
      const second = await aggregator.getTaskUsage();

      // Results should be identical (served from cache)
      expect(second).toEqual(first);
    });
  });

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  describe("reset", () => {
    it("forces a full rebuild after reset", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const first = await aggregator.getTaskUsage();
      expect(first["task-a"]).toEqual({ totalTokens: 150, runCount: 1 });

      // Delete run-1 and add run-2, then reset so the aggregator
      // processes all files fresh
      await unlink(join(runsDir, "run-1.json"));
      await writeRun("run-2.json", "task-b", { input: 300, output: 200 });

      aggregator.reset();

      const usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toBeUndefined();
      expect(usage["task-b"]).toEqual({ totalTokens: 500, runCount: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // Stale entry pruning
  // ---------------------------------------------------------------------------

  describe("pruneStaleEntries", () => {
    it("removes entries for task IDs not in the valid set", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-b", { input: 200, output: 100 });
      await writeRun("run-3.json", "task-c", { input: 50, output: 25 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      await aggregator.getTaskUsage();

      // Only task-a is valid; task-b and task-c were "deleted" from PRD
      const pruned = aggregator.pruneStaleEntries(new Set(["task-a"]));
      expect(pruned).toBe(2);

      const usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toEqual({ totalTokens: 150, runCount: 1 });
      expect(usage["task-b"]).toBeUndefined();
      expect(usage["task-c"]).toBeUndefined();
      expect(Object.keys(usage)).toHaveLength(1);
    });

    it("returns 0 when all entries are valid", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-b", { input: 200, output: 100 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      await aggregator.getTaskUsage();

      const pruned = aggregator.pruneStaleEntries(new Set(["task-a", "task-b"]));
      expect(pruned).toBe(0);

      const usage = await aggregator.getTaskUsage();
      expect(Object.keys(usage)).toHaveLength(2);
    });

    it("handles empty valid set (prunes everything)", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-b", { input: 200, output: 100 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      await aggregator.getTaskUsage();

      const pruned = aggregator.pruneStaleEntries(new Set());
      expect(pruned).toBe(2);

      const usage = await aggregator.getTaskUsage();
      expect(Object.keys(usage)).toHaveLength(0);
    });

    it("pruned entries do not reappear on next refresh (files unchanged)", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "deleted-task", { input: 200, output: 100 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      await aggregator.getTaskUsage();

      aggregator.pruneStaleEntries(new Set(["task-a"]));

      // Subsequent call should NOT re-read the deleted-task's run file
      // because the file snapshot is preserved (no mtime/size change)
      const usage = await aggregator.getTaskUsage();
      expect(usage["deleted-task"]).toBeUndefined();
      expect(usage["task-a"]).toEqual({ totalTokens: 150, runCount: 1 });
    });

    it("works correctly with multiple runs per pruned task", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-b", { input: 200, output: 100 });
      await writeRun("run-3.json", "task-b", { input: 300, output: 150 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      await aggregator.getTaskUsage();

      // Prune task-b which has 2 run files
      const pruned = aggregator.pruneStaleEntries(new Set(["task-a"]));
      expect(pruned).toBe(1); // 1 task ID pruned (even though 2 files)

      const usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toEqual({ totalTokens: 150, runCount: 1 });
      expect(usage["task-b"]).toBeUndefined();
    });

    it("prune then add new run for a valid task works correctly", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "deleted-task", { input: 200, output: 100 });

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      await aggregator.getTaskUsage();

      aggregator.pruneStaleEntries(new Set(["task-a"]));

      // Add a new run for the valid task
      await writeRun("run-3.json", "task-a", { input: 50, output: 25 });

      const usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toEqual({ totalTokens: 225, runCount: 2 });
      expect(usage["deleted-task"]).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Totals accuracy — regression guard
  // ---------------------------------------------------------------------------

  describe("totals accuracy", () => {
    it("maintains accurate totals through a sequence of incremental updates", async () => {
      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      // Step 1: initial batch
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-a", { input: 200, output: 100 });
      await writeRun("run-3.json", "task-b", { input: 300, output: 150 });

      let usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toEqual({ totalTokens: 450, runCount: 2 });
      expect(usage["task-b"]).toEqual({ totalTokens: 450, runCount: 1 });

      // Step 2: add a run
      await writeRun("run-4.json", "task-a", { input: 50, output: 25 });
      usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toEqual({ totalTokens: 525, runCount: 3 });

      // Step 3: delete a run
      await unlink(join(runsDir, "run-2.json"));
      usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toEqual({ totalTokens: 225, runCount: 2 });

      // Step 4: modify a run
      await writeRun("run-1.json", "task-a", { input: 1000, output: 500 });
      usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toEqual({ totalTokens: 1575, runCount: 2 });

      // Step 5: no changes
      const cached = await aggregator.getTaskUsage();
      expect(cached).toEqual(usage);
    });
  });
});
