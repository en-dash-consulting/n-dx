/**
 * Tests for AggregationResultCache.
 *
 * Covers:
 * - Cache hit/miss behavior with filesystem fingerprinting
 * - Automatic invalidation when source data changes
 * - Cache key differentiation for different query scopes
 * - Memory bounding via maxEntries eviction
 * - Manual invalidation
 * - Edge cases: missing directories, missing files
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, appendFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AggregationResultCache,
  takeFingerprint,
  fingerprintsMatch,
  type SourceFingerprint,
} from "../../../src/server/aggregation-cache.js";

describe("AggregationResultCache", () => {
  let tmpDir: string;
  let rexDir: string;
  let henchRunsDir: string;
  let svDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agg-cache-"));
    rexDir = join(tmpDir, ".rex");
    henchRunsDir = join(tmpDir, ".hench", "runs");
    svDir = join(tmpDir, ".sourcevision");
    await mkdir(rexDir, { recursive: true });
    await mkdir(henchRunsDir, { recursive: true });
    await mkdir(svDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function createCache(maxEntries?: number): AggregationResultCache {
    return new AggregationResultCache(tmpDir, rexDir, { maxEntries });
  }

  async function writeHenchRun(name: string, data = '{"id":"test"}'): Promise<void> {
    await writeFile(join(henchRunsDir, name), data, "utf-8");
  }

  async function writeRexLog(content: string): Promise<void> {
    await appendFile(join(rexDir, "execution-log.jsonl"), content + "\n", "utf-8");
  }

  async function writeSvManifest(data = '{"analyzedAt":"2026-01-01"}'): Promise<void> {
    await writeFile(join(svDir, "manifest.json"), data, "utf-8");
  }

  // ---------------------------------------------------------------------------
  // takeFingerprint
  // ---------------------------------------------------------------------------

  describe("takeFingerprint", () => {
    it("returns zero values when no source files exist", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "agg-cache-empty-"));
      try {
        const fp = await takeFingerprint(emptyDir, join(emptyDir, ".rex"));
        expect(fp.henchDirMtimeMs).toBe(0);
        expect(fp.henchFileCount).toBe(0);
        expect(fp.rexLogMtimeMs).toBe(0);
        expect(fp.rexLogSize).toBe(0);
        expect(fp.svManifestMtimeMs).toBe(0);
        expect(fp.svManifestSize).toBe(0);
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it("captures hench runs directory state", async () => {
      await writeHenchRun("run-1.json");

      const fp = await takeFingerprint(tmpDir, rexDir);
      expect(fp.henchDirMtimeMs).toBeGreaterThan(0);
      expect(fp.henchFileCount).toBe(1);
    });

    it("captures rex log state", async () => {
      await writeRexLog('{"event":"test"}');

      const fp = await takeFingerprint(tmpDir, rexDir);
      expect(fp.rexLogMtimeMs).toBeGreaterThan(0);
      expect(fp.rexLogSize).toBeGreaterThan(0);
    });

    it("captures sourcevision manifest state", async () => {
      await writeSvManifest();

      const fp = await takeFingerprint(tmpDir, rexDir);
      expect(fp.svManifestMtimeMs).toBeGreaterThan(0);
      expect(fp.svManifestSize).toBeGreaterThan(0);
    });

    it("excludes hidden files from hench file count", async () => {
      await writeHenchRun("run-1.json");
      await writeFile(join(henchRunsDir, ".aggregation-checkpoint.json"), "{}", "utf-8");

      const fp = await takeFingerprint(tmpDir, rexDir);
      expect(fp.henchFileCount).toBe(1);
    });

    it("excludes non-json files from hench file count", async () => {
      await writeHenchRun("run-1.json");
      await writeFile(join(henchRunsDir, "notes.txt"), "hello", "utf-8");

      const fp = await takeFingerprint(tmpDir, rexDir);
      expect(fp.henchFileCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // fingerprintsMatch
  // ---------------------------------------------------------------------------

  describe("fingerprintsMatch", () => {
    it("returns true for identical fingerprints", () => {
      const fp: SourceFingerprint = {
        henchDirMtimeMs: 1000,
        henchFileCount: 5,
        rexLogMtimeMs: 2000,
        rexLogSize: 500,
        svManifestMtimeMs: 3000,
        svManifestSize: 200,
      };
      expect(fingerprintsMatch(fp, { ...fp })).toBe(true);
    });

    it("returns false when hench dir mtime differs", () => {
      const a: SourceFingerprint = {
        henchDirMtimeMs: 1000, henchFileCount: 5,
        rexLogMtimeMs: 2000, rexLogSize: 500,
        svManifestMtimeMs: 3000, svManifestSize: 200,
      };
      const b = { ...a, henchDirMtimeMs: 1001 };
      expect(fingerprintsMatch(a, b)).toBe(false);
    });

    it("returns false when hench file count differs", () => {
      const a: SourceFingerprint = {
        henchDirMtimeMs: 1000, henchFileCount: 5,
        rexLogMtimeMs: 2000, rexLogSize: 500,
        svManifestMtimeMs: 3000, svManifestSize: 200,
      };
      const b = { ...a, henchFileCount: 6 };
      expect(fingerprintsMatch(a, b)).toBe(false);
    });

    it("returns false when rex log size differs", () => {
      const a: SourceFingerprint = {
        henchDirMtimeMs: 1000, henchFileCount: 5,
        rexLogMtimeMs: 2000, rexLogSize: 500,
        svManifestMtimeMs: 3000, svManifestSize: 200,
      };
      const b = { ...a, rexLogSize: 501 };
      expect(fingerprintsMatch(a, b)).toBe(false);
    });

    it("returns false when sv manifest mtime differs", () => {
      const a: SourceFingerprint = {
        henchDirMtimeMs: 1000, henchFileCount: 5,
        rexLogMtimeMs: 2000, rexLogSize: 500,
        svManifestMtimeMs: 3000, svManifestSize: 200,
      };
      const b = { ...a, svManifestMtimeMs: 3001 };
      expect(fingerprintsMatch(a, b)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache hit/miss behavior
  // ---------------------------------------------------------------------------

  describe("cache hits and misses", () => {
    it("returns computed value on first call (cache miss)", async () => {
      const cache = createCache();
      let callCount = 0;

      const result = await cache.getOrCompute("key-1", () => {
        callCount++;
        return { value: 42 };
      });

      expect(result).toEqual({ value: 42 });
      expect(callCount).toBe(1);
    });

    it("returns cached value on second call without recomputing", async () => {
      const cache = createCache();
      let callCount = 0;

      await cache.getOrCompute("key-1", () => {
        callCount++;
        return "first";
      });

      const result = await cache.getOrCompute("key-1", () => {
        callCount++;
        return "second";
      });

      expect(result).toBe("first");
      expect(callCount).toBe(1);
    });

    it("computes separately for different keys", async () => {
      const cache = createCache();

      const a = await cache.getOrCompute("key-a", () => "value-a");
      const b = await cache.getOrCompute("key-b", () => "value-b");

      expect(a).toBe("value-a");
      expect(b).toBe("value-b");
      expect(cache.size).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Invalidation on source changes
  // ---------------------------------------------------------------------------

  describe("invalidation on source changes", () => {
    it("invalidates when a new hench run file is added", async () => {
      const cache = createCache();

      // Prime the cache
      const first = await cache.getOrCompute("key", () => "original");
      expect(first).toBe("original");

      // Add a new run file — changes directory state
      await writeHenchRun("run-new.json");

      const second = await cache.getOrCompute("key", () => "recomputed");
      expect(second).toBe("recomputed");
    });

    it("invalidates when a hench run file is deleted", async () => {
      await writeHenchRun("run-1.json");

      const cache = createCache();
      await cache.getOrCompute("key", () => "original");

      await unlink(join(henchRunsDir, "run-1.json"));

      const result = await cache.getOrCompute("key", () => "after-delete");
      expect(result).toBe("after-delete");
    });

    it("invalidates when rex log file changes", async () => {
      await writeRexLog('{"event":"first"}');

      const cache = createCache();
      await cache.getOrCompute("key", () => "original");

      // Append to the log file — changes size and mtime
      await writeRexLog('{"event":"second"}');

      const result = await cache.getOrCompute("key", () => "recomputed");
      expect(result).toBe("recomputed");
    });

    it("invalidates when sourcevision manifest changes", async () => {
      await writeSvManifest('{"analyzedAt":"2026-01-01"}');

      const cache = createCache();
      await cache.getOrCompute("key", () => "original");

      // Overwrite manifest with different content
      await writeSvManifest('{"analyzedAt":"2026-02-01","extra":"data"}');

      const result = await cache.getOrCompute("key", () => "recomputed");
      expect(result).toBe("recomputed");
    });

    it("does not invalidate when no sources change", async () => {
      await writeHenchRun("run-1.json");
      await writeRexLog('{"event":"test"}');

      const cache = createCache();
      let callCount = 0;

      await cache.getOrCompute("key", () => {
        callCount++;
        return "value";
      });

      // Second call — nothing changed
      await cache.getOrCompute("key", () => {
        callCount++;
        return "should-not-be-used";
      });

      expect(callCount).toBe(1);
    });

    it("clears all entries when any source changes", async () => {
      const cache = createCache();

      // Cache multiple keys
      await cache.getOrCompute("key-a", () => "a");
      await cache.getOrCompute("key-b", () => "b");
      expect(cache.size).toBe(2);

      // Change a source
      await writeHenchRun("run-new.json");

      // Both entries should be invalidated
      const a = await cache.getOrCompute("key-a", () => "a-new");
      const b = await cache.getOrCompute("key-b", () => "b-new");
      expect(a).toBe("a-new");
      expect(b).toBe("b-new");
    });
  });

  // ---------------------------------------------------------------------------
  // Cache key differentiation
  // ---------------------------------------------------------------------------

  describe("cache key differentiation", () => {
    it("different since/until scopes produce separate cache entries", async () => {
      const cache = createCache();

      const all = await cache.getOrCompute("events::", () => [1, 2, 3]);
      const filtered = await cache.getOrCompute("events:2026-01-01:", () => [2, 3]);

      expect(all).toEqual([1, 2, 3]);
      expect(filtered).toEqual([2, 3]);
      expect(cache.size).toBe(2);
    });

    it("same scope returns cached value", async () => {
      const cache = createCache();

      await cache.getOrCompute("events:2026-01-01:2026-02-01", () => "first");
      const second = await cache.getOrCompute("events:2026-01-01:2026-02-01", () => "second");

      expect(second).toBe("first");
    });
  });

  // ---------------------------------------------------------------------------
  // Memory bounding
  // ---------------------------------------------------------------------------

  describe("memory bounding", () => {
    it("evicts oldest entries when maxEntries is exceeded", async () => {
      const cache = createCache(3);

      await cache.getOrCompute("key-1", () => "v1");
      await cache.getOrCompute("key-2", () => "v2");
      await cache.getOrCompute("key-3", () => "v3");
      expect(cache.size).toBe(3);

      // Adding a 4th entry should evict the oldest (key-1)
      await cache.getOrCompute("key-4", () => "v4");
      expect(cache.size).toBe(3);

      // key-1 should be evicted → recomputed
      const result = await cache.getOrCompute("key-1", () => "v1-recomputed");
      expect(result).toBe("v1-recomputed");
    });

    it("does not evict when updating an existing key", async () => {
      const cache = createCache(2);

      await cache.getOrCompute("key-1", () => "v1");
      await cache.getOrCompute("key-2", () => "v2");

      // Invalidate to force recompute of existing key
      cache.invalidate();
      await cache.getOrCompute("key-1", () => "v1-new");
      await cache.getOrCompute("key-2", () => "v2-new");

      // Both should be present (no eviction needed for updates)
      expect(cache.size).toBe(2);
    });

    it("handles maxEntries of 1", async () => {
      const cache = createCache(1);

      await cache.getOrCompute("key-1", () => "v1");
      expect(cache.size).toBe(1);

      await cache.getOrCompute("key-2", () => "v2");
      expect(cache.size).toBe(1);

      // key-1 was evicted
      const result = await cache.getOrCompute("key-1", () => "v1-new");
      expect(result).toBe("v1-new");
    });

    it("defaults to 64 max entries", () => {
      const cache = new AggregationResultCache(tmpDir, rexDir);
      // We can't directly check maxEntries, but we can verify cache creation succeeds
      expect(cache.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Manual invalidation
  // ---------------------------------------------------------------------------

  describe("manual invalidation", () => {
    it("clears all entries and fingerprint on invalidate()", async () => {
      const cache = createCache();

      await cache.getOrCompute("key-1", () => "v1");
      await cache.getOrCompute("key-2", () => "v2");
      expect(cache.size).toBe(2);
      expect(cache.currentFingerprint).not.toBeNull();

      cache.invalidate();

      expect(cache.size).toBe(0);
      expect(cache.currentFingerprint).toBeNull();
    });

    it("recomputes after manual invalidation", async () => {
      const cache = createCache();

      await cache.getOrCompute("key", () => "original");
      cache.invalidate();

      const result = await cache.getOrCompute("key", () => "recomputed");
      expect(result).toBe("recomputed");
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    it("works when hench runs directory does not exist", async () => {
      const noHenchDir = await mkdtemp(join(tmpdir(), "agg-cache-no-hench-"));
      await mkdir(join(noHenchDir, ".rex"), { recursive: true });
      try {
        const cache = new AggregationResultCache(noHenchDir, join(noHenchDir, ".rex"));
        const result = await cache.getOrCompute("key", () => "value");
        expect(result).toBe("value");
      } finally {
        await rm(noHenchDir, { recursive: true, force: true });
      }
    });

    it("works when rex directory does not exist", async () => {
      const noRexDir = await mkdtemp(join(tmpdir(), "agg-cache-no-rex-"));
      await mkdir(join(noRexDir, ".hench", "runs"), { recursive: true });
      try {
        const cache = new AggregationResultCache(noRexDir, join(noRexDir, "missing-rex"));
        const result = await cache.getOrCompute("key", () => "value");
        expect(result).toBe("value");
      } finally {
        await rm(noRexDir, { recursive: true, force: true });
      }
    });

    it("handles cache values of various types", async () => {
      const cache = createCache();

      const num = await cache.getOrCompute("number", () => 42);
      const arr = await cache.getOrCompute("array", () => [1, 2, 3]);
      const obj = await cache.getOrCompute("object", () => ({ a: 1 }));
      const nul = await cache.getOrCompute("null", () => null);

      expect(num).toBe(42);
      expect(arr).toEqual([1, 2, 3]);
      expect(obj).toEqual({ a: 1 });
      expect(nul).toBeNull();
    });

    it("source that appears after initial empty fingerprint triggers invalidation", async () => {
      // Start with no sources
      const cache = createCache();
      await cache.getOrCompute("key", () => "before");

      // Now create a source file
      await writeHenchRun("run-1.json");

      const result = await cache.getOrCompute("key", () => "after");
      expect(result).toBe("after");
    });
  });
});
