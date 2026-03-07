import type { PRDItem } from "../schema/index.js";
import { isWorkItem } from "../schema/index.js";
import { walkTree } from "./tree.js";

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
    // Only count work items (not containers) for accurate work metrics
    if (!isWorkItem(item.level)) continue;

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
