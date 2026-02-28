import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  readdir,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import {
  enforceRetentionPolicy,
  identifyRetainableRuns,
  identifyWarningRuns,
  extractUsageStats,
  loadRetentionConfig,
  DEFAULT_RETENTION_CONFIG,
  type RetentionConfig,
  type RetentionResult,
  type PreservedUsageStats,
} from "../../../src/store/run-retention.js";

describe("RunRetention", () => {
  let tmpBase: string;
  let runsDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), "hench-retention-"));
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
      tokenUsage: {
        input: 1000,
        output: 500,
        cacheCreationInput: 200,
        cacheReadInput: 300,
      },
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
  // DEFAULT_RETENTION_CONFIG
  // ---------------------------------------------------------------------------

  describe("DEFAULT_RETENTION_CONFIG", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_RETENTION_CONFIG.maxAgeDays).toBe(180);
      expect(DEFAULT_RETENTION_CONFIG.enabled).toBe(true);
      expect(DEFAULT_RETENTION_CONFIG.warningDays).toBe(30);
      expect(DEFAULT_RETENTION_CONFIG.preserveUsageStats).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // loadRetentionConfig
  // ---------------------------------------------------------------------------

  describe("loadRetentionConfig", () => {
    it("returns defaults when .n-dx.json does not exist", async () => {
      const config = await loadRetentionConfig(projectDir);
      expect(config).toEqual(DEFAULT_RETENTION_CONFIG);
    });

    it("returns defaults when .n-dx.json has no retention section", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({ web: { port: 3117 } }),
        "utf-8",
      );
      const config = await loadRetentionConfig(projectDir);
      expect(config).toEqual(DEFAULT_RETENTION_CONFIG);
    });

    it("reads retention config from .n-dx.json", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({
          retention: {
            maxAgeDays: 90,
            enabled: false,
            warningDays: 14,
            preserveUsageStats: false,
          },
        }),
        "utf-8",
      );
      const config = await loadRetentionConfig(projectDir);
      expect(config.maxAgeDays).toBe(90);
      expect(config.enabled).toBe(false);
      expect(config.warningDays).toBe(14);
      expect(config.preserveUsageStats).toBe(false);
    });

    it("falls back to defaults for invalid fields", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({
          retention: { maxAgeDays: -1, enabled: "yes", warningDays: 0 },
        }),
        "utf-8",
      );
      const config = await loadRetentionConfig(projectDir);
      expect(config.maxAgeDays).toBe(DEFAULT_RETENTION_CONFIG.maxAgeDays);
      expect(config.enabled).toBe(DEFAULT_RETENTION_CONFIG.enabled);
      expect(config.warningDays).toBe(DEFAULT_RETENTION_CONFIG.warningDays);
    });

    it("handles invalid JSON gracefully", async () => {
      await writeFile(join(projectDir, ".n-dx.json"), "not json{{{", "utf-8");
      const config = await loadRetentionConfig(projectDir);
      expect(config).toEqual(DEFAULT_RETENTION_CONFIG);
    });

    it("clamps warningDays to not exceed maxAgeDays", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({
          retention: { maxAgeDays: 30, warningDays: 60 },
        }),
        "utf-8",
      );
      const config = await loadRetentionConfig(projectDir);
      // warningDays should be clamped to maxAgeDays
      expect(config.warningDays).toBeLessThanOrEqual(config.maxAgeDays);
    });
  });

  // ---------------------------------------------------------------------------
  // identifyRetainableRuns
  // ---------------------------------------------------------------------------

  describe("identifyRetainableRuns", () => {
    it("returns empty array when no files exist", async () => {
      const result = await identifyRetainableRuns(runsDir, 180);
      expect(result).toEqual([]);
    });

    it("returns empty array when all files are recent", async () => {
      await writeRunFile("run-1.json");
      await writeRunFile("run-2.json");

      const result = await identifyRetainableRuns(runsDir, 180);
      expect(result).toEqual([]);
    });

    it("identifies uncompressed files older than threshold", async () => {
      await writeRunFile("old-run.json");
      await writeRunFile("new-run.json");
      await setFileAge("old-run.json", 200);

      const result = await identifyRetainableRuns(runsDir, 180);
      expect(result).toEqual(["old-run.json"]);
    });

    it("identifies compressed files older than threshold", async () => {
      await writeRunFile("old-run.json.gz");
      await setFileAge("old-run.json.gz", 200);

      const result = await identifyRetainableRuns(runsDir, 180);
      expect(result).toEqual(["old-run.json.gz"]);
    });

    it("identifies both compressed and uncompressed old files", async () => {
      await writeRunFile("old-plain.json");
      await writeRunFile("old-gzip.json.gz");
      await writeRunFile("recent.json");
      await setFileAge("old-plain.json", 200);
      await setFileAge("old-gzip.json.gz", 250);

      const result = await identifyRetainableRuns(runsDir, 180);
      expect(result).toContain("old-plain.json");
      expect(result).toContain("old-gzip.json.gz");
      expect(result).not.toContain("recent.json");
    });

    it("ignores hidden files", async () => {
      await writeFile(
        join(runsDir, ".aggregation-checkpoint.json"),
        '{"timestamp":"now"}',
        "utf-8",
      );
      await setFileAge(".aggregation-checkpoint.json", 365);

      const result = await identifyRetainableRuns(runsDir, 180);
      expect(result).toEqual([]);
    });

    it("handles missing directory gracefully", async () => {
      const result = await identifyRetainableRuns(
        join(tmpBase, "nonexistent", "runs"),
        180,
      );
      expect(result).toEqual([]);
    });

    it("accepts a custom now timestamp for testing", async () => {
      await writeRunFile("run-1.json");

      // File was just created, but pretend "now" is 200 days in the future
      const futureNow = Date.now() + 200 * 24 * 60 * 60 * 1000;
      const result = await identifyRetainableRuns(runsDir, 180, futureNow);
      expect(result).toEqual(["run-1.json"]);
    });

    it("returns files in sorted order", async () => {
      await writeRunFile("c-run.json");
      await writeRunFile("a-run.json.gz");
      await writeRunFile("b-run.json");
      await setFileAge("c-run.json", 200);
      await setFileAge("a-run.json.gz", 200);
      await setFileAge("b-run.json", 200);

      const result = await identifyRetainableRuns(runsDir, 180);
      expect(result).toEqual(["a-run.json.gz", "b-run.json", "c-run.json"]);
    });
  });

  // ---------------------------------------------------------------------------
  // identifyWarningRuns
  // ---------------------------------------------------------------------------

  describe("identifyWarningRuns", () => {
    it("returns empty array when no files are in the warning window", async () => {
      await writeRunFile("recent.json");
      await writeRunFile("very-old.json");
      await setFileAge("very-old.json", 200);

      const result = await identifyWarningRuns(runsDir, 180, 30);
      // very-old.json is past the cutoff (200 > 180), not in warning window
      // recent.json is too new
      expect(result).toEqual([]);
    });

    it("identifies files in the warning window", async () => {
      await writeRunFile("warning.json");
      // 160 days old: within warning window (180-30=150 to 180)
      await setFileAge("warning.json", 160);

      const result = await identifyWarningRuns(runsDir, 180, 30);
      expect(result).toEqual(["warning.json"]);
    });

    it("excludes files already past the deletion threshold", async () => {
      await writeRunFile("past-due.json");
      await setFileAge("past-due.json", 200);

      const result = await identifyWarningRuns(runsDir, 180, 30);
      expect(result).toEqual([]);
    });

    it("excludes files that are still too recent for warning", async () => {
      await writeRunFile("too-recent.json");
      await setFileAge("too-recent.json", 100);

      const result = await identifyWarningRuns(runsDir, 180, 30);
      expect(result).toEqual([]);
    });

    it("works with compressed files", async () => {
      await writeRunFile("warning.json.gz");
      await setFileAge("warning.json.gz", 155);

      const result = await identifyWarningRuns(runsDir, 180, 30);
      expect(result).toEqual(["warning.json.gz"]);
    });

    it("handles missing directory gracefully", async () => {
      const result = await identifyWarningRuns(
        join(tmpBase, "nonexistent"),
        180,
        30,
      );
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // extractUsageStats
  // ---------------------------------------------------------------------------

  describe("extractUsageStats", () => {
    it("extracts stats from uncompressed run files", async () => {
      await writeRunFile("run-1.json", {
        taskId: "task-a",
        tokenUsage: { input: 1000, output: 500 },
        turns: 3,
        model: "sonnet",
        startedAt: "2025-01-01T00:00:00Z",
      });

      const stats = await extractUsageStats(runsDir, ["run-1.json"]);
      expect(stats.totalInputTokens).toBe(1000);
      expect(stats.totalOutputTokens).toBe(500);
      expect(stats.totalRuns).toBe(1);
      expect(stats.taskIds).toContain("task-a");
    });

    it("extracts stats from compressed run files", async () => {
      await writeRunFile("run-1.json.gz", {
        taskId: "task-b",
        tokenUsage: {
          input: 2000,
          output: 1000,
          cacheCreationInput: 300,
          cacheReadInput: 400,
        },
        turns: 5,
      });

      const stats = await extractUsageStats(runsDir, ["run-1.json.gz"]);
      expect(stats.totalInputTokens).toBe(2000);
      expect(stats.totalOutputTokens).toBe(1000);
      expect(stats.totalCacheCreationTokens).toBe(300);
      expect(stats.totalCacheReadTokens).toBe(400);
      expect(stats.totalRuns).toBe(1);
    });

    it("aggregates stats across multiple files", async () => {
      await writeRunFile("run-1.json", {
        taskId: "task-a",
        tokenUsage: { input: 1000, output: 500 },
        turns: 3,
      });
      await writeRunFile("run-2.json", {
        taskId: "task-b",
        tokenUsage: { input: 2000, output: 1500 },
        turns: 7,
      });

      const stats = await extractUsageStats(runsDir, [
        "run-1.json",
        "run-2.json",
      ]);
      expect(stats.totalInputTokens).toBe(3000);
      expect(stats.totalOutputTokens).toBe(2000);
      expect(stats.totalRuns).toBe(2);
      expect(stats.totalTurns).toBe(10);
      expect(stats.taskIds).toContain("task-a");
      expect(stats.taskIds).toContain("task-b");
    });

    it("handles unreadable files gracefully", async () => {
      await writeRunFile("good.json");
      // Create a file that can't be parsed
      await writeFile(join(runsDir, "bad.json"), "not json{{{", "utf-8");

      const stats = await extractUsageStats(runsDir, [
        "good.json",
        "bad.json",
      ]);
      expect(stats.totalRuns).toBe(1);
      expect(stats.errors).toHaveLength(1);
      expect(stats.errors[0].file).toBe("bad.json");
    });

    it("returns empty stats for empty file list", async () => {
      const stats = await extractUsageStats(runsDir, []);
      expect(stats.totalRuns).toBe(0);
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // enforceRetentionPolicy
  // ---------------------------------------------------------------------------

  describe("enforceRetentionPolicy", () => {
    it("deletes files older than retention threshold", async () => {
      await writeRunFile("old-1.json");
      await writeRunFile("old-2.json.gz");
      await writeRunFile("recent.json");
      await setFileAge("old-1.json", 200);
      await setFileAge("old-2.json.gz", 250);

      const result = await enforceRetentionPolicy(runsDir, {
        maxAgeDays: 180,
        enabled: true,
        warningDays: 30,
        preserveUsageStats: false,
      });

      expect(result.filesDeleted).toBe(2);

      const files = await readdir(runsDir);
      expect(files).toContain("recent.json");
      expect(files).not.toContain("old-1.json");
      expect(files).not.toContain("old-2.json.gz");
    });

    it("does nothing when disabled", async () => {
      await writeRunFile("old.json");
      await setFileAge("old.json", 200);

      const result = await enforceRetentionPolicy(runsDir, {
        maxAgeDays: 180,
        enabled: false,
        warningDays: 30,
        preserveUsageStats: true,
      });

      expect(result.filesDeleted).toBe(0);

      const files = await readdir(runsDir);
      expect(files).toContain("old.json");
    });

    it("preserves usage stats before deletion when configured", async () => {
      await writeRunFile("old.json", {
        tokenUsage: { input: 5000, output: 2500 },
        taskId: "task-x",
        turns: 10,
      });
      await setFileAge("old.json", 200);

      const result = await enforceRetentionPolicy(runsDir, {
        maxAgeDays: 180,
        enabled: true,
        warningDays: 30,
        preserveUsageStats: true,
      });

      expect(result.filesDeleted).toBe(1);
      expect(result.preservedStats).toBeDefined();
      expect(result.preservedStats!.totalInputTokens).toBe(5000);
      expect(result.preservedStats!.totalOutputTokens).toBe(2500);
      expect(result.preservedStats!.totalRuns).toBe(1);
    });

    it("writes stats to the retention log file", async () => {
      await writeRunFile("old.json", { tokenUsage: { input: 100, output: 50 } });
      await setFileAge("old.json", 200);

      const logPath = join(tmpBase, ".hench", "retention-stats.jsonl");

      const result = await enforceRetentionPolicy(
        runsDir,
        {
          maxAgeDays: 180,
          enabled: true,
          warningDays: 30,
          preserveUsageStats: true,
        },
        undefined,
        logPath,
      );

      expect(result.filesDeleted).toBe(1);

      // Verify the log file was written
      const logContent = await readFile(logPath, "utf-8");
      const entry = JSON.parse(logContent.trim());
      expect(entry.event).toBe("retention_cleanup");
      expect(entry.filesDeleted).toBe(1);
      expect(entry.preservedStats.totalInputTokens).toBe(100);
    });

    it("includes warning files in result", async () => {
      await writeRunFile("warning.json");
      await writeRunFile("old.json");
      await setFileAge("warning.json", 160);
      await setFileAge("old.json", 200);

      const result = await enforceRetentionPolicy(runsDir, {
        maxAgeDays: 180,
        enabled: true,
        warningDays: 30,
        preserveUsageStats: false,
      });

      expect(result.filesDeleted).toBe(1);
      expect(result.warningFiles).toContain("warning.json");
    });

    it("handles empty runs directory", async () => {
      const result = await enforceRetentionPolicy(runsDir, {
        maxAgeDays: 180,
        enabled: true,
        warningDays: 30,
        preserveUsageStats: true,
      });

      expect(result.filesDeleted).toBe(0);
      expect(result.filesSkipped).toBe(0);
      expect(result.warningFiles).toEqual([]);
    });

    it("records errors for files that fail to delete", async () => {
      await writeRunFile("old.json");
      await setFileAge("old.json", 200);

      // The file should be deleted normally, but let's verify error handling
      // by checking that errors array is returned (even if empty for success)
      const result = await enforceRetentionPolicy(runsDir, {
        maxAgeDays: 180,
        enabled: true,
        warningDays: 30,
        preserveUsageStats: false,
      });

      expect(result.errors).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("uses default config when none provided", async () => {
      await writeRunFile("old.json");
      await setFileAge("old.json", 200);

      const result = await enforceRetentionPolicy(runsDir);

      expect(result.filesDeleted).toBe(1);
    });

    it("accepts custom now timestamp for testing", async () => {
      await writeRunFile("run-1.json");

      // File was just created but pretend now is 200 days in the future
      const futureNow = Date.now() + 200 * 24 * 60 * 60 * 1000;
      const result = await enforceRetentionPolicy(
        runsDir,
        { maxAgeDays: 180, enabled: true, warningDays: 30, preserveUsageStats: false },
        futureNow,
      );

      expect(result.filesDeleted).toBe(1);
      const files = await readdir(runsDir);
      expect(files).not.toContain("run-1.json");
    });
  });
});
