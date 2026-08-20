/**
 * File change detection for hench run records.
 *
 * Tracks which `.hench/runs/*.json` files have been added, modified, or deleted
 * since the last aggregation checkpoint. Enables efficient delta processing
 * instead of full rebuilds on every aggregation pass.
 *
 * ## Design
 *
 * A checkpoint file (`.aggregation-checkpoint.json`) in the runs directory
 * stores per-file metadata (mtime, size) from the last successful aggregation.
 * On the next detection pass, the current filesystem state is compared against
 * the checkpoint to produce a minimal set of changes.
 *
 * The checkpoint is intentionally stored alongside the run files rather than
 * in a separate location — this keeps the aggregation state co-located with
 * the data it describes and simplifies cleanup.
 *
 * ## Why mtime + size alone is not sufficient
 *
 * On Windows, file timestamps advance in ticks rather than continuously, so a
 * rewrite of the same LENGTH inside one tick leaves both mtime and size unchanged
 * and is therefore invisible. A run record rewritten in place with an equal-length
 * edit — a taskId or status swap — would keep its stale contribution until some
 * later change to that file forced a re-read.
 *
 * So mtime is trusted only once it is older than {@link MTIME_GRANULARITY_MS}. In
 * the window where it cannot be trusted, the snapshot also carries a hash of the
 * file's bytes and detection compares that. The hash is dropped as soon as the
 * mtime ages out, so the steady state remains stat-only.
 *
 * ## TWIN of web's IncrementalTaskUsageAggregator — deliberately NOT shared
 *
 * `packages/web/src/server/task-usage/incremental-task-usage.ts` implements the
 * same rule, and a shared helper was considered and rejected:
 *
 * - THERE IS NO APPROPRIATE HOME. hench is execution tier and web imports the
 *   domain packages, so the only module both can import is @n-dx/llm-client — the
 *   vendor-neutral LLM foundation, which has no business owning a filesystem
 *   change detector. The alternative is a new package for ~40 lines, the same cost
 *   rejected for the quoting twin (see tests/unit/windows-quoting-parity.test.js).
 * - MORE IMPORTANTLY, THESE TWO NEVER NEED TO AGREE WITH EACH OTHER. Unlike the
 *   quoting twin — where both copies must produce byte-identical command lines for
 *   the same input, hence a parity test — these detectors never interact and
 *   compare nothing across the boundary. The risk is not divergence but regression
 *   on one side, which a parity test cannot catch and a per-side test can. Each
 *   side therefore carries its own utimes-pinned test for this hazard.
 *
 * If a THIRD copy of this rule ever appears, revisit: at that point the shared
 * module earns its cost.
 *
 * @module hench/store/run-change-detector
 */

import { join } from "node:path";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How far apart two writes must be before the filesystem is guaranteed to give
 * them different mtimes.
 *
 * Windows advances file timestamps in ticks rather than continuously: measured on
 * NTFS, 163 of 200 back-to-back same-size rewrites produced a byte-identical
 * mtimeMs, and gaps between consecutive distinct mtimes ran up to 10ms. 16ms is
 * the documented system-timer tick and covers the measured worst case with margin.
 * ext4 records nanoseconds, so on Linux this bound is simply never reached.
 */
const MTIME_GRANULARITY_MS = 16;

/** Filesystem snapshot of a single file. */
export interface FileSnapshot {
  /** Modification time in ms since epoch. */
  mtimeMs: number;
  /** File size in bytes. */
  size: number;
  /**
   * True when this snapshot was taken so soon after the file's own mtime that a
   * later write could reuse that same mtime, making an unchanged (mtime, size)
   * pair prove nothing. See {@link MTIME_GRANULARITY_MS}.
   *
   * Optional because checkpoints are persisted: one written before this existed
   * carries neither this nor `contentHash`, and its mtime is old by definition, so
   * absence correctly means "trustworthy".
   */
  mtimeMayBeShared?: boolean;
  /**
   * Digest of the file's bytes, carried only while `mtimeMayBeShared` holds — the
   * one window where mtime cannot settle the question. It is what makes an
   * equal-length, equal-mtime rewrite visible.
   *
   * Dropped once the mtime is old enough to trust, so the steady state stays
   * stat-only: a file is hashed for the scan or two after its last write and never
   * again.
   */
  contentHash?: string | null;
}

