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
 * @module hench/store/run-change-detector
 */

import { join } from "node:path";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Filesystem snapshot of a single file. */
export interface FileSnapshot {
  /** Modification time in ms since epoch. */
  mtimeMs: number;
  /** File size in bytes. */
  size: number;
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

    // Scan current filesystem state
    const currentFiles = await this.scanRunFiles();

    const changes: RunFileChange[] = [];

    // Detect added and modified files
    for (const [file, snapshot] of Object.entries(currentFiles)) {
      const prev = previousFiles[file];
      if (!prev) {
        changes.push({ file, type: "added" });
      } else if (prev.mtimeMs !== snapshot.mtimeMs || prev.size !== snapshot.size) {
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
   */
  private async scanRunFiles(): Promise<Record<string, FileSnapshot>> {
    const snapshots: Record<string, FileSnapshot> = {};

    let files: string[];
    try {
      files = await readdir(this.runsDir);
    } catch {
      return snapshots;
    }

    const runFiles = files.filter(
      (f) =>
        (f.endsWith(".json") || f.endsWith(".json.gz")) &&
        f !== CHECKPOINT_FILENAME &&
        !f.startsWith("."),
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
        snapshots[entry.file] = entry.snapshot;
      }
    }

    return snapshots;
  }
}
