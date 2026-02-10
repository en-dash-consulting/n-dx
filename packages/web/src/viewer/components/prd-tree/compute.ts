/**
 * Pure computation functions for PRD tree statistics.
 * No UI dependencies — easily testable.
 */

import type { PRDItemData, BranchStats, ItemStatus } from "./types.js";

/**
 * Compute stats for a list of items, counting only tasks and subtasks
 * (matching Rex's computeStats behavior).
 */
export function computeBranchStats(items: PRDItemData[]): BranchStats {
  const stats: BranchStats = {
    total: 0,
    completed: 0,
    inProgress: 0,
    pending: 0,
    deferred: 0,
    blocked: 0,
    deleted: 0,
  };

  function walk(nodes: PRDItemData[]): void {
    for (const item of nodes) {
      if (item.level === "task" || item.level === "subtask") {
        stats.total++;
        switch (item.status) {
          case "completed":
            stats.completed++;
            break;
          case "in_progress":
            stats.inProgress++;
            break;
          case "pending":
            stats.pending++;
            break;
          case "deferred":
            stats.deferred++;
            break;
          case "blocked":
            stats.blocked++;
            break;
          case "deleted":
            stats.deleted++;
            break;
        }
      }
      if (item.children && item.children.length > 0) {
        walk(item.children);
      }
    }
  }

  walk(items);
  return stats;
}

/** Compute completion ratio (0–1) from branch stats. */
export function completionRatio(stats: BranchStats): number {
  return stats.total > 0 ? stats.completed / stats.total : 0;
}

/** Count direct children by status. */
export function countChildStatuses(
  children: PRDItemData[],
): Record<ItemStatus, number> {
  const counts: Record<ItemStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    deferred: 0,
    blocked: 0,
    deleted: 0,
  };
  for (const child of children) {
    counts[child.status]++;
  }
  return counts;
}

/**
 * Check if an item or any of its descendants match the status filter.
 * Container items (epics/features) are shown if any descendant matches.
 */
export function itemMatchesFilter(item: PRDItemData, activeStatuses: Set<ItemStatus>): boolean {
  if (activeStatuses.has(item.status)) return true;
  if (item.children) {
    return item.children.some((child) => itemMatchesFilter(child, activeStatuses));
  }
  return false;
}

/**
 * Return a filtered copy of the item tree, keeping only nodes whose status
 * is in `activeStatuses` or that have at least one visible descendant.
 * Parent nodes that survive only because of their children retain only the
 * matching subset in their `children` array.
 */
export function filterTree(
  items: PRDItemData[],
  activeStatuses: Set<ItemStatus>,
): PRDItemData[] {
  const result: PRDItemData[] = [];
  for (const item of items) {
    const filteredChildren = item.children
      ? filterTree(item.children, activeStatuses)
      : undefined;
    const hasVisibleChildren = filteredChildren && filteredChildren.length > 0;
    if (activeStatuses.has(item.status) || hasVisibleChildren) {
      result.push({
        ...item,
        children: filteredChildren,
      });
    }
  }
  return result;
}

/** Format a compact timestamp from ISO string. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${min}`;
}
