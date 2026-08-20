/**
 * Incremental task usage aggregator.
 *
 * Maintains an in-memory cache of per-task token usage aggregation.
 * On each refresh, only processes new/modified run files using
 * mtime+size change detection, keeping aggregation time constant
 * regardless of total run history size.
 *
 * ## Design
 *
 * Each run file's contribution (taskId + totalTokens) is tracked
 * individually so that modifications and deletions can be applied
 * as incremental deltas rather than requiring a full re-scan.
 *
 * Change detection uses mtime + file size — the same strategy as
 * hench's `RunChangeDetector` — to avoid reading unchanged files, with the
 * caveat below.
 *
 * ## Why mtime + size alone is not sufficient
 *
 * On Windows, file timestamps advance in ticks rather than continuously, so a
 * rewrite of the same LENGTH inside one tick leaves both mtime and size
 * unchanged and is therefore invisible. That is not hypothetical: a run record
 * rewritten in place with an equal-length edit (a taskId or status swap) would
 * keep its old contribution, so tokens stay attributed to the wrong task until
 * some later change to that file forces a re-read.
 *
 * So mtime is trusted only once it is older than {@link MTIME_GRANULARITY_MS}. In
 * the window where it cannot be trusted, the snapshot also carries a hash of the
 * file's bytes and change detection falls back to comparing that. The hash is
 * dropped as soon as the mtime ages out, so the steady state remains stat-only:
 * a file is hashed for the scan or two after its last write and never again.
 *
 * Hashing unconditionally would close the same hole but defeat the design, since
 * it means reading every unchanged file on every scan. Treating a fresh file as
 * outright MODIFIED is also wrong, and was tried first: it re-subtracts and
 * re-adds a contribution that did not change, which resurrects entries that
 * `pruneStaleEntries` had removed and mutates the accumulator objects handed out
 * by a previous `getTaskUsage()` call. Comparing content is the version that
 * leaves unchanged files genuinely untouched.
 *
 * KNOWN LIMITATION: a file whose mtime is deliberately moved BACKWARDS (utimes)
 * to an already-trusted value still reads as unchanged. Only the tests do that,
 * and they do it on purpose to reproduce the tick collision.
 *
 * TWIN: hench's `RunChangeDetector` applies the same rule, and the two are
 * deliberately NOT shared — see that file's docblock for the reasoning. The short
 * version: no module both packages can import is an appropriate home, and unlike
 * the `quoteWindowsToken` twin these two never need to agree with each other, so
 * there is nothing for a parity test to assert. Each side carries its own
 * utimes-pinned test instead. A third copy of this rule should trigger a rethink.
 *
 * @module web/server/task-usage/incremental-task-usage
 */

