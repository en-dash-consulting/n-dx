/**
 * Periodic cleanup scheduler for orphaned usage records.
 *
 * Cross-references in-memory usage aggregation with the current PRD state
 * to identify and prune entries whose tasks no longer exist. Only prunes
 * the in-memory aggregation cache — run files on disk are preserved as
 * the source of truth, ensuring critical data survives PRD restructuring.
 *
 * ## Design
 *
 * The cleanup cycle:
 *   1. Reads current aggregated task usage from the IncrementalTaskUsageAggregator
 *   2. Loads valid task IDs from the PRD via `collectAllIds()`
 *   3. Identifies orphaned entries (usage for tasks not in PRD)
 *   4. Prunes them from the aggregator's in-memory state
 *   5. Logs removed entries to a JSONL audit file for auditability
 *   6. Broadcasts a WebSocket event so the dashboard can react
 *
 * Graceful degradation: if the PRD is unavailable (not initialized, corrupt,
 * etc.), the cleanup cycle is skipped entirely — no data is removed.
 *
 * ## Configuration
 *
 * The cleanup interval is read from `.n-dx.json`:
 * ```json
 * { "cleanup": { "intervalMs": 604800000 } }
 * ```
 * Default: 604800000 ms (7 days / weekly).
 *
 * @module web/server/usage-cleanup-scheduler
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { IncrementalTaskUsageAggregator } from "./incremental-task-usage.js";
import type { TaskUsageAccumulator, CollectAllIdsFn, OrphanedEntry, CleanupResult, CleanupLogEntry, CleanupConfig } from "./shared-types.js";

export type { CollectAllIdsFn, OrphanedEntry, CleanupResult, CleanupLogEntry, CleanupConfig } from "./shared-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default cleanup interval: 7 days (weekly). */
export const DEFAULT_CLEANUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Identify orphaned usage entries by cross-referencing with valid PRD task IDs.
 *
 * Returns entries from `taskUsage` whose task IDs are not in `validTaskIds`.
 * Pure function — no side effects.
 */
