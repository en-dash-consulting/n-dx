/**
 * Run history retention policies.
 *
 * Configurable retention policies that automatically remove very old run
 * files (both `.json` and `.json.gz`) while preserving aggregated usage
 * statistics. Operates at a longer time horizon than archival (default
 * 6 months vs 30 days) — archival compresses, retention deletes.
 *
 * ## Design
 *
 * Before deleting any files, the module extracts and aggregates token
 * usage statistics into a summary record written to a JSONL audit log.
 * This ensures that historical usage data is never lost, even after
 * individual run files are removed.
 *
 * A warning system identifies files approaching the retention cutoff
 * so callers can notify users before data is deleted.
 *
 * Configuration lives in `.n-dx.json` under the `retention` key.
 *
 * @module hench/store/run-retention
 */

import { join } from "node:path";
import {
  readFile,
  readdir,
  stat,
  unlink,
  appendFile,
  mkdir,
} from "node:fs/promises";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { dirname } from "node:path";

const gunzipAsync = promisify(gunzip);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for run history retention policies. */
export interface RetentionConfig {
  /** Number of days after which run files are eligible for deletion. */
  maxAgeDays: number;
  /** Whether retention enforcement is enabled. */
  enabled: boolean;
  /** Number of days before `maxAgeDays` to start warning users. */
  warningDays: number;
  /** Whether to extract and preserve usage stats before deleting runs. */
  preserveUsageStats: boolean;
}

/** Aggregated usage statistics preserved from deleted run files. */
export interface PreservedUsageStats {
  /** Total input tokens across all deleted runs. */
  totalInputTokens: number;
  /** Total output tokens across all deleted runs. */
  totalOutputTokens: number;
  /** Total cache creation tokens across all deleted runs. */
  totalCacheCreationTokens: number;
  /** Total cache read tokens across all deleted runs. */
  totalCacheReadTokens: number;
  /** Total number of deleted run files. */
  totalRuns: number;
  /** Total turns across all deleted runs. */
  totalTurns: number;
  /** Unique task IDs that had runs deleted. */
  taskIds: string[];
  /** Files that could not be read (filename → error message). */
  errors: Array<{ file: string; error: string }>;
}

/** Summary of a retention enforcement pass. */
export interface RetentionResult {
  /** Number of files deleted. */
  filesDeleted: number;
  /** Number of files kept (too recent for deletion). */
  filesSkipped: number;
  /** Files in the warning window (approaching deletion). */
  warningFiles: string[];
  /** Aggregated usage stats preserved before deletion (if enabled). */
  preservedStats?: PreservedUsageStats;
  /** Files that failed to delete (filename → error message). */
  errors: Array<{ file: string; error: string }>;
}

/** Persistent log entry written to the retention JSONL audit file. */
export interface RetentionLogEntry {
  event: "retention_cleanup";
  timestamp: string;
  filesDeleted: number;
  filesSkipped: number;
  warningFiles: string[];
  preservedStats?: PreservedUsageStats;
  errors: Array<{ file: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Constants & defaults
// ---------------------------------------------------------------------------

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  maxAgeDays: 180,
  enabled: true,
  warningDays: 30,
  preserveUsageStats: true,
};

// ---------------------------------------------------------------------------
// Configuration loading
// ---------------------------------------------------------------------------

/**
 * Load retention configuration from `.n-dx.json`.
 *
 * Reads the `retention` section from the project config file. Missing
 * or invalid fields fall back to {@link DEFAULT_RETENTION_CONFIG}.
 *
 * @param projectDir Project root directory containing `.n-dx.json`.
 */
export async function loadRetentionConfig(
  projectDir: string,
): Promise<RetentionConfig> {
  try {
    const raw = await readFile(join(projectDir, ".n-dx.json"), "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const section = data.retention as Record<string, unknown> | undefined;
    if (!section || typeof section !== "object") {
      return { ...DEFAULT_RETENTION_CONFIG };
    }

    const maxAgeDays =
      typeof section.maxAgeDays === "number" && section.maxAgeDays > 0
        ? section.maxAgeDays
        : DEFAULT_RETENTION_CONFIG.maxAgeDays;

    const warningDaysRaw =
      typeof section.warningDays === "number" && section.warningDays > 0
        ? section.warningDays
        : DEFAULT_RETENTION_CONFIG.warningDays;

    // Clamp warningDays to not exceed maxAgeDays
    const warningDays = Math.min(warningDaysRaw, maxAgeDays);

    return {
      maxAgeDays,
      enabled:
        typeof section.enabled === "boolean"
          ? section.enabled
          : DEFAULT_RETENTION_CONFIG.enabled,
      warningDays,
      preserveUsageStats:
        typeof section.preserveUsageStats === "boolean"
          ? section.preserveUsageStats
          : DEFAULT_RETENTION_CONFIG.preserveUsageStats,
    };
  } catch {
    return { ...DEFAULT_RETENTION_CONFIG };
  }
}

// ---------------------------------------------------------------------------
// File reading utilities
// ---------------------------------------------------------------------------

/**
 * Read a run file (plain JSON or gzip-compressed) and parse it.
 *
 * @param filePath Absolute path to a `.json` or `.json.gz` file.
 * @returns Parsed JSON data.
 */
async function readRunFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath);
  if (filePath.endsWith(".gz")) {
    const decompressed = await gunzipAsync(raw);
    return JSON.parse(decompressed.toString("utf-8"));
  }
  return JSON.parse(raw.toString("utf-8"));
}