import { join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { TaskUsageAccumulator } from "../shared-types.js";

export type { TaskUsageAccumulator } from "../shared-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How far apart two writes must be before the filesystem is guaranteed to give
 * them different mtimes.
 *
 * Windows advances file timestamps in ticks rather than continuously: measured on
 * NTFS, gaps between consecutive distinct mtimes ran up to 10ms, and 163 of 200
 * back-to-back same-size rewrites produced a byte-identical mtimeMs. 16ms is the
 * documented system-timer tick and covers the measured worst case with margin.
 * ext4 records nanoseconds, so on Linux this bound is simply never reached.
 */
const MTIME_GRANULARITY_MS = 16;

/** Filesystem snapshot of a single run file. */
interface FileSnapshot {
  mtimeMs: number;
  size: number;
  /**
   * True when this snapshot was taken so soon after the file's own mtime that a
   * later write could reuse that same mtime — in which case an unchanged
   * (mtime, size) pair on the next scan proves nothing. See
   * {@link MTIME_GRANULARITY_MS}.
   */
  mtimeMayBeShared: boolean;
  /**
   * Digest of the file's bytes, carried only while `mtimeMayBeShared` holds — the
   * one window where mtime cannot settle the question. It is what makes an
   * equal-length, equal-mtime rewrite visible.
   *
   * Null once the mtime is old enough to be trusted, so the steady state is
   * stat-only: a file is hashed for the scan or two following its last write and
   * never again.
   */
  contentHash: string | null;
}

/** A single run file's contribution to task usage aggregation. */
interface FileContribution {
  taskId: string;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// IncrementalTaskUsageAggregator
// ---------------------------------------------------------------------------

/**
 * Incrementally aggregates per-task token usage from `.hench/runs/` files.
 *
 * First call processes all existing run files (full scan). Subsequent calls
 * detect filesystem changes via mtime+size comparison (plus a content hash
 * inside the timestamp-granularity window) and only read the files that were
 * added, modified, or deleted — keeping aggregation time constant regardless of
 * total run history size.
 *
 * Usage:
 * ```ts
 * const aggregator = new IncrementalTaskUsageAggregator(runsDir);
 * const usage = await aggregator.getTaskUsage();
 * // { "task-123": { totalTokens: 5000, runCount: 2 }, ... }
 * ```
 */
export class IncrementalTaskUsageAggregator {
  private readonly runsDir: string;

  /** Current snapshot of each file's mtime, size, and freshness. */
  private fileSnapshots = new Map<string, FileSnapshot>();

  /** Per-file contribution to the aggregation (for subtract-on-change). */
  private fileContributions = new Map<string, FileContribution>();

  /** Aggregated usage per task ID. */
  private taskUsage = new Map<string, TaskUsageAccumulator>();

  /** Whether the initial full scan has been completed. */
  private initialized = false;

  constructor(runsDir: string) {
    this.runsDir = runsDir;
  }

  /**
   * Get current per-task token usage, incrementally updating from filesystem.
   *
   * First call processes all files; subsequent calls only process changes.
   * Returns a plain object keyed by task ID.
   */
  async getTaskUsage(): Promise<Record<string, TaskUsageAccumulator>> {
    await this.refresh();
    return Object.fromEntries(this.taskUsage);
  }

  /**
   * Return one entry per cached run-file contribution, shaped for
   * `aggregateItemTokenUsage` (rex's pure rollup function).
   *
   * Only `tokens.total` is populated from cache (input/output/cached
   * breakdowns aren't retained by the incremental aggregator — they
   * aren't needed for the per-item rollup totals the dashboard consumes).
   * Run count is reflected by the number of returned entries since each
   * contribution corresponds to one run file.
   *
   * The caller MUST `await getTaskUsage()` first (or call `refresh()`
   * indirectly) to ensure the cache reflects the current filesystem.
   */
  getFileContributions(): Array<{ itemId: string; tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number } }> {
    const out: Array<{ itemId: string; tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number } }> = [];
    for (const c of this.fileContributions.values()) {
      out.push({
        itemId: c.taskId,
        tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: c.totalTokens },
      });
    }
    return out;
  }

  /**
   * Force a full rebuild on the next `getTaskUsage()` call.
   * Useful for testing or when external state is known to have changed.
   */
  reset(): void {
    this.fileSnapshots.clear();
    this.fileContributions.clear();
    this.taskUsage.clear();
    this.initialized = false;
  }

  /**
   * Remove aggregation entries for task IDs not present in `validTaskIds`.
   *
   * Cleans up both the `taskUsage` accumulator and corresponding
   * `fileContributions` entries. File snapshots are preserved so that
   * the underlying run files are not re-processed on the next refresh
   * (they are still on disk, just no longer contributing to results).
   *
   * Call this after `getTaskUsage()` — or let the route handler call it
   * before returning results — to ensure the UI never sees usage data
   * for tasks that have been deleted from the PRD.
   *
   * @returns The number of stale task IDs that were pruned.
   */
  pruneStaleEntries(validTaskIds: Set<string>): number {
    // Identify stale task IDs
    const staleIds: string[] = [];
    for (const taskId of this.taskUsage.keys()) {
      if (!validTaskIds.has(taskId)) {
        staleIds.push(taskId);
      }
    }

    if (staleIds.length === 0) return 0;

    const staleSet = new Set(staleIds);

    // Remove from taskUsage
    for (const taskId of staleIds) {
      this.taskUsage.delete(taskId);
    }

    // Remove matching fileContributions (but keep fileSnapshots so
    // the run files are not treated as "new" on the next refresh)
    for (const [file, contribution] of this.fileContributions) {
      if (staleSet.has(contribution.taskId)) {
        this.fileContributions.delete(file);
      }
    }

    return staleIds.length;
  }

  // ---- Core refresh logic --------------------------------------------------

  private async refresh(): Promise<void> {
    const currentFiles = await this.scanRunFiles();

    // Categorize changes
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const [file, snapshot] of currentFiles) {
      const prev = this.fileSnapshots.get(file);
      if (!prev) {
        added.push(file);
      } else if (prev.mtimeMs !== snapshot.mtimeMs || prev.size !== snapshot.size) {
        modified.push(file);
      } else if (prev.contentHash !== null && prev.contentHash !== snapshot.contentHash) {
        // Same mtime and size, different bytes: the rewrite landed inside one
        // timestamp tick at the same length. Only reachable while the previous
        // snapshot was within the granularity window, which is the only time a
        // hash is carried.
        modified.push(file);
      }
    }

    for (const file of this.fileSnapshots.keys()) {
      if (!currentFiles.has(file)) {
        deleted.push(file);
      }
    }

    // Re-snapshot EVERY surviving file, not just the ones that changed. An
    // unchanged file still needs its freshness re-evaluated: once its mtime ages
    // past the granularity window the hash is dropped and it returns to the
    // stat-only path. Keeping the old snapshot would pin it as forever-fresh and
    // hash it on every scan.
    //
    // Placement is the whole point, and it is bounded on both sides. It must come
    // AFTER categorisation, which compares the new snapshots against the previous
    // ones — overwriting them first would compare each file with itself and no
    // change would ever be detected. And it must come BEFORE the short-circuit
    // below, because the scans it needs to run on are precisely the quiet ones.
    // It sat after that early return, so on the common path it never ran: a file
    // first observed inside the window kept its hash for the life of the process
    // and was re-read on every poll, which is the steady-state cost this design
    // exists to avoid.
    for (const [file, snapshot] of currentFiles) {
      this.fileSnapshots.set(file, {
        ...snapshot,
        contentHash: snapshot.mtimeMayBeShared ? snapshot.contentHash : null,
      });
    }

    // Short-circuit: no changes after initial scan. Below this line is only the
    // contribution work — subtract, re-read, re-add — which a quiet poll must
    // still skip. Re-snapshotting above is about what the cache RETAINS; it does
    // not make a quiet poll redo the aggregation.
    if (this.initialized && added.length === 0 && modified.length === 0 && deleted.length === 0) {
      return;
    }

    // Process deletions: subtract old contributions
    for (const file of deleted) {
      this.subtractContribution(file);
      this.fileSnapshots.delete(file);
    }

    // Process modifications: subtract old → re-read → add new
    for (const file of modified) {
      this.subtractContribution(file);
      const contribution = await this.readFileContribution(file);
      if (contribution) {
        this.applyContribution(file, contribution);
      }
    }

    // Process additions: read and add
    for (const file of added) {
      const contribution = await this.readFileContribution(file);
      if (contribution) {
        this.applyContribution(file, contribution);
      }
    }

    this.initialized = true;
  }

  // ---- Contribution tracking -----------------------------------------------

  /** Subtract a file's previously tracked contribution from the task total. */
  private subtractContribution(file: string): void {
    const contribution = this.fileContributions.get(file);
    if (!contribution) return;

    const current = this.taskUsage.get(contribution.taskId);
    if (current) {
      current.totalTokens -= contribution.totalTokens;
      current.runCount -= 1;
      if (current.runCount <= 0) {
        this.taskUsage.delete(contribution.taskId);
      }
    }
    this.fileContributions.delete(file);
  }

  /** Add a file's contribution to the task total. */
  private applyContribution(file: string, contribution: FileContribution): void {
    this.fileContributions.set(file, contribution);

    const current = this.taskUsage.get(contribution.taskId) ?? { totalTokens: 0, runCount: 0 };
    current.totalTokens += contribution.totalTokens;
    current.runCount += 1;
    this.taskUsage.set(contribution.taskId, current);
  }

  // ---- File I/O ------------------------------------------------------------

  /**
   * Digest a run file's raw bytes. Gzipped files are hashed compressed — the
   * question is only "did these bytes change", so there is no reason to inflate.
   * Returns null when the file cannot be read, which the caller treats as
   * "no usable hash" rather than as a change.
   */
  private async hashFile(file: string): Promise<string | null> {
    try {
      const raw = await readFile(join(this.runsDir, file));
      return createHash("sha1").update(raw).digest("hex");
    } catch {
      return null;
    }
  }

  /**
   * Read a single run file (plain JSON or gzip-compressed) and extract
   * its task usage contribution.
   * Returns null for files that cannot be read or lack a taskId.
   */
  private async readFileContribution(file: string): Promise<FileContribution | null> {
    try {
      let data: Record<string, unknown>;
      if (file.endsWith(".gz")) {
        const compressed = await readFile(join(this.runsDir, file));
        const decompressed = gunzipSync(compressed);
        data = JSON.parse(decompressed.toString("utf-8")) as Record<string, unknown>;
      } else {
        const raw = await readFile(join(this.runsDir, file), "utf-8");
        data = JSON.parse(raw) as Record<string, unknown>;
      }

      const taskId = data.taskId;
      if (typeof taskId !== "string" || !taskId) return null;

      const tokenUsage = data.tokenUsage as Record<string, number> | undefined;
      const totalTokens =
        (tokenUsage?.input ?? 0) +
        (tokenUsage?.output ?? 0) +
        (tokenUsage?.cacheCreationInput ?? 0) +
        (tokenUsage?.cacheReadInput ?? 0);

      return { taskId, totalTokens };
    } catch {
      return null;
    }
  }

  /**
   * Scan the runs directory and return a snapshot map of all run files
   * (`.json` and `.json.gz`). Hidden files (prefixed with `.`) are
   * excluded to avoid picking up checkpoint or metadata files.
   */
  private async scanRunFiles(): Promise<Map<string, FileSnapshot>> {
    const snapshots = new Map<string, FileSnapshot>();

    let files: string[];
    try {
      files = await readdir(this.runsDir);
    } catch {
      return snapshots;
    }

    const runFiles = files.filter(
      (f) => (f.endsWith(".json") || f.endsWith(".json.gz")) && !f.startsWith("."),
    );

    // Taken before the stats so a file written during the scan is treated as
    // fresh rather than trusted.
    const scanStartedMs = Date.now();

    // Stat files in parallel for performance
    const entries = await Promise.all(
      runFiles.map(async (file) => {
        try {
          const st = await stat(join(this.runsDir, file));
          const mtimeMayBeShared = st.mtimeMs >= scanStartedMs - MTIME_GRANULARITY_MS;
          // Hash while the file is fresh, and for one more scan afterwards so the
          // previous snapshot's hash has something to be compared against.
          const previous = this.fileSnapshots.get(file);
          const contentHash =
            mtimeMayBeShared || previous?.contentHash != null
              ? await this.hashFile(file)
              : null;
          return { file, snapshot: { mtimeMs: st.mtimeMs, size: st.size, mtimeMayBeShared, contentHash } };
        } catch {
          // File disappeared between readdir and stat — skip
          return null;
        }
      }),
    );

    for (const entry of entries) {
      if (entry) {
        snapshots.set(entry.file, entry.snapshot);
      }
    }

    return snapshots;
  }
}
