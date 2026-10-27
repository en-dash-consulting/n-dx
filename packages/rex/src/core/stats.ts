import type { PRDItem } from "../schema/index.js";
import { isWorkItem } from "../schema/index.js";
import { walkTree } from "./tree.js";
import { changeLayerType } from "./layer-projection.js";

/**
 * A projected v2 change with no live tasks: the change itself is the unit of
 * work. A root change projects to level `epic`, which v1 treats as a pure
 * grouping, so without this a task-less change would count for nothing.
 */
export function isTasklessChange(item: PRDItem): boolean {
  return changeLayerType(item) === "change"
    && !(item.children ?? []).some((child) => child.status !== "deleted");
}

export interface TreeStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  failing: number;
  deferred: number;
  blocked: number;
  deleted: number;
}

export function computeStats(items: PRDItem[]): TreeStats {
  const stats: TreeStats = {
    total: 0,
    completed: 0,
    inProgress: 0,
    pending: 0,
    failing: 0,
    deferred: 0,
    blocked: 0,
    deleted: 0,
  };
  for (const { item } of walkTree(items)) {
    // Count work items (tasks, subtasks) and childless containers (features
    // with no children represent actual work, not just groupings).
    // Epics are never counted — they are pure groupings. A task-less v2
    // change counts at any level: it is the work.
    const isLeafContainer = !isWorkItem(item.level) && (!item.children || item.children.length === 0);
    if (!isTasklessChange(item)) {
      if (!isWorkItem(item.level) && !isLeafContainer) continue;
      if (item.level === "epic") continue;
    }

    // Deleted items are tracked separately and excluded from total
    if (item.status === "deleted") {
      stats.deleted++;
      continue;
    }

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
  return stats;
}
