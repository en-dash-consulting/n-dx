/**
 * PRD analytics functions — per-epic stats, priority distribution,
 * and requirements summaries.
 *
 * These are read-only aggregations over the PRD tree, used by the web
 * dashboard and potentially other consumers that need summary views.
 *
 * @module core/analytics
 */

import type { PRDItem, ItemStatus, Priority, Requirement } from "../schema/index.js";
import { isRootLevel, isWorkItem } from "../schema/index.js";
import { computeStats, type TreeStats } from "./stats.js";

// ── Epic stats ──────────────────────────────────────────────────────

export interface EpicStats {
  id: string;
  title: string;
  status: ItemStatus;
  priority?: Priority;
  stats: TreeStats;
  percentComplete: number;
}

/** Compute per-epic stats. Each epic's descendants (tasks/subtasks) are counted. */
export function computeEpicStats(items: PRDItem[]): EpicStats[] {
  return items
    .filter((item) => isRootLevel(item.level))
    .map((epic) => {
      const stats = computeStats(epic.children ?? []);
      return {
        id: epic.id,
        title: epic.title,
        status: epic.status,
        priority: epic.priority,
        stats,
        percentComplete: stats.total > 0
          ? Math.round((stats.completed / stats.total) * 100)
          : 0,
      };
    });
}

// ── Priority distribution ───────────────────────────────────────────

export interface PriorityDistribution {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unset: number;
}

/** Count tasks/subtasks by priority across the entire tree. */
export function computePriorityDistribution(items: PRDItem[]): PriorityDistribution {
  const dist: PriorityDistribution = { critical: 0, high: 0, medium: 0, low: 0, unset: 0 };

  function walk(list: PRDItem[]): void {
    for (const item of list) {
      if (isWorkItem(item.level)) {
        const p = item.priority ?? "";
        if (p === "critical") dist.critical++;
        else if (p === "high") dist.high++;
        else if (p === "medium") dist.medium++;
        else if (p === "low") dist.low++;
        else dist.unset++;
      }
      if (Array.isArray(item.children)) walk(item.children);
    }
  }

  walk(items);
  return dist;
}

// ── Requirements summary ────────────────────────────────────────────

export interface RequirementsSummary {
  totalRequirements: number;
  itemsWithRequirements: number;
  byCategory: Record<string, number>;
  byValidationType: Record<string, number>;
}

/** Quick requirements overview — counts and category/type breakdowns. */
export function computeRequirementsSummary(items: PRDItem[]): RequirementsSummary {
  const summary: RequirementsSummary = {
    totalRequirements: 0,
    itemsWithRequirements: 0,
    byCategory: {},
    byValidationType: {},
  };

  const seenIds = new Set<string>();

  function walk(list: PRDItem[]): void {
    for (const item of list) {
      if (item.status === "deleted") continue;
      const reqs = (item.requirements ?? []) as Requirement[];
      if (reqs.length > 0) {
        summary.itemsWithRequirements++;
        for (const req of reqs) {
          if (!seenIds.has(req.id)) {
            seenIds.add(req.id);
            summary.totalRequirements++;
            summary.byCategory[req.category] = (summary.byCategory[req.category] ?? 0) + 1;
            summary.byValidationType[req.validationType] = (summary.byValidationType[req.validationType] ?? 0) + 1;
          }
        }
      }
      if (Array.isArray(item.children)) walk(item.children);
    }
  }

  walk(items);
  return summary;
}