/**
 * Persisted checkpoint recording the state of run files at the last
 * successful aggregation.
 */
export interface AggregationCheckpoint {
  /** ISO timestamp of when this checkpoint was created. */
  timestamp: string;
  /** Map of filename → file metadata at last aggregation. */
  files: Record<string, FileSnapshot>;
}

/** A single change to a run file. */
export interface RunFileChange {
  /** Filename (not full path), e.g. `"abc123.json"`. */
  file: string;
  /** Type of change detected. */
  type: "added" | "modified" | "deleted";
}

/** Result of a change detection pass. */
export interface DeltaResult {
  /** Individual file changes detected. */
  changes: RunFileChange[];
  /** New checkpoint reflecting current filesystem state (save after processing). */
  checkpoint: AggregationCheckpoint;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHECKPOINT_FILENAME = ".aggregation-checkpoint.json";

// ---------------------------------------------------------------------------
// RunChangeDetector
// ---------------------------------------------------------------------------

/**
 * Detects changes to run files in a `.hench/runs/` directory by comparing
 * the current filesystem state against a persisted checkpoint.
 *
 * Usage:
 * ```ts
 * const detector = new RunChangeDetector(runsDir);
 * const { changes, checkpoint } = await detector.detectChanges();
 *
 * // Process only changed files...
 * for (const change of changes) { ... }
 *
 * // Persist checkpoint after successful processing
 * await detector.saveCheckpoint(checkpoint);
 * ```
 */
export class RunChangeDetector {
  private readonly runsDir: string;
  private readonly checkpointPath: string;

  constructor(runsDir: string) {
    this.runsDir = runsDir;
    this.checkpointPath = join(runsDir, CHECKPOINT_FILENAME);
  }

  // ---- Checkpoint I/O -----------------------------------------------------

