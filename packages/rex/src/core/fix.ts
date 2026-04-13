/**
 * Auto-fix common PRD validation issues.
 *
 * Detects and repairs:
 * 1. **Missing timestamps** — adds `startedAt` / `completedAt` based on status.
 * 2. **Orphan blockedBy references** — clears IDs that don't exist in the tree.
 * 3. **Parent-child status alignment** — resets completed parents whose
 *    children are not all terminal.
 *
 * Each fix is reported individually so callers can preview (`--dry-run`)
 * or log what changed.
 *
 * @module core/fix
 */

import type { PRDItem, ItemStatus } from "../schema/index.js";
import { walkTree, collectAllIds } from "./tree.js";

// Re-export schema types used in this module's public API so consumers can
// import them from a single location without reaching into schema directly.
export type { PRDItem, ItemStatus };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FixKind =
  | "missing_timestamp"
  | "orphan_blocked_by"
  | "parent_child_alignment";

export interface FixAction {
  /** Which category this fix belongs to. */
  kind: FixKind;
  /** The affected item ID. */
  itemId: string;
  /** Human-readable description of the fix. */
  description: string;
}

export interface FixResult {
  /** Actions that were (or would be) applied. */
  actions: FixAction[];
  /** Count of items mutated (0 in dry-run). */
  mutatedCount: number;
}

// ---------------------------------------------------------------------------
// Detection helpers (pure — no mutations)
// ---------------------------------------------------------------------------

/**
 * Find items whose timestamps are inconsistent with their status:
 * - `completed` without `completedAt`
 * - `in_progress` or `completed` without `startedAt`
 * - Non-completed with stale `completedAt`
 */
export function detectTimestampIssues(items: PRDItem[]): FixAction[] {
  const actions: FixAction[] = [];

  for (const { item } of walkTree(items)) {
    if (item.status === "completed" && !item.completedAt) {
      actions.push({
        kind: "missing_timestamp",
        itemId: item.id,
        description: `Add completedAt to completed item "${item.title}"`,
      });
    }

    if (
      (item.status === "in_progress" || item.status === "completed") &&
      !item.startedAt
    ) {
      actions.push({
        kind: "missing_timestamp",
        itemId: item.id,
        description: `Add startedAt to ${item.status} item "${item.title}"`,
      });
    }

    if (item.status !== "completed" && item.completedAt) {
      actions.push({
        kind: "missing_timestamp",
        itemId: item.id,
        description: `Clear stale completedAt from ${item.status} item "${item.title}"`,
      });
    }
  }

  return actions;
}

/**
 * Find blockedBy references that point to IDs not present in the tree.
 */
export function detectOrphanBlockedBy(items: PRDItem[]): FixAction[] {
  const allIds = collectAllIds(items);
  const actions: FixAction[] = [];

  for (const { item } of walkTree(items)) {
    if (!item.blockedBy || item.blockedBy.length === 0) continue;

    const orphans = item.blockedBy.filter((ref) => !allIds.has(ref));
    if (orphans.length > 0) {
      actions.push({
        kind: "orphan_blocked_by",
        itemId: item.id,
        description: `Remove ${orphans.length} orphan blockedBy ref${orphans.length > 1 ? "s" : ""} from "${item.title}": ${orphans.map((id) => id.slice(0, 8)).join(", ")}`,
      });
    }
  }

  return actions;
}

/**
 * Find completed parents whose children are not all in terminal states.
 * These parents should be reset to `in_progress`.
 */
export function detectParentChildMisalignment(items: PRDItem[]): FixAction[] {
  const terminalStatuses = new Set<ItemStatus>(["completed", "deferred", "deleted"]);
  const actions: FixAction[] = [];

  for (const { item } of walkTree(items)) {
    if (item.status !== "completed") continue;
    if (!item.children || item.children.length === 0) continue;

    const nonTerminal = item.children.filter(
      (c) => !terminalStatuses.has(c.status),
    );
    if (nonTerminal.length > 0) {
      actions.push({
        kind: "parent_child_alignment",
        itemId: item.id,
        description: `Reset completed parent "${item.title}" to in_progress (${nonTerminal.length} non-terminal child${nonTerminal.length > 1 ? "ren" : ""})`,
      });
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

function applyTimestampFixes(items: PRDItem[], now: string): number {
  let count = 0;

  for (const { item } of walkTree(items)) {
    if (item.status === "completed" && !item.completedAt) {
      item.completedAt = now;
      count++;
    }

    if (
      (item.status === "in_progress" || item.status === "completed") &&
      !item.startedAt
    ) {
      item.startedAt = now;
      count++;
    }

    if (item.status !== "completed" && item.completedAt) {
      delete item.completedAt;
      count++;
    }
  }

  return count;
}

function applyOrphanBlockedByFixes(items: PRDItem[]): number {
  const allIds = collectAllIds(items);
  let count = 0;

  for (const { item } of walkTree(items)) {
    if (!item.blockedBy || item.blockedBy.length === 0) continue;

    const before = item.blockedBy.length;
    item.blockedBy = item.blockedBy.filter((ref) => allIds.has(ref));

    if (item.blockedBy.length < before) {
      count++;
    }

    if (item.blockedBy.length === 0) {
      delete item.blockedBy;
    }
  }

  return count;
}

function applyParentChildFixes(items: PRDItem[], now: string): number {
  const terminalStatuses = new Set<ItemStatus>(["completed", "deferred", "deleted"]);
  let count = 0;

  for (const { item } of walkTree(items)) {
    if (item.status !== "completed") continue;
    if (!item.children || item.children.length === 0) continue;

    const nonTerminal = item.children.filter(
      (c) => !terminalStatuses.has(c.status),
    );
    if (nonTerminal.length > 0) {
      item.status = "in_progress";
      if (!item.startedAt) {
        item.startedAt = now;
      }
      delete item.completedAt;
      count++;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect all fixable issues in a PRD tree.
 * Pure function — does not mutate items.
 */
export function detectIssues(items: PRDItem[]): FixAction[] {
  return [
    ...detectTimestampIssues(items),
    ...detectOrphanBlockedBy(items),
    ...detectParentChildMisalignment(items),
  ];
}

/**
 * Apply all auto-fixes to a PRD tree.
 * Mutates items in-place and returns a summary of what was done.
 *
 * @param items - The PRD items array (mutated in-place).
 * @param now   - ISO timestamp to use for new timestamps (default: current time).
 */
export function applyFixes(
  items: PRDItem[],
  now?: string,
): FixResult {
  const actions = detectIssues(items);

  if (actions.length === 0) {
    return { actions, mutatedCount: 0 };
  }

  const timestamp = now ?? new Date().toISOString();

  const tsCount = applyTimestampFixes(items, timestamp);
  const orphanCount = applyOrphanBlockedByFixes(items);
  const parentCount = applyParentChildFixes(items, timestamp);

  return {
    actions,
    mutatedCount: tsCount + orphanCount + parentCount,
  };
}
