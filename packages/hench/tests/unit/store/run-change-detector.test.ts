import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, utimes, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RunChangeDetector,
  type AggregationCheckpoint,
  type RunFileChange,
  type DeltaResult,
} from "../../../src/store/run-change-detector.js";

describe("RunChangeDetector", () => {
  let runsDir: string;
  let tmpBase: string;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), "hench-change-detect-"));
    runsDir = join(tmpBase, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  function detector(): RunChangeDetector {
    return new RunChangeDetector(runsDir);
  }

  async function writeRunFile(name: string, content = '{"id":"test"}'): Promise<void> {
    await writeFile(join(runsDir, name), content, "utf-8");
  }

  /**
   * Write a checkpoint in the pre-hash shape: mtime and size only.
   *
   * Written directly rather than through saveCheckpoint so it cannot pick up
   * whatever the current serializer emits — the point is to read a file that a
   * previous version of hench left behind.
   */
  async function det_saveLegacyCheckpoint(checkpoint: {
    timestamp: string;
    files: Record<string, { mtimeMs: number; size: number }>;
  }): Promise<void> {
    await writeFile(
      join(runsDir, ".aggregation-checkpoint.json"),
      JSON.stringify(checkpoint, null, 2),
      "utf-8",
    );
  }

  // ---------------------------------------------------------------------------
  // Checkpoint persistence
  // ---------------------------------------------------------------------------

  describe("checkpoint persistence", () => {
    it("returns null checkpoint when no checkpoint file exists", async () => {
      const det = detector();
      const checkpoint = await det.loadCheckpoint();
      expect(checkpoint).toBeNull();
    });

    it("saves and loads a checkpoint", async () => {
      const det = detector();
      const checkpoint: AggregationCheckpoint = {
        timestamp: "2026-01-01T00:00:00Z",
        files: {
          "run-1.json": { mtimeMs: 1000, size: 100 },
        },
      };
      await det.saveCheckpoint(checkpoint);
      const loaded = await det.loadCheckpoint();
      expect(loaded).toEqual(checkpoint);
    });

    it("overwrites existing checkpoint on save", async () => {
      const det = detector();
      const first: AggregationCheckpoint = {
        timestamp: "2026-01-01T00:00:00Z",
        files: { "a.json": { mtimeMs: 1, size: 1 } },
      };
      const second: AggregationCheckpoint = {
        timestamp: "2026-01-02T00:00:00Z",
        files: { "b.json": { mtimeMs: 2, size: 2 } },
      };
      await det.saveCheckpoint(first);
      await det.saveCheckpoint(second);
      const loaded = await det.loadCheckpoint();
      expect(loaded).toEqual(second);
    });
  });

  // ---------------------------------------------------------------------------
  // detectChanges — first run (no checkpoint)
  // ---------------------------------------------------------------------------

  describe("first run (no checkpoint)", () => {
    it("reports all existing files as added", async () => {
      await writeRunFile("run-a.json");
      await writeRunFile("run-b.json");

      const det = detector();
      const result = await det.detectChanges();

      expect(result.changes).toHaveLength(2);
      expect(result.changes.every((c) => c.type === "added")).toBe(true);
      const names = result.changes.map((c) => c.file).sort();
      expect(names).toEqual(["run-a.json", "run-b.json"]);
    });

    it("returns empty changes when no run files exist", async () => {
      const det = detector();
      const result = await det.detectChanges();
      expect(result.changes).toHaveLength(0);
      expect(result.checkpoint.files).toEqual({});
    });

    it("ignores non-json files", async () => {
      await writeRunFile("run-a.json");
      await writeFile(join(runsDir, "notes.txt"), "hello", "utf-8");

      const det = detector();
      const result = await det.detectChanges();

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].file).toBe("run-a.json");
    });

    it("ignores the checkpoint file itself", async () => {
      await writeRunFile("run-a.json");
      // Manually create a checkpoint file to ensure it's not picked up as a run
      await writeFile(
        join(runsDir, ".aggregation-checkpoint.json"),
        '{"timestamp":"now","files":{}}',
        "utf-8",
      );

      const det = detector();
      const result = await det.detectChanges();

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].file).toBe("run-a.json");
    });

    it("produces a checkpoint capturing current file state", async () => {
      await writeRunFile("run-a.json", '{"id":"a","big":"data"}');

      const det = detector();
      const result = await det.detectChanges();

      expect(result.checkpoint.timestamp).toBeDefined();
      expect(result.checkpoint.files["run-a.json"]).toBeDefined();
      expect(result.checkpoint.files["run-a.json"].size).toBeGreaterThan(0);
      expect(result.checkpoint.files["run-a.json"].mtimeMs).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // detectChanges — incremental (with checkpoint)
  // ---------------------------------------------------------------------------

  describe("incremental detection", () => {
    it("detects no changes when files are unchanged", async () => {
      await writeRunFile("run-a.json");

      const det = detector();
      const first = await det.detectChanges();
      await det.saveCheckpoint(first.checkpoint);

      const second = await det.detectChanges();
      expect(second.changes).toHaveLength(0);
    });

    it("detects newly added files", async () => {
      await writeRunFile("run-a.json");

      const det = detector();
      const first = await det.detectChanges();
      await det.saveCheckpoint(first.checkpoint);

      // Add a new file
      await writeRunFile("run-b.json");

      const second = await det.detectChanges();
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0]).toEqual(
        expect.objectContaining({ file: "run-b.json", type: "added" }),
      );
    });

    it("detects modified files (size change)", async () => {
      await writeRunFile("run-a.json", '{"id":"a"}');

      const det = detector();
      const first = await det.detectChanges();
      await det.saveCheckpoint(first.checkpoint);

      // Modify the file (different size)
      await writeRunFile("run-a.json", '{"id":"a","extra":"data added here"}');

      const second = await det.detectChanges();
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0]).toEqual(
        expect.objectContaining({ file: "run-a.json", type: "modified" }),
      );
    });

    it("detects modified files (mtime change, same size)", async () => {
      const content = '{"id":"a","pad":"x"}';
      await writeRunFile("run-a.json", content);

      const det = detector();
      const first = await det.detectChanges();
      await det.saveCheckpoint(first.checkpoint);

      // Touch the file to update mtime without changing content
      const futureTime = new Date(Date.now() + 5000);
      await utimes(join(runsDir, "run-a.json"), futureTime, futureTime);

      const second = await det.detectChanges();
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0]).toEqual(
        expect.objectContaining({ file: "run-a.json", type: "modified" }),
      );
    });

    it("detects a same-size rewrite whose mtime did not advance", async () => {
      // The hazard mtime+size alone cannot see. Windows advances file timestamps in
      // ticks rather than continuously — measured on NTFS, 163 of 200 back-to-back
      // same-size rewrites produced a byte-identical mtimeMs — so a rewrite of the
      // same LENGTH inside one tick leaves both values unchanged and the stale
      // contribution is kept.
      //
      // utimes pins the mtime back to its earlier value, reproducing that collision
      // deterministically and on every platform, so this asserts the contract rather
      // than the host's timer resolution. Both payloads are the same length by
      // construction — a size change would mask the problem.
      const runFile = join(runsDir, "run-a.json");
      await writeRunFile("run-a.json", '{"id":"aaa"}');

      // Pin BEFORE the first read as well as after the rewrite: a fresh write leaves
      // a fractional mtimeMs while utimes stores whole milliseconds, so pinning only
      // the second write would leave the snapshots different and the change would be
      // detected for the wrong reason.
      const pinned = new Date(Math.floor((await stat(runFile)).mtimeMs));
      await utimes(runFile, pinned, pinned);

      const det = detector();
      const first = await det.detectChanges();
      await det.saveCheckpoint(first.checkpoint);

      const before = await stat(runFile);
      await writeRunFile("run-a.json", '{"id":"bbb"}');
      await utimes(runFile, pinned, pinned);
      const after = await stat(runFile);

      // The precondition IS the hazard: identical length, identical mtime.
      expect(after.size).toBe(before.size);
      expect(after.mtimeMs).toBe(before.mtimeMs);

      const second = await det.detectChanges();
      expect(second.changes).toEqual([
        expect.objectContaining({ file: "run-a.json", type: "modified" }),
      ]);
    });

    it("treats an unreadable file as no evidence of change, not as a change", async () => {
      // `hashFile` returns null when the bytes cannot be read, and its docblock
      // says the caller treats that as "no usable hash" rather than as a change.
      // The caller did the opposite: the comparison guarded the PREVIOUS hash
      // against null but not the new one, so a previously-hashed file whose read
      // now fails compared `"abc" !== null` and was reported modified.
      //
      // A null hash is the absence of evidence. The file's mtime and size are
      // unchanged, so there is nothing to suggest it was rewritten — only that
      // this scan could not check.
      const runFile = join(runsDir, "run-a.json");
      await writeRunFile("run-a.json", '{"id":"aaa"}');
      const pinned = new Date(Math.floor((await stat(runFile)).mtimeMs));
      await utimes(runFile, pinned, pinned);

      const det = detector();
      const first = await det.detectChanges();
      await det.saveCheckpoint(first.checkpoint);

      // Precondition: the checkpoint really is carrying a hash, so this exercises
      // the branch it is meant to. Without it the case could pass vacuously.
      expect(typeof first.checkpoint.files["run-a.json"]?.contentHash).toBe("string");

      // The read fails while stat still succeeds — a locked file, a permissions
      // change, an I/O error. Injected because reproducing it from the filesystem
      // is platform-specific, while the branch under test is not.
      const failing = det as unknown as { hashFile: (file: string) => Promise<string | null> };
      const realHashFile = failing.hashFile.bind(failing);
      failing.hashFile = async () => null;

      const second = await det.detectChanges();
      expect(second.changes).toEqual([]);

      // And once the file can be read again, with the same bytes, it is still not
      // a change — the unreadable scan must not have poisoned the checkpoint.
      failing.hashFile = realHashFile;
      await det.saveCheckpoint(second.checkpoint);
      const third = await det.detectChanges();
      expect(third.changes).toEqual([]);
    });

    it("carries a hash only while the mtime is fresh, then drops it", async () => {
      // The hash exists solely for the window where mtime cannot settle the
      // question. If it were carried forever, every scan would read every run file
      // and the checkpoint would stop being a cheap stat comparison. Asserting the
      // DROP is what proves the steady state converges — merely asserting "no hash
      // on an old file" would also pass if hashing did not exist at all.
      const runFile = join(runsDir, "run-a.json");
      await writeRunFile("run-a.json", '{"id":"aaa"}');

      const det = detector();
      const fresh = await det.detectChanges();
      // Just written, so inside the granularity window: hash carried.
      expect(typeof fresh.checkpoint.files["run-a.json"]?.contentHash).toBe("string");
      expect(fresh.checkpoint.files["run-a.json"]?.mtimeMayBeShared).toBe(true);
      await det.saveCheckpoint(fresh.checkpoint);

      // Age the file well past the bound; mtime is now trustworthy on its own.
      const old = new Date(Date.now() - 60_000);
      await utimes(runFile, old, old);

      const aged = await det.detectChanges();
      expect(aged.checkpoint.files["run-a.json"]?.contentHash ?? null).toBeNull();
      expect(aged.checkpoint.files["run-a.json"]?.mtimeMayBeShared ?? false).toBe(false);
    });

    it("reads a checkpoint written before content hashing existed", async () => {
      // Checkpoints are persisted JSON, so older ones carry only mtime and size.
      // They must keep working: an old checkpoint's mtime is by definition old
      // enough to trust, so the absence of a hash is not a reason to re-read.
      const runFile = join(runsDir, "run-a.json");
      await writeRunFile("run-a.json", '{"id":"aaa"}');
      const st = await stat(runFile);

      await det_saveLegacyCheckpoint({
        timestamp: new Date().toISOString(),
        files: { "run-a.json": { mtimeMs: st.mtimeMs, size: st.size } },
      });

      const result = await detector().detectChanges();
      expect(result.changes).toEqual([]);
    });

    it("detects deleted files", async () => {
      await writeRunFile("run-a.json");
      await writeRunFile("run-b.json");

      const det = detector();
      const first = await det.detectChanges();
      await det.saveCheckpoint(first.checkpoint);

      // Delete one file
      await unlink(join(runsDir, "run-a.json"));

      const second = await det.detectChanges();
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0]).toEqual(
        expect.objectContaining({ file: "run-a.json", type: "deleted" }),
      );
    });

    it("handles mixed changes: add, modify, delete", async () => {
      await writeRunFile("run-a.json", '{"id":"a"}');
      await writeRunFile("run-b.json", '{"id":"b"}');

      const det = detector();
      const first = await det.detectChanges();
      await det.saveCheckpoint(first.checkpoint);

      // Delete run-a, modify run-b, add run-c
      await unlink(join(runsDir, "run-a.json"));
      await writeRunFile("run-b.json", '{"id":"b","modified":true}');
      await writeRunFile("run-c.json", '{"id":"c"}');

      const second = await det.detectChanges();
      expect(second.changes).toHaveLength(3);

      const byFile = new Map(second.changes.map((c) => [c.file, c.type]));
      expect(byFile.get("run-a.json")).toBe("deleted");
      expect(byFile.get("run-b.json")).toBe("modified");
      expect(byFile.get("run-c.json")).toBe("added");
    });

    it("new checkpoint excludes deleted files", async () => {
      await writeRunFile("run-a.json");
      await writeRunFile("run-b.json");

      const det = detector();
      const first = await det.detectChanges();
      await det.saveCheckpoint(first.checkpoint);

      await unlink(join(runsDir, "run-a.json"));

      const second = await det.detectChanges();
      expect(second.checkpoint.files).not.toHaveProperty("run-a.json");
      expect(second.checkpoint.files).toHaveProperty("run-b.json");
    });
  });

  // ---------------------------------------------------------------------------
  // hasChanges convenience method
  // ---------------------------------------------------------------------------

  describe("hasChanges", () => {
    it("returns true when there are changes", async () => {
      await writeRunFile("run-a.json");

      const det = detector();
      expect(await det.hasChanges()).toBe(true);
    });

    it("returns false when nothing changed since checkpoint", async () => {
      await writeRunFile("run-a.json");

      const det = detector();
      const result = await det.detectChanges();
      await det.saveCheckpoint(result.checkpoint);

      expect(await det.hasChanges()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // changedFiles helper
  // ---------------------------------------------------------------------------

  describe("changedFiles", () => {
    it("returns only added and modified files (not deleted)", async () => {
      await writeRunFile("run-a.json");
      await writeRunFile("run-b.json");
      await writeRunFile("run-c.json");

      const det = detector();
      const first = await det.detectChanges();
      await det.saveCheckpoint(first.checkpoint);

      await unlink(join(runsDir, "run-a.json"));
      await writeRunFile("run-b.json", '{"id":"b","changed":true}');
      await writeRunFile("run-d.json");

      const result = await det.detectChanges();
      const files = RunChangeDetector.changedFiles(result);

      expect(files).toHaveLength(2);
      expect(files.sort()).toEqual(["run-b.json", "run-d.json"]);
    });
  });

  // ---------------------------------------------------------------------------
  // deletedFiles helper
  // ---------------------------------------------------------------------------

  describe("deletedFiles", () => {
    it("returns only deleted files", async () => {
      await writeRunFile("run-a.json");
      await writeRunFile("run-b.json");

      const det = detector();
      const first = await det.detectChanges();
      await det.saveCheckpoint(first.checkpoint);

      await unlink(join(runsDir, "run-a.json"));

      const result = await det.detectChanges();
      const deleted = RunChangeDetector.deletedFiles(result);

      expect(deleted).toEqual(["run-a.json"]);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles missing runs directory gracefully", async () => {
      const missingDir = join(tmpBase, "missing", "runs");
      const det = new RunChangeDetector(missingDir);

      const result = await det.detectChanges();
      expect(result.changes).toHaveLength(0);
      expect(result.checkpoint.files).toEqual({});
    });

    it("handles corrupted checkpoint file gracefully", async () => {
      await writeRunFile("run-a.json");
      await writeFile(
        join(runsDir, ".aggregation-checkpoint.json"),
        "not valid json{{{",
        "utf-8",
      );

      const det = detector();
      // Should fall back to treating all files as new
      const result = await det.detectChanges();
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].type).toBe("added");
    });

    it("handles checkpoint with stale entries for files that were already deleted", async () => {
      // Save a checkpoint referencing a file that no longer exists
      const det = detector();
      const staleCheckpoint: AggregationCheckpoint = {
        timestamp: "2026-01-01T00:00:00Z",
        files: {
          "ghost.json": { mtimeMs: 1000, size: 50 },
        },
      };
      await det.saveCheckpoint(staleCheckpoint);

      const result = await det.detectChanges();
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toEqual(
        expect.objectContaining({ file: "ghost.json", type: "deleted" }),
      );
    });
  });
});
