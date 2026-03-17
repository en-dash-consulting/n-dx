/**
 * Scheduler registration for the usage-cleanup zone.
 *
 * Exports a single `registerUsageScheduler()` function that encapsulates
 * all wiring needed to start the periodic cleanup scheduler. This makes
 * the scheduler's lifecycle dependency on web-dashboard explicit and
 * self-contained — the dashboard calls one function at startup rather
 * than knowing internal scheduler details (aggregator factories, PRD
 * ID collection callbacks, broadcast functions, etc.).
 *
 * @module web/server/register-scheduler
 */

import type { IncrementalTaskUsageAggregator } from "./incremental-task-usage.js";
import { startUsageCleanupScheduler } from "./usage-cleanup-scheduler.js";
import type { LoadPRDFn } from "./usage-cleanup-scheduler.js";
import type { CollectAllIdsFn } from "./shared-types.js";

/** Options for registering the usage cleanup scheduler. */
export interface RegisterSchedulerOptions {
  /** Server context with project paths. */
  ctx: { rexDir: string; projectDir: string };

  /** Factory to get the aggregator singleton for the runs directory. */
  getAggregator: () => IncrementalTaskUsageAggregator;

  /** WebSocket broadcast function for notifying connected clients. */
  broadcast?: (data: unknown) => void;

  /** Function to extract valid task IDs from PRD items. */
  collectAllIds?: CollectAllIdsFn;

  /** Override interval in ms (for testing; takes precedence over config). */
  overrideIntervalMs?: number;

  /** PRD loader function (injected to avoid cross-zone coupling). */
  loadPRD?: LoadPRDFn;
}

/**
 * Register the periodic usage cleanup scheduler.
 *
 * Wraps `startUsageCleanupScheduler` with a clean interface so the
 * server startup code (web-dashboard zone) can wire the scheduler with
 * a single function call. Returns the interval handle for shutdown
 * cleanup.
 *
 * Usage in start.ts:
 * ```ts
 * const handle = registerUsageScheduler({
 *   ctx,
 *   getAggregator: () => getAggregator(runsDir),
 *   broadcast: ws.broadcast,
 *   collectAllIds,
 * });
 * watcherHandles.monitorIntervals.push(handle);
 * ```
 */
export function registerUsageScheduler(
  options: RegisterSchedulerOptions,
): ReturnType<typeof setInterval> {
  return startUsageCleanupScheduler(
    options.ctx,
    options.getAggregator,
    options.broadcast,
    options.overrideIntervalMs,
    options.collectAllIds,
    options.loadPRD,
  );
}