export function identifyOrphanedEntries(
  taskUsage: Record<string, TaskUsageAccumulator>,
  validTaskIds: Set<string>,
): OrphanedEntry[] {
  const orphaned: OrphanedEntry[] = [];
  for (const [taskId, acc] of Object.entries(taskUsage)) {
    if (!validTaskIds.has(taskId)) {
      orphaned.push({
        taskId,
        totalTokens: acc.totalTokens,
        runCount: acc.runCount,
      });
    }
  }
  return orphaned;
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

/**
 * Write a cleanup log entry to the JSONL audit file.
 *
 * Creates parent directories if they do not exist. Failures are silently
 * swallowed — log writes are best-effort and must not break the cleanup cycle.
 */
export function writeCleanupLog(logPath: string, entry: CleanupLogEntry): void {
  try {
    const dir = dirname(logPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Non-fatal: log write failure should not break cleanup
  }
}

/**
 * Load cleanup configuration from `.n-dx.json`.
 *
 * Reads the `cleanup.intervalMs` key. Returns defaults for missing,
 * malformed, or invalid configuration.
 */
export function loadCleanupConfig(projectDir: string): CleanupConfig {
  const defaults: CleanupConfig = { intervalMs: DEFAULT_CLEANUP_INTERVAL_MS };

  const configPath = join(projectDir, ".n-dx.json");
  if (!existsSync(configPath)) return defaults;

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const cleanup = raw.cleanup;
    if (typeof cleanup !== "object" || cleanup === null) return defaults;

    const intervalMs = (cleanup as Record<string, unknown>).intervalMs;
    if (typeof intervalMs === "number" && intervalMs > 0) {
      return { intervalMs };
    }
    return defaults;
  } catch {
    return defaults;
  }
}

/** Minimal PRD shape for cleanup — avoids importing full rex types. */
interface PRDShape {
  items?: unknown[];
}

// CollectAllIdsFn is imported from shared-types.ts and re-exported above.

/** Signature for PRD loaders compatible with `loadPRDSync`. */
export type LoadPRDFn = (rexDir: string) => unknown;

/**
 * Load valid task IDs from the PRD file.
 *
 * Returns null if the PRD cannot be read, allowing callers to degrade
 * gracefully (skip cleanup rather than removing everything).
 */
function loadValidTaskIds(
  rexDir: string,
  collectAllIds: CollectAllIdsFn,
  loadPRD: LoadPRDFn,
): Set<string> | null {
  const doc = loadPRD(rexDir) as PRDShape | null;
  if (!doc || !Array.isArray(doc.items)) return null;
  return collectAllIds(doc.items);
}

// ---------------------------------------------------------------------------
// Core cleanup logic
// ---------------------------------------------------------------------------

/**
 * Execute a single cleanup cycle.
 *
 * Cross-references current aggregated usage with the PRD to find orphaned
 * entries, prunes them from the aggregator, and optionally logs and broadcasts
 * the result.
 *
 * **Critical data preservation**: only in-memory aggregation state is pruned.
 * Run files on disk (`.hench/runs/*.json`) are never modified or deleted,
 * ensuring usage data can always be recovered via `aggregator.reset()`.
 *
 * @param options.aggregator The incremental task usage aggregator to clean
 * @param options.rexDir Path to the `.rex/` directory containing `prd.json`
 * @param options.collectAllIds Injected function to extract IDs from PRD items
 * @param options.logPath Optional path for the JSONL audit log
 * @param options.broadcast Optional WebSocket broadcast function
 * @param options.loadPRD PRD loader function (injected to avoid cross-zone coupling; required when collectAllIds is provided)
 */
export async function runCleanupCycle(options: {
  aggregator: IncrementalTaskUsageAggregator;
  rexDir: string;
  collectAllIds?: CollectAllIdsFn;
  logPath?: string;
  broadcast?: (data: unknown) => void;
  loadPRD?: LoadPRDFn;
}): Promise<CleanupResult> {
  const { aggregator, rexDir, collectAllIds: collectIds, logPath, broadcast, loadPRD } = options;

  // Ensure aggregator is populated before checking for orphans
  const taskUsage = await aggregator.getTaskUsage();
  const validIds = collectIds && loadPRD ? loadValidTaskIds(rexDir, collectIds, loadPRD) : null;

  const result: CleanupResult = {
    timestamp: new Date().toISOString(),
    prdAvailable: validIds !== null,
    orphanedEntries: [],
    totalOrphaned: 0,
    totalTokensRemoved: 0,
    totalRunsRemoved: 0,
  };

  // Skip cleanup if PRD is unavailable — we cannot determine which tasks
  // are valid, so removing anything would risk data loss.
  if (!validIds) {
    return result;
  }

  const orphaned = identifyOrphanedEntries(taskUsage, validIds);
  if (orphaned.length === 0) {
    return result;
  }

  // Prune from aggregator's in-memory state
  aggregator.pruneStaleEntries(validIds);

  result.orphanedEntries = orphaned;
  result.totalOrphaned = orphaned.length;
  result.totalTokensRemoved = orphaned.reduce((sum, e) => sum + e.totalTokens, 0);
  result.totalRunsRemoved = orphaned.reduce((sum, e) => sum + e.runCount, 0);

  // Write audit log for accountability
  if (logPath) {
    writeCleanupLog(logPath, { event: "usage_cleanup", ...result });
  }

  // Broadcast so the dashboard knows cleanup occurred
  if (broadcast) {
    broadcast({
      type: "hench:usage-cleanup",
      ...result,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Start the periodic usage cleanup scheduler.
 *
 * Runs cleanup cycles on a configurable interval (read from `.n-dx.json`,
 * default weekly). Each cycle cross-references usage data with the PRD
 * and prunes orphaned entries.
 *
 * The returned interval handle should be stored in `watcherHandles.monitorIntervals`
 * for proper cleanup during server shutdown.
 *
 * The timer is unref'd so it won't prevent process exit.
 *
 * @param ctx Server context with project paths
 * @param getAggregator Factory to get the aggregator singleton for the runs directory
 * @param broadcast Optional WebSocket broadcast function
 * @param overrideIntervalMs Override interval (used for testing; takes precedence over config)
 * @returns The setInterval handle
 */
export function startUsageCleanupScheduler(
  ctx: { rexDir: string; projectDir: string },
  getAggregator: () => IncrementalTaskUsageAggregator,
  broadcast?: (data: unknown) => void,
  overrideIntervalMs?: number,
  collectAllIds?: CollectAllIdsFn,
  loadPRD?: LoadPRDFn,
): ReturnType<typeof setInterval> {
  const logPath = join(ctx.projectDir, ".hench", "usage-cleanup.jsonl");

  // Determine interval: explicit override > .n-dx.json config > default
  const intervalMs = overrideIntervalMs ?? loadCleanupConfig(ctx.projectDir).intervalMs;

  const timer = setInterval(async () => {
    try {
      const aggregator = getAggregator();
      const result = await runCleanupCycle({
        aggregator,
        rexDir: ctx.rexDir,
        collectAllIds,
        logPath,
        broadcast,
        loadPRD,
      });

      if (result.totalOrphaned > 0) {
        console.log(
          `[usage-cleanup] Removed ${result.totalOrphaned} orphaned task(s): ` +
          `${result.totalTokensRemoved} tokens across ${result.totalRunsRemoved} run(s)`,
        );
      }
    } catch (err) {
      // Non-fatal: cleanup errors must not crash the server
      console.error("[usage-cleanup] Error during cleanup cycle:", err);
    }
  }, intervalMs);

  if (timer.unref) {
    timer.unref();
  }

  return timer;
}