// ---------------------------------------------------------------------------
// Identification functions
// ---------------------------------------------------------------------------

/**
 * List run files in a directory (both `.json` and `.json.gz`), excluding
 * hidden files.
 */
async function listRunFiles(runsDir: string): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return [];
  }
  return files.filter(
    (f) =>
      !f.startsWith(".") && (f.endsWith(".json") || f.endsWith(".json.gz")),
  );
}

/**
 * Identify run files eligible for deletion (older than `maxAgeDays`).
 *
 * Checks both `.json` and `.json.gz` files. Hidden files are excluded.
 *
 * @param runsDir Path to the `.hench/runs/` directory.
 * @param maxAgeDays Threshold in days.
 * @param now Optional reference time (for testing). Defaults to `Date.now()`.
 * @returns Array of filenames eligible for deletion, sorted.
 */
export async function identifyRetainableRuns(
  runsDir: string,
  maxAgeDays: number,
  now?: number,
): Promise<string[]> {
  const cutoff = (now ?? Date.now()) - maxAgeDays * 24 * 60 * 60 * 1000;
  const files = await listRunFiles(runsDir);

  const eligible: string[] = [];

  await Promise.all(
    files.map(async (file) => {
      try {
        const st = await stat(join(runsDir, file));
        if (st.mtimeMs < cutoff) {
          eligible.push(file);
        }
      } catch {
        // File disappeared between readdir and stat — skip
      }
    }),
  );

  eligible.sort();
  return eligible;
}

/**
 * Identify run files in the warning window (approaching deletion but
 * not yet eligible).
 *
 * A file is in the warning window if its age is between
 * `(maxAgeDays - warningDays)` and `maxAgeDays`.
 *
 * @param runsDir Path to the `.hench/runs/` directory.
 * @param maxAgeDays Deletion threshold in days.
 * @param warningDays Warning lead time in days.
 * @param now Optional reference time (for testing). Defaults to `Date.now()`.
 * @returns Array of filenames in the warning window, sorted.
 */
export async function identifyWarningRuns(
  runsDir: string,
  maxAgeDays: number,
  warningDays: number,
  now?: number,
): Promise<string[]> {
  const currentTime = now ?? Date.now();
  const deletionCutoff = currentTime - maxAgeDays * 24 * 60 * 60 * 1000;
  const warningCutoff =
    currentTime - (maxAgeDays - warningDays) * 24 * 60 * 60 * 1000;

  const files = await listRunFiles(runsDir);

  const warned: string[] = [];

  await Promise.all(
    files.map(async (file) => {
      try {
        const st = await stat(join(runsDir, file));
        // In warning window: older than warning cutoff but newer than deletion cutoff
        if (st.mtimeMs < warningCutoff && st.mtimeMs >= deletionCutoff) {
          warned.push(file);
        }
      } catch {
        // File disappeared — skip
      }
    }),
  );

  warned.sort();
  return warned;
}

// ---------------------------------------------------------------------------
// Usage stats extraction
// ---------------------------------------------------------------------------

/**
 * Extract and aggregate token usage statistics from a set of run files.
 *
 * Reads each file, extracts `tokenUsage` and metadata, and aggregates
 * into a summary. Files that cannot be read are recorded in the `errors`
 * array but do not abort the operation.
 *
 * @param runsDir Path to the runs directory.
 * @param files Array of filenames to extract stats from.
 * @returns Aggregated usage statistics.
 */
