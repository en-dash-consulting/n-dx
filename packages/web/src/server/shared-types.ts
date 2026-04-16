/**
 * Neutral type definitions shared across server zones.
 *
 * This module breaks dependency cycles between the task-usage-analytics
 * and web-dashboard zones by providing a single, zone-neutral home for
 * types that both zones reference. Without this file, types like
 * `CollectAllIdsFn` and `TaskUsageAccumulator` create implicit coupling
 * when one zone defines them and the other imports them directly.
 *
 * ## Stability contract
 *
 * **@public** — These types form the cross-zone analytics contract.
 * Breaking changes (field renames, type narrowing, removal) require
 * coordinated updates in all consuming files:
 *   - task-usage.ts, incremental-task-usage.ts (task-usage-analytics zone)
 *   - usage-cleanup-scheduler.ts, register-scheduler.ts (web-dashboard zone)
 *   - public.ts (package public API)
 *
 * Add new types freely. Modify existing types only with a grep for all
 * import sites in `packages/web/src/server/`.
 *
 * Rules:
 * - Types only — no runtime code, no side effects.
 * - Both zones import FROM here; neither zone re-exports these types.
 * - New cross-zone types should be added here rather than in leaf files.
 *
 * @public
 * @module web/server/shared-types
 */

// ---------------------------------------------------------------------------
// Task usage aggregation
// ---------------------------------------------------------------------------

/** Aggregated token usage for a single task. */
export interface TaskUsageAccumulator {
  totalTokens: number;
  runCount: number;
}

// ---------------------------------------------------------------------------
// Cleanup scheduling
// ---------------------------------------------------------------------------

/**
 * Callback that extracts valid task IDs from a flat array of PRD items.
 *
 * Injected by the caller to avoid a direct import of rex-gateway in the
 * cleanup zone, which would create a bidirectional dependency cycle.
 */
export type CollectAllIdsFn = (items: unknown[]) => Set<string>;

/**
 * Signature for PRD loaders compatible with `loadPRDSync`.
 *
 * Injected by the caller to avoid cross-zone coupling between the cleanup
 * scheduler and the rex gateway. Defined here alongside CollectAllIdsFn
 * so both injection-seam types share a neutral home.
 */
export type LoadPRDFn = (rexDir: string) => unknown;

/** A single orphaned usage entry identified during cleanup. */
export interface OrphanedEntry {
  taskId: string;
  totalTokens: number;
  runCount: number;
}

/** Result of a single cleanup cycle. */
export interface CleanupResult {
  timestamp: string;
  prdAvailable: boolean;
  orphanedEntries: OrphanedEntry[];
  totalOrphaned: number;
  totalTokensRemoved: number;
  totalRunsRemoved: number;
}

/** Persistent log entry written to the cleanup JSONL audit file. */
export interface CleanupLogEntry extends CleanupResult {
  event: "usage_cleanup";
}

/** Cleanup configuration read from `.n-dx.json`. */
export interface CleanupConfig {
  /** Cleanup interval in milliseconds. */
  intervalMs: number;
}
