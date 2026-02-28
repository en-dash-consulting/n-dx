/**
 * Rex PRD completion status reader — extracts completion state, timestamps,
 * and metadata from the rex PRD for branch work tracking.
 *
 * ## Architecture
 *
 * Like `branch-work-collector`, this module reads `.rex/prd.json` directly
 * from the filesystem using lightweight local type definitions. No runtime
 * import from rex exists here — the domain isolation boundary is preserved.
 *
 * ## Purpose
 *
 * While the collector focuses on *which* items were completed on a branch,
 * the completion reader provides a richer view of the *completion state*:
 *
 * - Per-item completion metadata (status, timestamps, duration)
 * - Aggregate completion statistics (by level, overall percentage)
 * - Chronological completion timeline
 * - Data integrity checks (inconsistent timestamps/statuses)
 *
 * ## Graceful degradation
 *
 * Missing files, corrupted JSON, and invalid data are handled without
 * throwing. Non-fatal errors are collected in an `errors` array on the
 * result, and partial results are returned wherever possible.
 *
 * @module sourcevision/analyzers/completion-reader
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROJECT_DIRS } from "@n-dx/llm-client";

// ---------------------------------------------------------------------------
// Lightweight PRD types (mirrors rex schema — no runtime import from rex)
// ---------------------------------------------------------------------------

/**
 * Minimal PRDItem shape needed for completion reading.
 *
 * Mirrors the collector's PRDItemShape exactly so that values returned
 * by `parsePRDDocument` are directly assignable without casting.
 */
interface PRDItemShape {
  id: string;
  title: string;
  status: string;
  level: string;
  description?: string;
  acceptanceCriteria?: string[];
  startedAt?: string;
  completedAt?: string;
  priority?: string;
  tags?: string[];
  children?: PRDItemShape[];
}

/** Minimal PRDDocument shape. */
interface PRDDocumentShape {
  schema: string;
  title: string;
  items: PRDItemShape[];
}

// ---------------------------------------------------------------------------
// Internal parser
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string into a PRD document shape.
 * Returns null if the input is empty, malformed, or lacks an `items` array.
 *
 * This is a local copy of the parsing logic from `branch-work-collector`
 * so that the returned type includes `startedAt` (needed for duration
 * calculations). The collector's version omits `startedAt` because it
 * only cares about completed items.
 */
function parsePRDDocument(raw: string): PRDDocumentShape | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed as PRDDocumentShape;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Reference to an ancestor in the PRD hierarchy. */
export interface ParentRef {
  id: string;
  title: string;
  level: string;
}

/** Completion state for a single PRD item. */
export interface CompletionState {
  /** Unique PRD item ID. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Current item status. */
  status: string;
  /** PRD hierarchy level. */
  level: string;
  /** ISO timestamp when work started (first in_progress transition). */
  startedAt?: string;
  /** ISO timestamp when the item was marked completed. */
  completedAt?: string;
  /**
   * Duration from startedAt to completedAt in milliseconds.
   * Null when either timestamp is missing or invalid.
   */
  durationMs: number | null;
  /** Item priority. */
  priority?: string;
  /** Free-form tags. */
  tags?: string[];
  /** Ancestor chain from root to parent (excludes the item itself). */
  parentChain: ParentRef[];
}

/** Per-level completion counts. */
export interface LevelCount {
  total: number;
  completed: number;
}

/** Aggregate completion statistics across the PRD tree. */
export interface CompletionStats {
  /**
   * Total work items (tasks + subtasks only, excluding deleted).
   * Matches rex's convention where epics/features are containers,
   * not work units.
   */
  total: number;
  /** Number of completed work items (tasks + subtasks). */
  completed: number;
  /** Number of in-progress work items. */
  inProgress: number;
  /** Number of pending work items. */
  pending: number;
  /** Number of failing work items. */
  failing: number;
  /** Number of deferred work items. */
  deferred: number;
  /** Number of blocked work items. */
  blocked: number;
  /** Number of deleted work items (excluded from total). */
  deleted: number;
  /** Completion percentage (0–100). 0 when total is 0. */
  percentComplete: number;
  /** Counts broken down by hierarchy level (all levels, not just work items). */
  byLevel: Record<string, LevelCount>;
}

/** A single entry in the completion timeline. */
export interface TimelineEntry {
  id: string;
  title: string;
  level: string;
  completedAt?: string;
}

/** Ordered timeline of completed items. */
export interface CompletionTimeline {
  /** Completed items sorted by completedAt ascending. */
  entries: TimelineEntry[];
  /** Earliest completedAt timestamp (undefined when no entries). */
  earliest?: string;
  /** Latest completedAt timestamp (undefined when no entries). */
  latest?: string;
}

/** Type of data inconsistency detected. */
export type InconsistencyType =
  | "missing_completed_at"
  | "stale_completed_at"
  | "completed_before_started";

/** A detected inconsistency in PRD completion data. */
export interface CompletionInconsistency {
  /** Item ID with the issue. */
  itemId: string;
  /** Item title for human-readable context. */
  itemTitle: string;
  /** Category of inconsistency. */
  type: InconsistencyType;
  /** Human-readable description of the issue. */
  message: string;
}

