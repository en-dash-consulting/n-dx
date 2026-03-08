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
 * hench's `RunChangeDetector` — to avoid reading unchanged files.
 *
 * @module web/server/incremental-task-usage
 */

import { join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type { TaskUsageAccumulator } from "./shared-types.js";

export type { TaskUsageAccumulator } from "./shared-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Filesystem snapshot of a single run file. */
interface FileSnapshot {
  mtimeMs: number;
  size: number;
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
 * detect filesystem changes via mtime+size comparison and only read the
 * files that were added, modified, or deleted — keeping aggregation time
 * constant regardless of total run history size.
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

  /** Current snapshot of each file's mtime + size. */
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
      }
    }

    for (const file of this.fileSnapshots.keys()) {
      if (!currentFiles.has(file)) {
        deleted.push(file);
      }
    }

    // Short-circuit: no changes after initial scan
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
      this.fileSnapshots.set(file, currentFiles.get(file)!);
    }

    // Process additions: read and add
    for (const file of added) {
      const contribution = await this.readFileContribution(file);
      if (contribution) {
        this.applyContribution(file, contribution);
      }
      this.fileSnapshots.set(file, currentFiles.get(file)!);
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

    // Stat files in parallel for performance
    const entries = await Promise.all(
      runFiles.map(async (file) => {
        try {
          const st = await stat(join(this.runsDir, file));
          return { file, snapshot: { mtimeMs: st.mtimeMs, size: st.size } };
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
