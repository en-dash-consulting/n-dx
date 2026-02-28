/**
 * Periodic retention policy scheduler.
 *
 * Runs the retention policy on a configurable interval, automatically
 * deleting very old run files while preserving usage statistics. Emits
 * warnings for files approaching the retention cutoff so callers can
 * notify users before data is removed.
 *
 * ## Design
 *
 * Follows the same scheduler pattern as `usage-cleanup-scheduler`
 * in the web package: a `setInterval` timer that runs cleanup cycles,
 * logs results, and optionally broadcasts events. The timer is unref'd
 * so it won't prevent process exit.
 *
 * ## Configuration
 *
 * Reads from `.n-dx.json`:
 * ```json
 * {
 *   "retention": {
 *     "maxAgeDays": 180,
 *     "enabled": true,
 *     "warningDays": 30,
 *     "preserveUsageStats": true,
 *     "intervalMs": 86400000
 *   }
 * }
 * ```
 * Default interval: 86400000 ms (24 hours / daily).
 *
 * @module hench/store/run-retention-scheduler
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  enforceRetentionPolicy,
  loadRetentionConfig,
  type RetentionConfig,
  type RetentionResult,
} from "./run-retention.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default retention enforcement interval: 24 hours (daily). */
export const DEFAULT_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback invoked when files are approaching the retention cutoff. */
export type WarningCallback = (
  warningFiles: string[],
  daysUntilDeletion: number,
) => void;

/** Options for the retention scheduler. */
export interface RetentionSchedulerOptions {
  /** Path to the `.hench/runs/` directory. */
  runsDir: string;
  /** Project root directory (for config loading). */
  projectDir: string;
  /** Optional callback when files are approaching deletion. */
  onWarning?: WarningCallback;
  /** Optional callback for broadcast events (e.g., WebSocket). */
  broadcast?: (data: unknown) => void;
  /** Override interval for testing (takes precedence over config). */
  overrideIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Scheduler interval configuration
// ---------------------------------------------------------------------------

/**
 * Load the retention scheduler interval from `.n-dx.json`.
 *
 * Reads `retention.intervalMs`. Returns the default if missing or invalid.
 */
export async function loadRetentionIntervalMs(
  projectDir: string,
): Promise<number> {
  try {
    const raw = await readFile(join(projectDir, ".n-dx.json"), "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const section = data.retention as Record<string, unknown> | undefined;
    if (
      section &&
      typeof section === "object" &&
      typeof section.intervalMs === "number" &&
      section.intervalMs > 0
    ) {
      return section.intervalMs;
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_RETENTION_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Single cycle execution
// ---------------------------------------------------------------------------

/**
 * Execute a single retention enforcement cycle.
 *
 * Loads configuration, enforces the policy, logs results, and invokes
 * callbacks for warnings and broadcasts.
 *
 * @returns The retention result, or `null` if an error occurred.
 */
export async function runRetentionCycle(
  options: RetentionSchedulerOptions,
): Promise<RetentionResult | null> {
  const { runsDir, projectDir, onWarning, broadcast } = options;

  try {
    const config = await loadRetentionConfig(projectDir);
    const logPath = join(projectDir, ".hench", "retention-stats.jsonl");

    const result = await enforceRetentionPolicy(
      runsDir,
      config,
      undefined,
      logPath,
    );

    // Emit warnings for files approaching deletion
    if (onWarning && result.warningFiles.length > 0) {
      onWarning(result.warningFiles, config.warningDays);
    }

    // Broadcast so dashboard/consumers know retention ran
    if (broadcast) {
      broadcast({
        type: "hench:retention-cleanup",
        filesDeleted: result.filesDeleted,
        filesSkipped: result.filesSkipped,
        warningFiles: result.warningFiles,
        preservedStats: result.preservedStats,
      });
    }

    return result;
  } catch (err) {
    // Non-fatal: retention errors must not crash the host process
    console.error("[retention] Error during retention cycle:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Start the periodic retention policy scheduler.
 *
 * Runs retention enforcement on a configurable interval (read from
 * `.n-dx.json`, default daily). Each cycle identifies old run files,
 * preserves their usage statistics, and deletes them. Files approaching
 * the retention cutoff trigger warnings via the `onWarning` callback.
 *
 * The timer is unref'd so it won't prevent process exit.
 *
 * @param options Scheduler configuration.
 * @returns The setInterval handle for cleanup during shutdown.
 */
export async function startRetentionScheduler(
  options: RetentionSchedulerOptions,
): Promise<ReturnType<typeof setInterval>> {
  const intervalMs =
    options.overrideIntervalMs ??
    (await loadRetentionIntervalMs(options.projectDir));

  const timer = setInterval(async () => {
    const result = await runRetentionCycle(options);

    if (result && result.filesDeleted > 0) {
      console.log(
        `[retention] Deleted ${result.filesDeleted} run file(s) older than retention threshold.` +
          (result.preservedStats
            ? ` Preserved ${result.preservedStats.totalRuns} run(s) usage stats ` +
              `(${result.preservedStats.totalInputTokens + result.preservedStats.totalOutputTokens} total tokens).`
            : ""),
      );
    }

    if (result && result.warningFiles.length > 0) {
      console.log(
        `[retention] Warning: ${result.warningFiles.length} run file(s) approaching retention cutoff.`,
      );
    }
  }, intervalMs);

  if (timer.unref) {
    timer.unref();
  }

  return timer;
}