/** Full result from the completion status reader. */
export interface CompletionStatusResult {
  /** PRD document title. */
  prdTitle?: string;
  /** ISO timestamp when the read was performed. */
  readAt: string;
  /** Completion state for each item (optionally filtered by itemIds). */
  items: CompletionState[];
  /** Aggregate completion statistics. */
  stats: CompletionStats;
  /** Chronological timeline of completed items. */
  timeline: CompletionTimeline;
  /** Data integrity issues detected. */
  inconsistencies: CompletionInconsistency[];
  /** Non-fatal errors encountered during reading. */
  errors?: string[];
}

/** Options for the completion status reader. */
export interface CompletionReaderOptions {
  /** Project root directory. */
  dir: string;
  /** Optional set of item IDs to restrict results to. */
  itemIds?: Set<string>;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Compute the duration between two ISO timestamp strings in milliseconds.
 * Returns null if either timestamp is missing or produces an invalid date.
 */
function computeDuration(
  startedAt: string | undefined,
  completedAt: string | undefined,
): number | null {
  if (!startedAt || !completedAt) return null;

  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();

  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  return end - start;
}

/**
 * Extract completion state for a single PRD item.
 *
 * @param item    - PRD item to extract completion state from
 * @param parents - Optional ancestor chain (from root to parent)
 */
export function extractItemCompletion(
  item: PRDItemShape,
  parents: ParentRef[] = [],
): CompletionState {
  const typed = item;

  return {
    id: typed.id,
    title: typed.title,
    status: typed.status,
    level: typed.level,
    ...(typed.startedAt !== undefined && { startedAt: typed.startedAt }),
    ...(typed.completedAt !== undefined && { completedAt: typed.completedAt }),
    durationMs: computeDuration(typed.startedAt, typed.completedAt),
    ...(typed.priority !== undefined && { priority: typed.priority }),
    ...(typed.tags !== undefined && { tags: typed.tags }),
    parentChain: [...parents],
  };
}

/**
 * Walk the PRD tree and collect completion states for all items.
 * Optionally filters to only include items in the given ID set.
 */
function walkAndExtract(
  items: PRDItemShape[],
  itemIds?: Set<string>,
): CompletionState[] {
  const result: CompletionState[] = [];

  function walk(list: PRDItemShape[], parents: ParentRef[]): void {
    for (const item of list) {
      if (!itemIds || itemIds.has(item.id)) {
        result.push(extractItemCompletion(item, parents));
      }

      if (item.children) {
        walk(item.children, [
          ...parents,
          { id: item.id, title: item.title, level: item.level },
        ]);
      }
    }
  }

  walk(items, []);
  return result;
}

/**
 * Compute aggregate completion statistics for a PRD tree.
 *
 * Follows rex's convention: `total` counts only tasks and subtasks
 * (epics and features are containers, not work units). Deleted items
 * are tracked separately and excluded from the total.
 *
 * @param items - Top-level PRD items (with nested children)
 */
export function computeCompletionStats(
  items: PRDItemShape[],
): CompletionStats {
  const stats: CompletionStats = {
    total: 0,
    completed: 0,
    inProgress: 0,
    pending: 0,
    failing: 0,
    deferred: 0,
    blocked: 0,
    deleted: 0,
    percentComplete: 0,
    byLevel: {},
  };

  function ensureLevel(level: string): void {
    if (!stats.byLevel[level]) {
      stats.byLevel[level] = { total: 0, completed: 0 };
    }
  }

  function walk(list: PRDItemShape[]): void {
    for (const item of list) {
      const level = item.level;
      const status = item.status;
      const isWorkItem = level === "task" || level === "subtask";

      ensureLevel(level);

      // Track per-level counts (all levels)
      if (status !== "deleted") {
        stats.byLevel[level].total++;
        if (status === "completed") {
          stats.byLevel[level].completed++;
        }
      }

      // Track work-item stats (tasks + subtasks only, matching rex)
      if (isWorkItem) {
        if (status === "deleted") {
          stats.deleted++;
        } else {
          stats.total++;
          switch (status) {
            case "completed":
              stats.completed++;
              break;
            case "in_progress":
              stats.inProgress++;
              break;
            case "pending":
              stats.pending++;
              break;
            case "failing":
              stats.failing++;
              break;
            case "deferred":
              stats.deferred++;
              break;
            case "blocked":
              stats.blocked++;
              break;
          }
        }
      }

      if (item.children) {
        walk(item.children);
      }
    }
  }

  walk(items);

  stats.percentComplete =
    stats.total > 0 ? (stats.completed / stats.total) * 100 : 0;

  return stats;
}

/**
 * Detect data inconsistencies in completion timestamps and statuses.
 *
 * Checks for:
 * - `missing_completed_at`: item has status "completed" but no completedAt
 * - `stale_completed_at`: item has completedAt but status is not "completed"
 * - `completed_before_started`: completedAt is earlier than startedAt
 *
 * @param items - Top-level PRD items (with nested children)
 */
export function detectInconsistencies(
  items: PRDItemShape[],
): CompletionInconsistency[] {
  const issues: CompletionInconsistency[] = [];

  function walk(list: PRDItemShape[]): void {
    for (const item of list) {
      // Completed without completedAt
      if (item.status === "completed" && !item.completedAt) {
        issues.push({
          itemId: item.id,
          itemTitle: item.title,
          type: "missing_completed_at",
          message: `Item "${item.title}" is completed but has no completedAt timestamp`,
        });
      }

      // Non-completed with stale completedAt
      if (item.status !== "completed" && item.completedAt) {
        issues.push({
          itemId: item.id,
          itemTitle: item.title,
          type: "stale_completed_at",
          message: `Item "${item.title}" has completedAt but status is "${item.status}"`,
        });
      }

      // completedAt before startedAt
      if (item.startedAt && item.completedAt) {
        const start = new Date(item.startedAt).getTime();
        const end = new Date(item.completedAt).getTime();
        if (!Number.isNaN(start) && !Number.isNaN(end) && end < start) {
          issues.push({
            itemId: item.id,
            itemTitle: item.title,
            type: "completed_before_started",
            message: `Item "${item.title}" has completedAt (${item.completedAt}) before startedAt (${item.startedAt})`,
          });
        }
      }

      if (item.children) {
        walk(item.children);
      }
    }
  }

  walk(items);
  return issues;
}

/**
 * Build a chronological timeline of completed items.
 *
 * Items are sorted by `completedAt` ascending. Items without a
 * `completedAt` timestamp are placed at the end of the timeline.
 *
 * @param items - Top-level PRD items (with nested children)
 */
export function computeCompletionTimeline(
  items: PRDItemShape[],
): CompletionTimeline {
  const entries: TimelineEntry[] = [];

  function walk(list: PRDItemShape[]): void {
    for (const item of list) {
      if (item.status === "completed") {
        entries.push({
          id: item.id,
          title: item.title,
          level: item.level,
          ...(item.completedAt !== undefined && { completedAt: item.completedAt }),
        });
      }

      if (item.children) {
        walk(item.children);
      }
    }
  }

  walk(items);

  // Sort by completedAt ascending; items without completedAt go to the end
  entries.sort((a, b) => {
    if (!a.completedAt && !b.completedAt) return 0;
    if (!a.completedAt) return 1;
    if (!b.completedAt) return -1;
    return a.completedAt.localeCompare(b.completedAt);
  });

  // Compute earliest/latest
  const withTimestamp = entries.filter((e) => e.completedAt);
  const earliest = withTimestamp.length > 0 ? withTimestamp[0].completedAt : undefined;
  const latest = withTimestamp.length > 0 ? withTimestamp[withTimestamp.length - 1].completedAt : undefined;

  return { entries, earliest, latest };
}

// ---------------------------------------------------------------------------
// Main reader
// ---------------------------------------------------------------------------

/**
 * Read completion status from the rex PRD file.
 *
 * This is the primary entry point for extracting completion metadata
 * from `.rex/prd.json`. It composes the pure helper functions above
 * into a single read-only operation.
 *
 * Gracefully handles:
 * - Missing `.rex/prd.json` (returns empty result)
 * - Corrupted PRD JSON (returns empty result with error)
 * - Invalid timestamps (flags inconsistencies)
 *
 * @param options - Reader configuration
 * @returns Full completion status result
 */
export async function readCompletionStatus(
  options: CompletionReaderOptions,
): Promise<CompletionStatusResult> {
  const dir = resolve(options.dir);
  const errors: string[] = [];
  const now = new Date().toISOString();

  const emptyResult: CompletionStatusResult = {
    readAt: now,
    items: [],
    stats: computeCompletionStats([]),
    timeline: { entries: [] },
    inconsistencies: [],
  };

  // ── 1. Read current PRD from disk ────────────────────────────

  const prdPath = join(dir, PROJECT_DIRS.REX, "prd.json");

  if (!existsSync(prdPath)) {
    return emptyResult;
  }

  let rawPRD: string;
  try {
    rawPRD = readFileSync(prdPath, "utf-8");
  } catch (err) {
    errors.push(
      `Failed to read PRD: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ...emptyResult, errors };
  }

  const doc = parsePRDDocument(rawPRD);
  if (!doc) {
    errors.push("PRD file exists but could not be parsed");
    return { ...emptyResult, errors };
  }

  // ── 2. Extract completion states ─────────────────────────────

  const items = walkAndExtract(doc.items, options.itemIds);

  // ── 3. Compute stats (always over full tree, not filtered) ───

  const stats = computeCompletionStats(doc.items);

  // ── 4. Build timeline (from full tree) ───────────────────────

  const timeline = computeCompletionTimeline(doc.items);

  // ── 5. Detect inconsistencies (from full tree) ───────────────

  const inconsistencies = detectInconsistencies(doc.items);

  return {
    prdTitle: doc.title,
    readAt: now,
    items,
    stats,
    timeline,
    inconsistencies,
    ...(errors.length > 0 && { errors }),
  };
}
