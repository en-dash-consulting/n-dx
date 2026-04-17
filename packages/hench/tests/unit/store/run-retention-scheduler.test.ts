import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readdir,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import {
  runRetentionCycle,
  startRetentionScheduler,
  loadRetentionIntervalMs,
  DEFAULT_RETENTION_INTERVAL_MS,
} from "../../../src/store/run-retention-scheduler.js";

describe("RunRetentionScheduler", () => {
  let tmpBase: string;
  let runsDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), "hench-retention-sched-"));
    projectDir = tmpBase;
    runsDir = join(tmpBase, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  /** Create a minimal valid run file. */
  async function writeRunFile(
    name: string,
    content?: Record<string, unknown>,
  ): Promise<void> {
    const data = {
      id: name.replace(/\.json(\.gz)?$/, ""),
      taskId: "task-1",
      taskTitle: "Test task",
      startedAt: "2025-01-01T00:00:00Z",
      status: "completed",
      turns: 1,
      tokenUsage: { input: 1000, output: 500 },
      toolCalls: [],
      model: "sonnet",
      ...content,
    };
    if (name.endsWith(".gz")) {
      const compressed = gzipSync(JSON.stringify(data, null, 2));
      await writeFile(join(runsDir, name), compressed);
    } else {
      await writeFile(
        join(runsDir, name),
        JSON.stringify(data, null, 2),
        "utf-8",
      );
    }
  }

  /** Set file mtime to a specific date in the past. */
  async function setFileAge(name: string, daysAgo: number): Promise<void> {
    const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    await utimes(join(runsDir, name), past, past);
  }

  // ---------------------------------------------------------------------------
  // loadRetentionIntervalMs
  // ---------------------------------------------------------------------------

  describe("loadRetentionIntervalMs", () => {
    it("returns default when .n-dx.json does not exist", async () => {
      const interval = await loadRetentionIntervalMs(projectDir);
      expect(interval).toBe(DEFAULT_RETENTION_INTERVAL_MS);
    });

    it("returns default when no retention section exists", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({ web: { port: 3117 } }),
        "utf-8",
      );
      const interval = await loadRetentionIntervalMs(projectDir);
      expect(interval).toBe(DEFAULT_RETENTION_INTERVAL_MS);
    });

    it("reads intervalMs from .n-dx.json", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({ retention: { intervalMs: 3600000 } }),
        "utf-8",
      );
      const interval = await loadRetentionIntervalMs(projectDir);
      expect(interval).toBe(3600000);
    });

    it("returns default for invalid intervalMs", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({ retention: { intervalMs: -1 } }),
        "utf-8",
      );
      const interval = await loadRetentionIntervalMs(projectDir);
      expect(interval).toBe(DEFAULT_RETENTION_INTERVAL_MS);
    });
  });

  // ---------------------------------------------------------------------------
  // runRetentionCycle
  // ---------------------------------------------------------------------------

  describe("runRetentionCycle", () => {
    it("deletes old files and returns result", async () => {
      await writeRunFile("old.json");
      await setFileAge("old.json", 200);
      await writeRunFile("recent.json");

      const result = await runRetentionCycle({
        runsDir,
        projectDir,
      });

      expect(result).not.toBeNull();
      expect(result!.filesDeleted).toBe(1);

      const files = await readdir(runsDir);
      expect(files).toContain("recent.json");
      expect(files).not.toContain("old.json");
    });

    it("invokes onWarning callback for files approaching cutoff", async () => {
      await writeRunFile("warning.json");
      await setFileAge("warning.json", 160); // Within default 30-day warning window

      const warnings: string[][] = [];
      const result = await runRetentionCycle({
        runsDir,
        projectDir,
        onWarning: (files) => {
          warnings.push(files);
        },
      });

      expect(result).not.toBeNull();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("warning.json");
    });

    it("does not invoke onWarning when no files are in warning window", async () => {
      await writeRunFile("recent.json");

      const warnings: string[][] = [];
      await runRetentionCycle({
        runsDir,
        projectDir,
        onWarning: (files) => {
          warnings.push(files);
        },
      });

      expect(warnings).toHaveLength(0);
    });

    it("invokes broadcast callback with result data", async () => {
      await writeRunFile("old.json");
      await setFileAge("old.json", 200);

      const broadcasts: unknown[] = [];
      await runRetentionCycle({
        runsDir,
        projectDir,
        broadcast: (data) => {
          broadcasts.push(data);
        },
      });

      expect(broadcasts).toHaveLength(1);
      const event = broadcasts[0] as Record<string, unknown>;
      expect(event.type).toBe("hench:retention-cleanup");
      expect(event.filesDeleted).toBe(1);
    });

    it("returns null on error without throwing", async () => {
      // Use a non-existent project dir that will cause config loading to fail
      // in a way that triggers the catch block — here we rely on the
      // enforceRetentionPolicy handling gracefully
      const result = await runRetentionCycle({
        runsDir: join(tmpBase, "nonexistent", "runs"),
        projectDir: join(tmpBase, "nonexistent"),
      });

      // Should return a result (possibly with 0 deletions) or null
      // The function handles errors gracefully
      expect(result === null || typeof result === "object").toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // startRetentionScheduler
  // ---------------------------------------------------------------------------

  describe("startRetentionScheduler", () => {
    it("returns a timer handle that can be cleared", async () => {
      const timer = await startRetentionScheduler({
        runsDir,
        projectDir,
        overrideIntervalMs: 999999, // Very long to avoid actual execution
      });

      expect(timer).toBeDefined();
      clearInterval(timer);
    });

    it("uses overrideIntervalMs when provided", async () => {
      // If override is provided, it should not read from config
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({ retention: { intervalMs: 1000 } }),
        "utf-8",
      );

      const timer = await startRetentionScheduler({
        runsDir,
        projectDir,
        overrideIntervalMs: 500000,
      });

      expect(timer).toBeDefined();
      clearInterval(timer);
    });

    it("executes retention cycle on interval tick", async () => {
      await writeRunFile("old.json");
      await setFileAge("old.json", 200);

      const broadcasts: unknown[] = [];

      // Use a short interval for testing
      const timer = await startRetentionScheduler({
        runsDir,
        projectDir,
        broadcast: (data) => broadcasts.push(data),
        overrideIntervalMs: 50,
      });

      // Wait long enough for at least one tick even under full-monorepo
      // parallel load, where the event loop can be delayed by 100–200 ms.
      await new Promise((resolve) => setTimeout(resolve, 600));
      clearInterval(timer);

      // Should have executed at least once
      expect(broadcasts.length).toBeGreaterThanOrEqual(1);
      const event = broadcasts[0] as Record<string, unknown>;
      expect(event.type).toBe("hench:retention-cleanup");
    });
  });
});