  /** Load the persisted checkpoint. Returns `null` if no checkpoint exists or it is invalid. */
  async loadCheckpoint(): Promise<AggregationCheckpoint | null> {
    try {
      const raw = await readFile(this.checkpointPath, "utf-8");
      const data = JSON.parse(raw) as AggregationCheckpoint;
      if (!data || typeof data.timestamp !== "string" || typeof data.files !== "object") {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  /** Persist a checkpoint to disk. */
  async saveCheckpoint(checkpoint: AggregationCheckpoint): Promise<void> {
    await writeFile(this.checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");
  }

  // ---- Change detection ---------------------------------------------------

  /**
   * Compare current run files against the last checkpoint and return the
   * set of changes (added / modified / deleted).
   *
   * The returned `checkpoint` reflects the **current** filesystem state and
   * should be saved (via {@link saveCheckpoint}) only after the caller has
   * successfully processed all changes.
   */
  async detectChanges(): Promise<DeltaResult> {
    const previous = await this.loadCheckpoint();
    const previousFiles = previous?.files ?? {};

    // Scan current filesystem state. The previous snapshots are passed in so the
    // scan knows which files still need a content hash — see scanRunFiles.
    const { files: currentFiles, hashes: currentHashes } = await this.scanRunFiles(previousFiles);

    const changes: RunFileChange[] = [];

    // Detect added and modified files
    for (const [file, snapshot] of Object.entries(currentFiles)) {
      const prev = previousFiles[file];
      if (!prev) {
        changes.push({ file, type: "added" });
      } else if (prev.mtimeMs !== snapshot.mtimeMs || prev.size !== snapshot.size) {
        changes.push({ file, type: "modified" });
      } else if (
        typeof prev.contentHash === "string" &&
        prev.contentHash !== currentHashes[file]
      ) {
        // Same mtime and size, different bytes: the rewrite landed inside one
        // timestamp tick at the same length. Only reachable while the previous
        // snapshot was inside the granularity window, which is the only time a hash
        // is carried.
        changes.push({ file, type: "modified" });
      }
    }

    // Detect deleted files
    for (const file of Object.keys(previousFiles)) {
      if (!(file in currentFiles)) {
        changes.push({ file, type: "deleted" });
      }
    }

    // Sort for deterministic output
    changes.sort((a, b) => a.file.localeCompare(b.file));

    return {
      changes,
      checkpoint: {
        timestamp: new Date().toISOString(),
        files: currentFiles,
      },
    };
  }

  /**
   * Convenience: returns `true` if there are any changes since the last checkpoint.
   * Cheaper than building the full delta when you just need a boolean check.
   */
  async hasChanges(): Promise<boolean> {
    const { changes } = await this.detectChanges();
    return changes.length > 0;
  }

  // ---- Static helpers -----------------------------------------------------

  /** Extract only added and modified filenames from a delta result. */
  static changedFiles(result: DeltaResult): string[] {
    return result.changes
      .filter((c) => c.type === "added" || c.type === "modified")
      .map((c) => c.file);
  }

  /** Extract only deleted filenames from a delta result. */
  static deletedFiles(result: DeltaResult): string[] {
    return result.changes
      .filter((c) => c.type === "deleted")
      .map((c) => c.file);
  }

  // ---- Private ------------------------------------------------------------

  /**
   * Read the runs directory and build a snapshot map of all run files
   * (`.json` and `.json.gz`), excluding the checkpoint file itself.
   *
   * `previousFiles` decides which files still need hashing: one inside the
   * granularity window, and one whose previous snapshot carried a hash (so this
   * pass has something to compare against). Everything else is stat-only.
   */
  private async scanRunFiles(
    previousFiles: Record<string, FileSnapshot> = {},
  ): Promise<{ files: Record<string, FileSnapshot>; hashes: Record<string, string | null> }> {
    const snapshots: Record<string, FileSnapshot> = {};

    let files: string[];
    try {
      files = await readdir(this.runsDir);
    } catch {
      return { files: snapshots, hashes: {} };
    }

    const runFiles = files.filter(
      (f) =>
        (f.endsWith(".json") || f.endsWith(".json.gz")) &&
        f !== CHECKPOINT_FILENAME &&
        !f.startsWith("."),
    );

    // Taken before the stats so a file written during the scan counts as fresh
    // rather than trusted.
    const scanStartedMs = Date.now();

    // Stat files in parallel for performance
    const entries = await Promise.all(
      runFiles.map(async (file) => {
        try {
          const st = await stat(join(this.runsDir, file));
          const mtimeMayBeShared = st.mtimeMs >= scanStartedMs - MTIME_GRANULARITY_MS;
          const needsHash =
            mtimeMayBeShared || typeof previousFiles[file]?.contentHash === "string";
          const hash = needsHash ? await this.hashFile(file) : null;
          const snapshot: FileSnapshot = { mtimeMs: st.mtimeMs, size: st.size };
          // Only carry the hash forward while the mtime is still untrustworthy;
          // otherwise the next scan would keep hashing this file forever.
          if (mtimeMayBeShared) {
            snapshot.mtimeMayBeShared = true;
            snapshot.contentHash = hash;
          }
          return { file, snapshot, hash };
        } catch {
          // File disappeared between readdir and stat — skip
          return null;
        }
      }),
    );

    const hashes: Record<string, string | null> = {};
    for (const entry of entries) {
      if (entry) {
        snapshots[entry.file] = entry.snapshot;
        hashes[entry.file] = entry.hash;
      }
    }

    return { files: snapshots, hashes };
  }

  /**
   * Digest a run file's raw bytes. Gzipped files are hashed compressed — the
   * question is only "did these bytes change" — and a read failure yields null,
   * which the caller treats as "no usable hash" rather than as a change.
   */
  private async hashFile(file: string): Promise<string | null> {
    try {
      const raw = await readFile(join(this.runsDir, file));
      return createHash("sha1").update(raw).digest("hex");
    } catch {
      return null;
    }
  }
}
