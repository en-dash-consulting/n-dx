/**
 * Unit tests for the task-usage.ts public facade.
 *
 * Verifies that the facade re-exports all expected symbols from its
 * internal modules and that exported values/types are usable through
 * the facade — ensuring consumers don't need to know internal paths.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  // Incremental aggregation
  IncrementalTaskUsageAggregator,
  // Cleanup scheduling
  startUsageCleanupScheduler,
  runCleanupCycle,
  identifyOrphanedEntries,
  loadCleanupConfig,
  writeCleanupLog,
  DEFAULT_CLEANUP_INTERVAL_MS,
  // Scheduler registration
  registerUsageScheduler,
} from "../../../src/server/task-usage.js";

// Also verify type re-exports compile (TypeScript-level check)
import type {
  TaskUsageAccumulator,
  CollectAllIdsFn,
  OrphanedEntry,
  CleanupResult,
  CleanupConfig,
  CleanupLogEntry,
  RegisterSchedulerOptions,
} from "../../../src/server/task-usage.js";

// ---------------------------------------------------------------------------
// Facade completeness
// ---------------------------------------------------------------------------

describe("task-usage facade: re-export completeness", () => {
  it("exports IncrementalTaskUsageAggregator class", () => {
    expect(IncrementalTaskUsageAggregator).toBeDefined();
    expect(typeof IncrementalTaskUsageAggregator).toBe("function");
  });

  it("exports identifyOrphanedEntries function", () => {
    expect(typeof identifyOrphanedEntries).toBe("function");
  });

  it("exports runCleanupCycle function", () => {
    expect(typeof runCleanupCycle).toBe("function");
  });

  it("exports startUsageCleanupScheduler function", () => {
    expect(typeof startUsageCleanupScheduler).toBe("function");
  });

  it("exports loadCleanupConfig function", () => {
    expect(typeof loadCleanupConfig).toBe("function");
  });

  it("exports writeCleanupLog function", () => {
    expect(typeof writeCleanupLog).toBe("function");
  });

  it("exports DEFAULT_CLEANUP_INTERVAL_MS constant", () => {
    expect(typeof DEFAULT_CLEANUP_INTERVAL_MS).toBe("number");
    expect(DEFAULT_CLEANUP_INTERVAL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("exports registerUsageScheduler function", () => {
    expect(typeof registerUsageScheduler).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Public API behavior through facade
// ---------------------------------------------------------------------------

describe("task-usage facade: API behavior", () => {
  let tmpDir: string;
  let runsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "task-usage-facade-"));
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

  // -- IncrementalTaskUsageAggregator through facade --

  it("IncrementalTaskUsageAggregator aggregates run files", async () => {
    await writeRun("run-1.json", "task-a", { input: 100, output: 50 });
    await writeRun("run-2.json", "task-b", { input: 200, output: 100 });

    const aggregator = new IncrementalTaskUsageAggregator(runsDir);
    const usage = await aggregator.getTaskUsage();

    expect(usage["task-a"]).toEqual({ totalTokens: 150, runCount: 1 });
    expect(usage["task-b"]).toEqual({ totalTokens: 300, runCount: 1 });
  });

  // -- identifyOrphanedEntries through facade --

  it("identifyOrphanedEntries finds entries not in valid set", () => {
    const usage: Record<string, TaskUsageAccumulator> = {
      "task-a": { totalTokens: 100, runCount: 1 },
      "task-b": { totalTokens: 200, runCount: 2 },
      "task-c": { totalTokens: 50, runCount: 1 },
    };
    const validIds = new Set(["task-a"]);

    const orphans = identifyOrphanedEntries(usage, validIds);

    expect(orphans).toHaveLength(2);
    expect(orphans.map((o) => o.taskId).sort()).toEqual(["task-b", "task-c"]);
  });

  it("identifyOrphanedEntries returns empty when all valid", () => {
    const usage: Record<string, TaskUsageAccumulator> = {
      "task-a": { totalTokens: 100, runCount: 1 },
    };
    const orphans = identifyOrphanedEntries(usage, new Set(["task-a"]));
    expect(orphans).toHaveLength(0);
  });

  // -- loadCleanupConfig through facade --

  it("loadCleanupConfig returns defaults for missing config", () => {
    const config = loadCleanupConfig(join(tmpDir, "nonexistent"));
    expect(config.intervalMs).toBe(DEFAULT_CLEANUP_INTERVAL_MS);
  });

  it("loadCleanupConfig reads custom interval from .n-dx.json", async () => {
    const configDir = join(tmpDir, "project");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, ".n-dx.json"),
      JSON.stringify({ cleanup: { intervalMs: 3600000 } }),
      "utf-8",
    );

    const config = loadCleanupConfig(configDir);
    expect(config.intervalMs).toBe(3600000);
  });

  it("loadCleanupConfig ignores invalid config gracefully", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      "not valid json {{{",
      "utf-8",
    );

    const config = loadCleanupConfig(tmpDir);
    expect(config.intervalMs).toBe(DEFAULT_CLEANUP_INTERVAL_MS);
  });

  // -- writeCleanupLog through facade --

  it("writeCleanupLog appends JSONL entry to file", async () => {
    const logPath = join(tmpDir, "cleanup.jsonl");
    const entry: CleanupLogEntry = {
      event: "usage_cleanup",
      timestamp: new Date().toISOString(),
      prdAvailable: true,
      orphanedEntries: [],
      totalOrphaned: 0,
      totalTokensRemoved: 0,
      totalRunsRemoved: 0,
    };

    writeCleanupLog(logPath, entry);

    const content = await readFile(logPath, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.event).toBe("usage_cleanup");
    expect(parsed.prdAvailable).toBe(true);
  });

  it("writeCleanupLog creates parent directories if needed", async () => {
    const logPath = join(tmpDir, "nested", "deep", "cleanup.jsonl");
    const entry: CleanupLogEntry = {
      event: "usage_cleanup",
      timestamp: new Date().toISOString(),
      prdAvailable: false,
      orphanedEntries: [],
      totalOrphaned: 0,
      totalTokensRemoved: 0,
      totalRunsRemoved: 0,
    };

    writeCleanupLog(logPath, entry);

    const content = await readFile(logPath, "utf-8");
    expect(JSON.parse(content.trim()).event).toBe("usage_cleanup");
  });

  // -- runCleanupCycle through facade --

  it("runCleanupCycle returns result with prdAvailable false when no collectAllIds", async () => {
    await writeRun("run-1.json", "task-a", { input: 100, output: 50 });

    const aggregator = new IncrementalTaskUsageAggregator(runsDir);
    const rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });

    const result = await runCleanupCycle({
      aggregator,
      rexDir,
    });

    expect(result.prdAvailable).toBe(false);
    expect(result.totalOrphaned).toBe(0);
  });

  // -- registerUsageScheduler through facade --

  it("registerUsageScheduler returns an interval handle", () => {
    const aggregator = new IncrementalTaskUsageAggregator(runsDir);
    const ctx = { rexDir: join(tmpDir, ".rex"), projectDir: tmpDir };

    const handle = registerUsageScheduler({
      ctx,
      getAggregator: () => aggregator,
      overrideIntervalMs: 999999999, // very long to avoid firing
    });

    expect(handle).toBeDefined();
    clearInterval(handle);
  });

  // -- startUsageCleanupScheduler through facade --

  it("startUsageCleanupScheduler returns an interval handle", () => {
    const aggregator = new IncrementalTaskUsageAggregator(runsDir);
    const ctx = { rexDir: join(tmpDir, ".rex"), projectDir: tmpDir };

    const handle = startUsageCleanupScheduler(
      ctx,
      () => aggregator,
      undefined,
      999999999,
    );

    expect(handle).toBeDefined();
    clearInterval(handle);
  });
});
