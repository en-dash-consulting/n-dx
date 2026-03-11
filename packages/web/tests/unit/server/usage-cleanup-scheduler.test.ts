/**
 * Tests for the periodic usage cleanup scheduler.
 *
 * Covers:
 * - Pure identification of orphaned entries
 * - Cleanup cycle execution with aggregator + PRD cross-referencing
 * - Audit log writing (JSONL format)
 * - Configuration loading from .n-dx.json
 * - Scheduler start/stop lifecycle
 * - Graceful degradation when PRD is unavailable
 * - Critical data preservation (run files untouched)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  identifyOrphanedEntries,
  writeCleanupLog,
  loadCleanupConfig,
  runCleanupCycle,
  startUsageCleanupScheduler,
  DEFAULT_CLEANUP_INTERVAL_MS,
  type OrphanedEntry,
  type CleanupResult,
  type CollectAllIdsFn,
  type LoadPRDFn,
} from "../../../src/server/usage-cleanup-scheduler.js";
import { IncrementalTaskUsageAggregator } from "../../../src/server/incremental-task-usage.js";

/**
 * Test-local implementation of collectAllIds.
 *
 * Extracts IDs from a flat array of PRD items (with optional nested children).
 * This avoids importing from rex-gateway in a unit test, which would create a
 * bidirectional coupling between the task-usage-tracking and web-dashboard zones.
 */
function collectAllIds(items: unknown[]): Set<string> {
  const ids = new Set<string>();
  const queue = [...items];
  while (queue.length > 0) {
    const item = queue.pop() as Record<string, unknown> | undefined;
    if (!item || typeof item !== "object") continue;
    if (typeof item.id === "string") ids.add(item.id);
    if (Array.isArray(item.children)) queue.push(...item.children);
  }
  return ids;
}

/**
 * Test-local PRD loader.
 *
 * Reads prd.json from disk without importing from prd-io.ts,
 * which avoids cross-zone coupling in tests.
 */
const testLoadPRD: LoadPRDFn = (rexDir: string) => {
  const prdPath = join(rexDir, "prd.json");
  if (!existsSync(prdPath)) return null;
  try {
    return JSON.parse(readFileSync(prdPath, "utf-8"));
  } catch {
    return null;
  }
};

