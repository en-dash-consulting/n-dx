/**
 * Shared utilities for the `rex status` command.
 *
 * Extracted from status.ts to break the circular dependency between
 * status.ts and status-sections.ts.  Both modules import from here;
 * neither imports from each other for shared symbols.
 */

import { computeStats } from "../../core/stats.js";
import { isFullyCompleted } from "../../core/prune.js";
import { isRootLevel } from "../../schema/index.js";
import type { PRDItem } from "../../schema/index.js";
import type { TreeStats } from "../../core/stats.js";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

export const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  failing: "✗",
  deferred: "◌",
  blocked: "⊘",
  deleted: "✕",
};

const FILLED = "█";
const EMPTY = "░";
const DEFAULT_BAR_WIDTH = 20;

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

/** Per-task coverage stats, keyed by item ID. */
export type CoverageMap = Map<string, { covered: number; total: number }>;

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                      */
/* ------------------------------------------------------------------ */

/** Render a progress bar string from a completion ratio. */
export function renderProgressBar(
  ratio: number,
  width: number = DEFAULT_BAR_WIDTH,
): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return FILLED.repeat(filled) + EMPTY.repeat(width - filled);
}

/** Format an ISO timestamp as a compact date string for tree display. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${min}`;
}

/** Build a timestamp suffix for tree display. */
function timestampSuffix(item: PRDItem): string {
  if (item.status === "completed" && typeof item.completedAt === "string") {
    const ts = formatTimestamp(item.completedAt);
    return ts ? ` (done ${ts})` : "";
  }
  if (item.status === "in_progress" && typeof item.startedAt === "string") {
    const ts = formatTimestamp(item.startedAt);
    return ts ? ` (started ${ts})` : "";
  }
  if (item.status === "failing" && typeof item.failureReason === "string") {
    return ` (reason: ${item.failureReason})`;
  }
  return "";
}

/** Build a suffix showing blockedBy dependency IDs for blocked items. */
function blockedBySuffix(item: PRDItem): string {
  if (item.status !== "blocked" || !item.blockedBy || item.blockedBy.length === 0) {
    return "";
  }
  return ` (blocked by: ${item.blockedBy.join(", ")})`;
}

/** Format a coverage suffix for a task with acceptance criteria. */
function coverageSuffix(itemId: string, coverage?: CoverageMap): string {
  if (!coverage) return "";
  const entry = coverage.get(itemId);
  if (!entry) return "";

  const { covered, total } = entry;
  if (covered === total) {
    return ` [✓ ${covered}/${total} covered]`;
  }
  if (covered === 0) {
    return ` [✗ ${covered}/${total} covered]`;
  }
  return ` [${covered}/${total} covered]`;
}

function overrideSuffix(item: PRDItem): string {
  if (!item.overrideMarker) return "";
  return ` [override: ${item.overrideMarker.reason}]`;
}

/* ------------------------------------------------------------------ */
/*  Tree rendering                                                    */
/* ------------------------------------------------------------------ */

/**
 * Filter out fully-completed subtrees from items for display.
 *
 * An item is removed when it and all its descendants are completed.
 * Items that are completed but have non-completed children are kept,
 * with their children recursively filtered.
 *
 * Returns a new array — does not mutate the input.
 */
export function filterCompleted(items: PRDItem[]): PRDItem[] {
  const result: PRDItem[] = [];
  for (const item of items) {
    if (isFullyCompleted(item)) continue;
    if (item.children && item.children.length > 0) {
      result.push({ ...item, children: filterCompleted(item.children) });
    } else {
      result.push(item);
    }
  }
  return result;
}

/**
 * Filter out deleted items from the tree for display.
 *
 * Any item with status 'deleted' is removed along with its entire subtree.
 * Non-deleted items that have deleted children will have those children
 * recursively filtered out.
 *
 * Returns a new array — does not mutate the input.
 */
export function filterDeleted(items: PRDItem[]): PRDItem[] {
  const result: PRDItem[] = [];
  for (const item of items) {
    if (item.status === "deleted") continue;
    if (item.children && item.children.length > 0) {
      result.push({ ...item, children: filterDeleted(item.children) });
    } else {
      result.push(item);
    }
  }
  return result;
}

/** Render a PRD tree to lines with status icons and indentation. */
export function renderTree(
  items: PRDItem[],
  indent: number = 0,
  coverage?: CoverageMap,
): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const icon = STATUS_ICONS[item.status] ?? "?";
    const prefix = "  ".repeat(indent);
    const override = overrideSuffix(item);
    const priority = item.priority ? ` [${item.priority}]` : "";
    const ts = timestampSuffix(item);
    const cov = coverageSuffix(item.id, coverage);
    const blocked = blockedBySuffix(item);

    if (item.children && item.children.length > 0) {
      const stats = computeStats(item.children);
      const count = `[${stats.completed}/${stats.total}]`;

      if (isRootLevel(item.level)) {
        const ratio = stats.total > 0 ? stats.completed / stats.total : 0;
        const pct = Math.round(ratio * 100);
        const bar = renderProgressBar(ratio);
        lines.push(
          `${prefix}${icon} ${item.title}${override}${priority} ${bar} ${pct}% ${count}${blocked}`,
        );
      } else {
        lines.push(
          `${prefix}${icon} ${item.title}${override}${priority} ${count}${ts}${blocked}`,
        );
      }
      lines.push(...renderTree(item.children, indent + 1, coverage));
    } else {
      lines.push(`${prefix}${icon} ${item.title}${override}${priority}${cov}${ts}${blocked}`);
    }
  }
  return lines;
}

export function formatStats(
  stats: TreeStats,
  options?: { hidingCompleted?: boolean },
): string {
  const parts = [];
  if (stats.completed > 0) parts.push(`${stats.completed} completed`);
  if (stats.inProgress > 0) parts.push(`${stats.inProgress} in progress`);
  if (stats.pending > 0) parts.push(`${stats.pending} pending`);
  if (stats.failing > 0) parts.push(`${stats.failing} failing`);
  if (stats.deferred > 0) parts.push(`${stats.deferred} deferred`);
  if (stats.blocked > 0) parts.push(`${stats.blocked} blocked`);
  if (stats.deleted > 0) parts.push(`${stats.deleted} deleted`);
  const pct =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  const suffix =
    options?.hidingCompleted
      ? " (hiding completed/deleted items, use --all for full tree)"
      : "";
  return `${parts.join(", ")} — ${pct}% complete (${stats.completed}/${stats.total})${suffix}`;
}
