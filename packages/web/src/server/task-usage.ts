/**
 * Public facade for the task-usage-tracking zone.
 *
 * Re-exports the three services (incremental aggregation, cleanup scheduling,
 * and scheduler registration) through a single module so consumers don't
 * couple to internal file paths.
 *
 * Consumers should import from this facade rather than directly from
 * `incremental-task-usage.js`, `usage-cleanup-scheduler.js`, or
 * `register-scheduler.js`.
 *
 * @module web/server/task-usage
 */

// ── Shared types (zone-neutral) ──────────────────────────────────────

export type {
  TaskUsageAccumulator,
  CollectAllIdsFn,
  OrphanedEntry,
  CleanupResult,
  CleanupConfig,
  CleanupLogEntry,
} from "./shared-types.js";

// ── Incremental task usage aggregation ───────────────────────────────

export {
  IncrementalTaskUsageAggregator,
} from "./task-usage/incremental-task-usage.js";

// ── Cleanup scheduling ───────────────────────────────────────────────

export {
  startUsageCleanupScheduler,
  runCleanupCycle,
  identifyOrphanedEntries,
  loadCleanupConfig,
  writeCleanupLog,
  DEFAULT_CLEANUP_INTERVAL_MS,
  type LoadPRDFn,
} from "./task-usage/usage-cleanup-scheduler.js";

// ── Scheduler registration ───────────────────────────────────────────

export {
  registerUsageScheduler,
  type RegisterSchedulerOptions,
} from "./task-usage/register-scheduler.js";