describe("UsageCleanupScheduler", () => {
  let tmpDir: string;
  let runsDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "usage-cleanup-"));
    runsDir = join(tmpDir, ".hench", "runs");
    rexDir = join(tmpDir, ".rex");
    await mkdir(runsDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Write a run file with the given task ID and token usage. */
  async function writeRun(
    filename: string,
    taskId: string,
    tokens: { input?: number; output?: number } = {},
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
        },
      }),
      "utf-8",
    );
  }

  /** Write a minimal PRD file with the given task IDs. */
  async function writePRD(taskIds: string[]): Promise<void> {
    const items = taskIds.map((id) => ({
      id,
      title: `Task ${id}`,
      level: "task",
      status: "pending",
      priority: "medium",
      children: [],
    }));
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({ schema: "rex/v1", items }),
      "utf-8",
    );
  }

  // ---------------------------------------------------------------------------
  // identifyOrphanedEntries — pure function
  // ---------------------------------------------------------------------------

  describe("identifyOrphanedEntries", () => {
    it("returns entries not in the valid set", () => {
      const taskUsage = {
        "task-a": { totalTokens: 100, runCount: 1 },
        "task-b": { totalTokens: 200, runCount: 2 },
        "task-c": { totalTokens: 300, runCount: 1 },
      };
      const validIds = new Set(["task-a", "task-c"]);

      const orphaned = identifyOrphanedEntries(taskUsage, validIds);

      expect(orphaned).toEqual([
        { taskId: "task-b", totalTokens: 200, runCount: 2 },
      ]);
    });

    it("returns empty array when all entries are valid", () => {
      const taskUsage = {
        "task-a": { totalTokens: 100, runCount: 1 },
      };
      const validIds = new Set(["task-a"]);

      expect(identifyOrphanedEntries(taskUsage, validIds)).toEqual([]);
    });

    it("returns all entries when valid set is empty", () => {
      const taskUsage = {
        "task-a": { totalTokens: 100, runCount: 1 },
        "task-b": { totalTokens: 200, runCount: 2 },
      };

      const orphaned = identifyOrphanedEntries(taskUsage, new Set());

      expect(orphaned).toHaveLength(2);
      expect(orphaned.map((e) => e.taskId).sort()).toEqual(["task-a", "task-b"]);
    });

    it("returns empty array for empty usage", () => {
      expect(identifyOrphanedEntries({}, new Set(["task-a"]))).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // writeCleanupLog — JSONL audit file
  // ---------------------------------------------------------------------------

  describe("writeCleanupLog", () => {
    it("appends a JSONL entry to the log file", async () => {
      const logPath = join(tmpDir, ".hench", "usage-cleanup.jsonl");

      const entry = {
        event: "usage_cleanup" as const,
        timestamp: "2026-02-26T00:00:00.000Z",
        prdAvailable: true,
        orphanedEntries: [{ taskId: "task-x", totalTokens: 500, runCount: 2 }],
        totalOrphaned: 1,
        totalTokensRemoved: 500,
        totalRunsRemoved: 2,
      };

      writeCleanupLog(logPath, entry);

      const content = await readFile(logPath, "utf-8");
      const parsed = JSON.parse(content.trim());
      expect(parsed.event).toBe("usage_cleanup");
      expect(parsed.totalOrphaned).toBe(1);
      expect(parsed.orphanedEntries[0].taskId).toBe("task-x");
    });

    it("appends multiple entries on separate lines", async () => {
      const logPath = join(tmpDir, ".hench", "usage-cleanup.jsonl");

      const entry1 = {
        event: "usage_cleanup" as const,
        timestamp: "2026-02-26T00:00:00.000Z",
        prdAvailable: true,
        orphanedEntries: [],
        totalOrphaned: 1,
        totalTokensRemoved: 100,
        totalRunsRemoved: 1,
      };
      const entry2 = {
        event: "usage_cleanup" as const,
        timestamp: "2026-02-26T01:00:00.000Z",
        prdAvailable: true,
        orphanedEntries: [],
        totalOrphaned: 2,
        totalTokensRemoved: 200,
        totalRunsRemoved: 2,
      };

      writeCleanupLog(logPath, entry1);
      writeCleanupLog(logPath, entry2);

      const lines = (await readFile(logPath, "utf-8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).totalOrphaned).toBe(1);
      expect(JSON.parse(lines[1]).totalOrphaned).toBe(2);
    });

    it("creates parent directory if it does not exist", async () => {
      const logPath = join(tmpDir, "new-dir", "nested", "cleanup.jsonl");

      writeCleanupLog(logPath, {
        event: "usage_cleanup",
        timestamp: "2026-02-26T00:00:00.000Z",
        prdAvailable: true,
        orphanedEntries: [],
        totalOrphaned: 0,
        totalTokensRemoved: 0,
        totalRunsRemoved: 0,
      });

      const content = await readFile(logPath, "utf-8");
      expect(content.trim()).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // loadCleanupConfig
  // ---------------------------------------------------------------------------

  describe("loadCleanupConfig", () => {
    it("returns default interval when no config file exists", () => {
      const config = loadCleanupConfig(join(tmpDir, "nonexistent"));
      expect(config.intervalMs).toBe(DEFAULT_CLEANUP_INTERVAL_MS);
    });

    it("returns configured interval from .n-dx.json", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ cleanup: { intervalMs: 3600000 } }),
        "utf-8",
      );

      const config = loadCleanupConfig(tmpDir);
      expect(config.intervalMs).toBe(3600000);
    });

    it("returns default for invalid interval (negative)", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ cleanup: { intervalMs: -1 } }),
        "utf-8",
      );

      const config = loadCleanupConfig(tmpDir);
      expect(config.intervalMs).toBe(DEFAULT_CLEANUP_INTERVAL_MS);
    });

    it("returns default for non-numeric interval", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ cleanup: { intervalMs: "weekly" } }),
        "utf-8",
      );

      const config = loadCleanupConfig(tmpDir);
      expect(config.intervalMs).toBe(DEFAULT_CLEANUP_INTERVAL_MS);
    });

    it("returns default when cleanup key is missing", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ web: { port: 3117 } }),
        "utf-8",
      );

      const config = loadCleanupConfig(tmpDir);
      expect(config.intervalMs).toBe(DEFAULT_CLEANUP_INTERVAL_MS);
    });

    it("returns default for malformed JSON", async () => {
      await writeFile(join(tmpDir, ".n-dx.json"), "not json {{{", "utf-8");

      const config = loadCleanupConfig(tmpDir);
      expect(config.intervalMs).toBe(DEFAULT_CLEANUP_INTERVAL_MS);
    });
  });

  // ---------------------------------------------------------------------------
  // runCleanupCycle — integration with real aggregator
  // ---------------------------------------------------------------------------

  describe("runCleanupCycle", () => {
    it("identifies and prunes orphaned entries", async () => {
      // Set up run files: task-a and task-deleted
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-deleted", { input: 200, output: 100 });

      // PRD only contains task-a
      await writePRD(["task-a"]);

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      const result = await runCleanupCycle({ aggregator, rexDir, collectAllIds, loadPRD: testLoadPRD });

      expect(result.prdAvailable).toBe(true);
      expect(result.totalOrphaned).toBe(1);
      expect(result.totalTokensRemoved).toBe(300);
      expect(result.totalRunsRemoved).toBe(1);
      expect(result.orphanedEntries).toEqual([
        { taskId: "task-deleted", totalTokens: 300, runCount: 1 },
      ]);

      // Verify aggregator state is pruned
      const usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toBeDefined();
      expect(usage["task-deleted"]).toBeUndefined();
    });

    it("returns no orphans when all tasks are valid", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writePRD(["task-a"]);

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      const result = await runCleanupCycle({ aggregator, rexDir, collectAllIds, loadPRD: testLoadPRD });

      expect(result.totalOrphaned).toBe(0);
      expect(result.orphanedEntries).toEqual([]);
    });

    it("degrades gracefully when PRD is unavailable", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      // No PRD file written

      const missingRexDir = join(tmpDir, "no-rex");
      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      const result = await runCleanupCycle({
        aggregator,
        rexDir: missingRexDir,
        collectAllIds,
        loadPRD: testLoadPRD,
      });

      expect(result.prdAvailable).toBe(false);
      expect(result.totalOrphaned).toBe(0);

      // Verify aggregator data is preserved (not pruned)
      const usage = await aggregator.getTaskUsage();
      expect(usage["task-a"]).toBeDefined();
    });

    it("writes audit log when orphans are found", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-deleted", { input: 200, output: 100 });
      await writePRD(["task-a"]);

      const logPath = join(tmpDir, ".hench", "usage-cleanup.jsonl");
      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      await runCleanupCycle({ aggregator, rexDir, collectAllIds, logPath, loadPRD: testLoadPRD });

      const logContent = await readFile(logPath, "utf-8");
      const entry = JSON.parse(logContent.trim());
      expect(entry.event).toBe("usage_cleanup");
      expect(entry.totalOrphaned).toBe(1);
      expect(entry.orphanedEntries[0].taskId).toBe("task-deleted");
    });

    it("does not write audit log when no orphans are found", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writePRD(["task-a"]);

      const logPath = join(tmpDir, ".hench", "usage-cleanup.jsonl");
      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      await runCleanupCycle({ aggregator, rexDir, collectAllIds, logPath, loadPRD: testLoadPRD });

      // Log file should not exist since there were no orphans
      expect(existsSync(logPath)).toBe(false);
    });

    it("broadcasts via WebSocket when orphans are found", async () => {
      await writeRun("run-1.json", "task-deleted", { input: 200, output: 100 });
      await writePRD([]);

      const broadcasts: unknown[] = [];
      const broadcast = (data: unknown) => broadcasts.push(data);

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      await runCleanupCycle({ aggregator, rexDir, collectAllIds, broadcast, loadPRD: testLoadPRD });

      expect(broadcasts).toHaveLength(1);
      const msg = broadcasts[0] as Record<string, unknown>;
      expect(msg.type).toBe("hench:usage-cleanup");
      expect(msg.totalOrphaned).toBe(1);
    });

    it("does not broadcast when no orphans are found", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writePRD(["task-a"]);

      const broadcasts: unknown[] = [];
      const broadcast = (data: unknown) => broadcasts.push(data);

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      await runCleanupCycle({ aggregator, rexDir, collectAllIds, broadcast, loadPRD: testLoadPRD });

      expect(broadcasts).toHaveLength(0);
    });

    it("preserves run files on disk (never deletes source data)", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-deleted", { input: 200, output: 100 });
      await writePRD(["task-a"]);

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      await runCleanupCycle({ aggregator, rexDir, collectAllIds, loadPRD: testLoadPRD });

      // Verify run files still exist on disk
      expect(existsSync(join(runsDir, "run-1.json"))).toBe(true);
      expect(existsSync(join(runsDir, "run-2.json"))).toBe(true);
    });

    it("handles multiple orphaned tasks with multiple runs each", async () => {
      await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
      await writeRun("run-2.json", "task-deleted-1", { input: 200, output: 100 });
      await writeRun("run-3.json", "task-deleted-1", { input: 300, output: 150 });
      await writeRun("run-4.json", "task-deleted-2", { input: 400, output: 200 });
      await writePRD(["task-a"]);

      const aggregator = new IncrementalTaskUsageAggregator(runsDir);

      const result = await runCleanupCycle({ aggregator, rexDir, collectAllIds, loadPRD: testLoadPRD });

      expect(result.totalOrphaned).toBe(2);
      expect(result.totalTokensRemoved).toBe(
        300 + 450 + 600, // task-deleted-1: (200+100)+(300+150)=750, task-deleted-2: (400+200)=600
      );
      expect(result.totalRunsRemoved).toBe(3); // 2 runs for task-deleted-1 + 1 for task-deleted-2
    });
  });

  // ---------------------------------------------------------------------------
  // startUsageCleanupScheduler — lifecycle
  // ---------------------------------------------------------------------------

  describe("startUsageCleanupScheduler", () => {
    it("returns an interval handle that can be cleared", () => {
      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const ctx = { rexDir, projectDir: tmpDir };

      const handle = startUsageCleanupScheduler(
        ctx,
        () => aggregator,
        undefined,
        60_000, // 1 minute for testing
      );

      expect(handle).toBeDefined();
      clearInterval(handle);
    });

    it("reads configured interval from .n-dx.json", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ cleanup: { intervalMs: 3600000 } }),
        "utf-8",
      );

      // Verify that loadCleanupConfig reads the custom interval
      const config = loadCleanupConfig(tmpDir);
      expect(config.intervalMs).toBe(3600000);

      // Verify the scheduler accepts and uses the config (doesn't throw)
      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const ctx = { rexDir, projectDir: tmpDir };
      const handle = startUsageCleanupScheduler(ctx, () => aggregator);
      expect(handle).toBeDefined();
      clearInterval(handle);
    });

    it("accepts explicit interval override", () => {
      const aggregator = new IncrementalTaskUsageAggregator(runsDir);
      const ctx = { rexDir, projectDir: tmpDir };

      const handle = startUsageCleanupScheduler(
        ctx,
        () => aggregator,
        undefined,
        30_000, // 30 seconds override
      );

      expect(handle).toBeDefined();
      clearInterval(handle);
    });

    it("uses default interval when no config exists", () => {
      expect(DEFAULT_CLEANUP_INTERVAL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });
});