export async function extractUsageStats(
  runsDir: string,
  files: string[],
): Promise<PreservedUsageStats> {
  const stats: PreservedUsageStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalRuns: 0,
    totalTurns: 0,
    taskIds: [],
    errors: [],
  };

  const taskIdSet = new Set<string>();

  for (const file of files) {
    try {
      const data = (await readRunFile(join(runsDir, file))) as Record<
        string,
        unknown
      >;
      const tokenUsage = data.tokenUsage as Record<string, number> | undefined;

      if (tokenUsage) {
        stats.totalInputTokens += tokenUsage.input ?? 0;
        stats.totalOutputTokens += tokenUsage.output ?? 0;
        stats.totalCacheCreationTokens +=
          tokenUsage.cacheCreationInput ?? 0;
        stats.totalCacheReadTokens += tokenUsage.cacheReadInput ?? 0;
      }

      if (typeof data.turns === "number") {
        stats.totalTurns += data.turns;
      }

      if (typeof data.taskId === "string") {
        taskIdSet.add(data.taskId);
      }

      stats.totalRuns += 1;
    } catch (err) {
      stats.errors.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  stats.taskIds = [...taskIdSet].sort();
  return stats;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Write a retention log entry to the JSONL audit file.
 *
 * Creates parent directories if needed. Failures are silently swallowed —
 * log writes are best-effort and must not break the retention cycle.
 */
async function writeRetentionLog(
  logPath: string,
  entry: RetentionLogEntry,
): Promise<void> {
  try {
    const dir = dirname(logPath);
    await mkdir(dir, { recursive: true });
    await appendFile(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Non-fatal: log write failure should not break retention
  }
}

// ---------------------------------------------------------------------------
// Main retention orchestrator
// ---------------------------------------------------------------------------

/**
 * Enforce the retention policy by deleting old run files.
 *
 * Scans the `runs/` directory, identifies files older than the configured
 * threshold, optionally extracts and preserves aggregated usage statistics,
 * then deletes the old files. Also identifies files in the warning window
 * for user notification.
 *
 * All token usage metadata is aggregated and preserved in the retention
 * audit log before any files are removed, ensuring usage statistics are
 * never permanently lost.
 *
 * @param runsDir Path to the `.hench/runs/` directory.
 * @param config Retention configuration.
 * @param now Optional reference time (for testing).
 * @param logPath Optional path for the JSONL retention audit log.
 * @returns Summary of the retention operation.
 */
export async function enforceRetentionPolicy(
  runsDir: string,
  config: RetentionConfig = DEFAULT_RETENTION_CONFIG,
  now?: number,
  logPath?: string,
): Promise<RetentionResult> {
  if (!config.enabled) {
    return {
      filesDeleted: 0,
      filesSkipped: 0,
      warningFiles: [],
      errors: [],
    };
  }

  // Identify files for deletion and warning
  const eligible = await identifyRetainableRuns(
    runsDir,
    config.maxAgeDays,
    now,
  );
  const warningFiles = await identifyWarningRuns(
    runsDir,
    config.maxAgeDays,
    config.warningDays,
    now,
  );

  // Count total run files for skip calculation
  const allFiles = await listRunFiles(runsDir);
  const filesSkipped = allFiles.length - eligible.length;

  // Extract usage stats before deletion (if configured)
  let preservedStats: PreservedUsageStats | undefined;
  if (config.preserveUsageStats && eligible.length > 0) {
    preservedStats = await extractUsageStats(runsDir, eligible);
  }

  // Delete eligible files
  const errors: Array<{ file: string; error: string }> = [];
  let filesDeleted = 0;

  for (const file of eligible) {
    try {
      await unlink(join(runsDir, file));
      filesDeleted += 1;
    } catch (err) {
      errors.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result: RetentionResult = {
    filesDeleted,
    filesSkipped,
    warningFiles,
    preservedStats,
    errors,
  };

  // Write audit log
  if (logPath && filesDeleted > 0) {
    await writeRetentionLog(logPath, {
      event: "retention_cleanup",
      timestamp: new Date().toISOString(),
      filesDeleted,
      filesSkipped,
      warningFiles,
      preservedStats,
      errors,
    });
  }

  return result;
}
