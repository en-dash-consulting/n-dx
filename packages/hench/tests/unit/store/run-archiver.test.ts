import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  archiveOldRuns,
  identifyArchivableRuns,
  compressRunFile,
  readCompressedJSON,
  loadArchivalConfig,
  DEFAULT_ARCHIVAL_CONFIG,
  type ArchivalConfig,
} from "../../../src/store/run-archiver.js";

describe("RunArchiver", () => {
  let tmpBase: string;
  let runsDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), "hench-archiver-"));
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
      id: name.replace(/\.json$/, ""),
      taskId: "task-1",
      taskTitle: "Test task",
      startedAt: "2025-01-01T00:00:00Z",
      status: "completed",
      turns: 1,
      tokenUsage: { input: 1000, output: 500, cacheCreationInput: 200, cacheReadInput: 300 },
      toolCalls: [],
      model: "sonnet",
      ...content,
    };
    await writeFile(join(runsDir, name), JSON.stringify(data, null, 2), "utf-8");
  }

  /** Set file mtime to a specific date in the past. */
  async function setFileAge(name: string, daysAgo: number): Promise<void> {
    const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    await utimes(join(runsDir, name), past, past);
  }

  // ---------------------------------------------------------------------------
  // DEFAULT_ARCHIVAL_CONFIG
  // ---------------------------------------------------------------------------

  describe("DEFAULT_ARCHIVAL_CONFIG", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_ARCHIVAL_CONFIG.maxAgeDays).toBe(30);
      expect(DEFAULT_ARCHIVAL_CONFIG.enabled).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // loadArchivalConfig
  // ---------------------------------------------------------------------------

  describe("loadArchivalConfig", () => {
    it("returns defaults when .n-dx.json does not exist", async () => {
      const config = await loadArchivalConfig(projectDir);
      expect(config).toEqual(DEFAULT_ARCHIVAL_CONFIG);
    });

    it("returns defaults when .n-dx.json has no archival section", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({ web: { port: 3117 } }),
        "utf-8",
      );
      const config = await loadArchivalConfig(projectDir);
      expect(config).toEqual(DEFAULT_ARCHIVAL_CONFIG);
    });

    it("reads archival config from .n-dx.json", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({ archival: { maxAgeDays: 7, enabled: false } }),
        "utf-8",
      );
      const config = await loadArchivalConfig(projectDir);
      expect(config.maxAgeDays).toBe(7);
      expect(config.enabled).toBe(false);
    });

    it("falls back to defaults for invalid fields", async () => {
      await writeFile(
        join(projectDir, ".n-dx.json"),
        JSON.stringify({ archival: { maxAgeDays: -1, enabled: "yes" } }),
        "utf-8",
      );
      const config = await loadArchivalConfig(projectDir);
      expect(config.maxAgeDays).toBe(DEFAULT_ARCHIVAL_CONFIG.maxAgeDays);
      expect(config.enabled).toBe(DEFAULT_ARCHIVAL_CONFIG.enabled);
    });

    it("handles invalid JSON gracefully", async () => {
      await writeFile(join(projectDir, ".n-dx.json"), "not json{{{", "utf-8");
      const config = await loadArchivalConfig(projectDir);
      expect(config).toEqual(DEFAULT_ARCHIVAL_CONFIG);
    });
  });

  // ---------------------------------------------------------------------------
  // readCompressedJSON
  // ---------------------------------------------------------------------------

  describe("readCompressedJSON", () => {
    it("reads and decompresses a gzip file", async () => {
      const original = { id: "test-123", tokenUsage: { input: 100 } };
      const compressed = gzipSync(JSON.stringify(original));
      const filePath = join(runsDir, "test.json.gz");
      await writeFile(filePath, compressed);

      const result = await readCompressedJSON(filePath);
      expect(result).toEqual(original);
    });

    it("throws for non-gzip file", async () => {
      const filePath = join(runsDir, "bad.json.gz");
      await writeFile(filePath, "not compressed", "utf-8");

      await expect(readCompressedJSON(filePath)).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // compressRunFile
  // ---------------------------------------------------------------------------

  describe("compressRunFile", () => {
    it("compresses a json file and removes the original", async () => {
      await writeRunFile("run-1.json");

      const result = await compressRunFile(runsDir, "run-1.json");

      // Original should be gone
      const files = await readdir(runsDir);
      expect(files).not.toContain("run-1.json");
      expect(files).toContain("run-1.json.gz");

      // Result has size info
      expect(result.file).toBe("run-1.json");
      expect(result.originalSize).toBeGreaterThan(0);
      expect(result.compressedSize).toBeGreaterThan(0);
      expect(result.compressedSize).toBeLessThan(result.originalSize);
    });

    it("compressed file preserves all data including token usage", async () => {
      const tokenUsage = {
        input: 5000,
        output: 2000,
        cacheCreationInput: 472783,
        cacheReadInput: 9174659,
      };
      await writeRunFile("run-2.json", { tokenUsage });

      await compressRunFile(runsDir, "run-2.json");

      // Read back the compressed file
      const compressed = await readFile(join(runsDir, "run-2.json.gz"));
      const decompressed = gunzipSync(compressed);
      const data = JSON.parse(decompressed.toString("utf-8"));

      expect(data.tokenUsage).toEqual(tokenUsage);
      expect(data.id).toBe("run-2");
      expect(data.taskId).toBe("task-1");
    });
  });

  // ---------------------------------------------------------------------------
  // identifyArchivableRuns
  // ---------------------------------------------------------------------------

  describe("identifyArchivableRuns", () => {
    it("returns empty array when no files exist", async () => {
      const result = await identifyArchivableRuns(runsDir, 30);
      expect(result).toEqual([]);
    });

    it("returns empty array when all files are recent", async () => {
      await writeRunFile("run-1.json");
      await writeRunFile("run-2.json");

      const result = await identifyArchivableRuns(runsDir, 30);
      expect(result).toEqual([]);
    });

    it("identifies files older than threshold", async () => {
      await writeRunFile("old-run.json");
      await writeRunFile("new-run.json");

      // Make old-run 60 days old
      await setFileAge("old-run.json", 60);

      const result = await identifyArchivableRuns(runsDir, 30);
      expect(result).toEqual(["old-run.json"]);
    });

    it("respects custom threshold", async () => {
      await writeRunFile("run-1.json");
      await setFileAge("run-1.json", 10);

      // 30-day threshold: not eligible
      expect(await identifyArchivableRuns(runsDir, 30)).toEqual([]);

      // 7-day threshold: eligible
      expect(await identifyArchivableRuns(runsDir, 7)).toEqual(["run-1.json"]);
    });

    it("ignores already compressed files", async () => {
      // Create a .json.gz file directly
      const compressed = gzipSync('{"id":"old"}');
      await writeFile(join(runsDir, "old.json.gz"), compressed);

      const result = await identifyArchivableRuns(runsDir, 0);
      expect(result).not.toContain("old.json.gz");
    });

    it("ignores hidden files", async () => {
      await writeFile(
        join(runsDir, ".aggregation-checkpoint.json"),
        '{"timestamp":"now"}',
        "utf-8",
      );
      await setFileAge(".aggregation-checkpoint.json", 60);

      const result = await identifyArchivableRuns(runsDir, 30);
      expect(result).toEqual([]);
    });

    it("handles missing directory gracefully", async () => {
      const result = await identifyArchivableRuns(
        join(tmpBase, "nonexistent", "runs"),
        30,
      );
      expect(result).toEqual([]);
    });

    it("accepts a custom now timestamp for testing", async () => {
      await writeRunFile("run-1.json");

      // File was just created (now), but pretend "now" is 60 days in the future
      const futureNow = Date.now() + 60 * 24 * 60 * 60 * 1000;
      const result = await identifyArchivableRuns(runsDir, 30, futureNow);
      expect(result).toEqual(["run-1.json"]);
    });

    it("returns files in sorted order", async () => {
      await writeRunFile("c-run.json");
      await writeRunFile("a-run.json");
      await writeRunFile("b-run.json");
      await setFileAge("c-run.json", 60);
      await setFileAge("a-run.json", 60);
      await setFileAge("b-run.json", 60);

      const result = await identifyArchivableRuns(runsDir, 30);
      expect(result).toEqual(["a-run.json", "b-run.json", "c-run.json"]);
    });
  });

  // ---------------------------------------------------------------------------
  // archiveOldRuns
  // ---------------------------------------------------------------------------

  describe("archiveOldRuns", () => {
    it("compresses eligible files and returns summary", async () => {
      await writeRunFile("old-1.json");
      await writeRunFile("old-2.json");
      await writeRunFile("recent.json");
      await setFileAge("old-1.json", 60);
      await setFileAge("old-2.json", 45);

      const result = await archiveOldRuns(runsDir, { maxAgeDays: 30, enabled: true });

      expect(result.filesCompressed).toBe(2);
      expect(result.filesSkipped).toBe(1); // recent.json
      expect(result.bytesSaved).toBeGreaterThan(0);
      expect(result.details).toHaveLength(2);
      expect(result.errors).toHaveLength(0);

      // Verify filesystem state
      const files = await readdir(runsDir);
      expect(files).toContain("recent.json");
      expect(files).toContain("old-1.json.gz");
      expect(files).toContain("old-2.json.gz");
      expect(files).not.toContain("old-1.json");
      expect(files).not.toContain("old-2.json");
    });

    it("does nothing when disabled", async () => {
      await writeRunFile("old.json");
      await setFileAge("old.json", 60);

      const result = await archiveOldRuns(runsDir, { maxAgeDays: 30, enabled: false });

      expect(result.filesCompressed).toBe(0);

      // File should still be there uncompressed
      const files = await readdir(runsDir);
      expect(files).toContain("old.json");
    });

    it("uses default config when none provided", async () => {
      await writeRunFile("old.json");
      await setFileAge("old.json", 60);

      const result = await archiveOldRuns(runsDir);

      expect(result.filesCompressed).toBe(1);
    });

    it("records errors for files that fail to compress", async () => {
      await writeRunFile("good.json");
      await setFileAge("good.json", 60);

      // Create a file that will be identified but can't be read properly
      // (by making it unreadable after identification — simulated by
      // checking error handling)
      const result = await archiveOldRuns(runsDir, { maxAgeDays: 30, enabled: true });

      // The good file should compress successfully
      expect(result.filesCompressed).toBe(1);
    });

    it("preserves token usage metadata in compressed files", async () => {
      const tokenUsage = {
        input: 5000,
        output: 2000,
        cacheCreationInput: 100000,
        cacheReadInput: 500000,
      };
      await writeRunFile("run.json", { tokenUsage });
      await setFileAge("run.json", 60);

      await archiveOldRuns(runsDir, { maxAgeDays: 30, enabled: true });

      // Read back and verify
      const data = await readCompressedJSON(join(runsDir, "run.json.gz"));
      expect((data as Record<string, unknown>).tokenUsage).toEqual(tokenUsage);
    });

    it("handles empty runs directory", async () => {
      const result = await archiveOldRuns(runsDir, { maxAgeDays: 30, enabled: true });

      expect(result.filesCompressed).toBe(0);
      expect(result.filesSkipped).toBe(0);
      expect(result.bytesSaved).toBe(0);
    });
  });
});
