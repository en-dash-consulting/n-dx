import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { saveRun, loadRun, listRuns } from "../../../src/store/runs.js";
import type { RunRecord } from "../../../src/schema/v1.js";

describe("runs store — compressed file support", () => {
  let tmpBase: string;
  let henchDir: string;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), "hench-compressed-runs-"));
    henchDir = join(tmpBase, ".n-dx/hench");
    await mkdir(join(henchDir, "runs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  function makeRun(overrides: Partial<RunRecord> & { id: string }): RunRecord {
    return {
      taskId: "task-1",
      taskTitle: "Test task",
      startedAt: "2025-01-01T00:00:00Z",
      status: "completed",
      turns: 1,
      tokenUsage: { input: 100, output: 50 },
      toolCalls: [],
      model: "sonnet",
      ...overrides,
    };
  }

  /** Write a run as a gzip-compressed .json.gz file. */
  async function writeCompressedRun(run: RunRecord): Promise<void> {
    const json = JSON.stringify(run);
    const compressed = gzipSync(Buffer.from(json, "utf-8"));
    await writeFile(join(henchDir, "runs", `${run.id}.json.gz`), compressed);
  }

  // ---------------------------------------------------------------------------
  // loadRun
  // ---------------------------------------------------------------------------

  describe("loadRun", () => {
    it("loads a plain .json run file", async () => {
      const run = makeRun({ id: "plain-run" });
      await saveRun(henchDir, run);

      const loaded = await loadRun(henchDir, "plain-run");
      expect(loaded.id).toBe("plain-run");
      expect(loaded.tokenUsage).toEqual({ input: 100, output: 50 });
    });

    it("loads a compressed .json.gz run file", async () => {
      const run = makeRun({
        id: "compressed-run",
        tokenUsage: { input: 5000, output: 2000, cacheCreationInput: 100, cacheReadInput: 200 },
      });
      await writeCompressedRun(run);

      const loaded = await loadRun(henchDir, "compressed-run");
      expect(loaded.id).toBe("compressed-run");
      expect(loaded.tokenUsage).toEqual({
        input: 5000,
        output: 2000,
        cacheCreationInput: 100,
        cacheReadInput: 200,
      });
    });

    it("prefers .json over .json.gz when both exist", async () => {
      const plainRun = makeRun({ id: "dual-run", taskTitle: "Plain version" });
      const compressedRun = makeRun({ id: "dual-run", taskTitle: "Compressed version" });

      await saveRun(henchDir, plainRun);
      await writeCompressedRun(compressedRun);

      const loaded = await loadRun(henchDir, "dual-run");
      expect(loaded.taskTitle).toBe("Plain version");
    });

    it("throws for non-existent run (neither .json nor .json.gz)", async () => {
      await expect(loadRun(henchDir, "nonexistent")).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // listRuns
  // ---------------------------------------------------------------------------

  describe("listRuns", () => {
    it("lists both plain and compressed runs", async () => {
      await saveRun(henchDir, makeRun({ id: "plain", startedAt: "2025-01-01T00:00:00Z" }));
      await writeCompressedRun(makeRun({ id: "compressed", startedAt: "2025-01-02T00:00:00Z" }));

      const runs = await listRuns(henchDir);
      expect(runs).toHaveLength(2);
      const ids = runs.map((r) => r.id);
      expect(ids).toContain("plain");
      expect(ids).toContain("compressed");
    });

    it("deduplicates runs with both .json and .json.gz", async () => {
      const run = makeRun({ id: "both-formats" });
      await saveRun(henchDir, run);
      await writeCompressedRun(run);

      const runs = await listRuns(henchDir);
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe("both-formats");
    });

    it("sorts by startedAt descending (mixed formats)", async () => {
      await saveRun(henchDir, makeRun({ id: "old", startedAt: "2025-01-01T00:00:00Z" }));
      await writeCompressedRun(makeRun({ id: "middle", startedAt: "2025-01-15T00:00:00Z" }));
      await saveRun(henchDir, makeRun({ id: "new", startedAt: "2025-02-01T00:00:00Z" }));

      const runs = await listRuns(henchDir);
      expect(runs.map((r) => r.id)).toEqual(["new", "middle", "old"]);
    });

    it("respects limit with mixed formats", async () => {
      await saveRun(henchDir, makeRun({ id: "a", startedAt: "2025-01-01T00:00:00Z" }));
      await writeCompressedRun(makeRun({ id: "b", startedAt: "2025-01-02T00:00:00Z" }));
      await saveRun(henchDir, makeRun({ id: "c", startedAt: "2025-01-03T00:00:00Z" }));

      const runs = await listRuns(henchDir, 2);
      expect(runs).toHaveLength(2);
    });

    it("ignores hidden files", async () => {
      await saveRun(henchDir, makeRun({ id: "valid" }));
      await writeFile(
        join(henchDir, "runs", ".hidden.json"),
        '{"not":"a run"}',
        "utf-8",
      );

      const runs = await listRuns(henchDir);
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe("valid");
    });
  });
});
