/**
 * Auto-fix common PRD validation issues.
 *
 * Detects and repairs:
 * 1. Missing timestamps.
 * 2. Orphan blockedBy references.
 * 3. Parent-child status misalignment.
 */

import { collectFixItemIds, walkFixTree } from "./tree.js";
import type { FixAction, FixItem, FixItemStatus, FixKind, FixResult } from "./types.js";

export type { FixAction, FixItem, FixItemStatus, FixKind, FixResult };

export function detectTimestampIssues(items: FixItem[]): FixAction[] {
  const actions: FixAction[] = [];

  for (const { item } of walkFixTree(items)) {
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

export function detectOrphanBlockedBy(items: FixItem[]): FixAction[] {
  const allIds = collectFixItemIds(items);
  const actions: FixAction[] = [];

  for (const { item } of walkFixTree(items)) {
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

export function detectParentChildMisalignment(items: FixItem[]): FixAction[] {
  const terminalStatuses = new Set<FixItemStatus>(["completed", "deferred", "deleted"]);
  const actions: FixAction[] = [];

  for (const { item } of walkFixTree(items)) {
    if (item.status !== "completed") continue;
    if (!item.children || item.children.length === 0) continue;

    const nonTerminal = item.children.filter(
      (child) => !terminalStatuses.has(child.status),
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

function applyTimestampFixes(items: FixItem[], now: string): number {
  let count = 0;

  for (const { item } of walkFixTree(items)) {
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

function applyOrphanBlockedByFixes(items: FixItem[]): number {
  const allIds = collectFixItemIds(items);
  let count = 0;

  for (const { item } of walkFixTree(items)) {
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

function applyParentChildFixes(items: FixItem[], now: string): number {
  const terminalStatuses = new Set<FixItemStatus>(["completed", "deferred", "deleted"]);
  let count = 0;

  for (const { item } of walkFixTree(items)) {
    if (item.status !== "completed") continue;
    if (!item.children || item.children.length === 0) continue;

    const nonTerminal = item.children.filter(
      (child) => !terminalStatuses.has(child.status),
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

export function detectIssues(items: FixItem[]): FixAction[] {
  return [
    ...detectTimestampIssues(items),
    ...detectOrphanBlockedBy(items),
    ...detectParentChildMisalignment(items),
  ];
}

export function applyFixes(
  items: FixItem[],
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
