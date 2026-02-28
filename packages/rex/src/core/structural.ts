import type { PRDItem, ItemLevel } from "../schema/index.js";
import { LEVEL_HIERARCHY } from "../schema/index.js";
import { walkTree, collectAllIds } from "./tree.js";

export interface EpiclessFeature {
  itemId: string;
  title: string;
  status: string;
  childCount: number;
}

export interface OrphanedItem {
  itemId: string;
  title: string;
  level: ItemLevel;
  reason: string;
}

export interface StuckItem {
  itemId: string;
  title: string;
  stuckSinceMs: number;
  reason: string;
}

export interface EmptyContainerItem {
  itemId: string;
  title: string;
  level: ItemLevel;
  reason: string;
}

export interface StructuralResult {
  valid: boolean;
  errors: string[];
  /** Non-fatal issues (e.g. blocked items without blockedBy). */
  warnings: string[];
  orphanedItems: OrphanedItem[];
  cycles: string[][];
  stuckItems: StuckItem[];
  /** Epics/features with no (non-deleted) children — indicates incomplete work. */
  emptyContainers: EmptyContainerItem[];
}

export interface StructuralOptions {
  /** Threshold in milliseconds before an in_progress task is considered stuck. Default: 48 hours. */
  stuckThresholdMs?: number;
  /** Override "now" for testing. Default: Date.now(). */
  now?: number;
}

const DEFAULT_STUCK_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Validate structural integrity of a PRD tree beyond schema and DAG checks.
 *
 * Detects:
 * 1. Orphaned items — placed at a level that violates the hierarchy rules
 * 2. Circular blockedBy references — cycles in the dependency graph
 * 3. Stuck tasks — in_progress for too long or missing startedAt
 *
 * Warns:
 * - Items with status "blocked" but no blockedBy dependencies
 * - Empty containers — epics/features with no (non-deleted) children
 */
export function validateStructure(
  items: PRDItem[],
  options: StructuralOptions = {},
): StructuralResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const orphanedItems = findOrphanedItems(items);
  const cycles = findCycles(items);
  const stuckItems = findStuckItems(items, options);
  const emptyContainers = findEmptyContainers(items);

  for (const orphan of orphanedItems) {
    errors.push(`Orphaned: "${orphan.itemId}" (${orphan.level}) — ${orphan.reason}`);
  }
  for (const cycle of cycles) {
    errors.push(`Cycle: ${cycle.join(" → ")}`);
  }
  for (const stuck of stuckItems) {
    errors.push(`Stuck: "${stuck.itemId}" — ${stuck.reason}`);
  }
  for (const ec of emptyContainers) {
    warnings.push(
      `Empty container: "${ec.itemId}" (${ec.title}) — ${ec.reason}`,
    );
  }

  // Warn about blocked items with no recorded dependencies
  for (const { item } of walkTree(items)) {
    if (
      item.status === "blocked" &&
      (!item.blockedBy || item.blockedBy.length === 0)
    ) {
      warnings.push(
        `Blocked without dependencies: "${item.id}" (${item.title}) — ` +
        `status is "blocked" but blockedBy is empty. Consider adding dependency IDs ` +
        `or recording the blocker reason in the description.`,
      );
    }
  }

  // Timestamp and status-field consistency
  const timestampWarnings = findTimestampInconsistencies(items);
  warnings.push(...timestampWarnings);

  // Parent-child status consistency
  const parentChildWarnings = findParentChildInconsistencies(items);
  warnings.push(...parentChildWarnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    orphanedItems,
    cycles,
    stuckItems,
    emptyContainers,
  };
}

/**
 * Find items whose placement violates the LEVEL_HIERARCHY rules.
 */
function findOrphanedItems(items: PRDItem[]): OrphanedItem[] {
  const orphans: OrphanedItem[] = [];

  for (const { item, parents } of walkTree(items)) {
    const parentLevel: ItemLevel | null =
      parents.length > 0 ? parents[parents.length - 1].level : null;

    const allowedParents = LEVEL_HIERARCHY[item.level];
    if (!allowedParents.includes(parentLevel)) {
      const placement = parentLevel === null ? "root" : `under ${parentLevel}`;
      const expected = allowedParents
        .map((l) => (l === null ? "root" : l))
        .join(" or ");
      orphans.push({
        itemId: item.id,
        title: item.title,
        level: item.level,
        reason: `${item.level} at ${placement}, expected under ${expected}`,
      });
    }
  }

  return orphans;
}

/**
 * Container levels that should have children to be meaningful.
 * Tasks and subtasks are leaf-level work items and don't require children.
 */
const CONTAINER_LEVELS = new Set<ItemLevel>(["epic", "feature"]);

/**
 * Terminal statuses where an empty container is expected or acceptable.
 * Completed, deferred, and deleted items don't need children.
 */
const TERMINAL_CONTAINER_STATUSES = new Set<string>(["completed", "deferred", "deleted"]);

/**
 * Find epics and features with no (non-deleted) children.
 * These indicate incomplete work — a container was created but never populated.
 */
function findEmptyContainers(items: PRDItem[]): EmptyContainerItem[] {
  const empty: EmptyContainerItem[] = [];

  for (const { item } of walkTree(items)) {
    if (!CONTAINER_LEVELS.has(item.level)) continue;
    if (TERMINAL_CONTAINER_STATUSES.has(item.status)) continue;

    const liveChildren = (item.children ?? []).filter(
      (c) => c.status !== "deleted",
    );

    if (liveChildren.length === 0) {
      empty.push({
        itemId: item.id,
        title: item.title,
        level: item.level,
        reason: `${item.level} has no child items`,
      });
    }
  }

  return empty;
}

/**
 * Find cycles in the blockedBy dependency graph.
 *
 * Returns each cycle as an array of IDs forming the loop (last element
 * repeats the first to show the cycle closing).
 */
function findCycles(items: PRDItem[]): string[][] {
  const allIds = collectAllIds(items);
  const cycles: string[][] = [];

  // Build adjacency: item → items it depends on (via blockedBy)
  const adjacency = new Map<string, string[]>();
  for (const { item } of walkTree(items)) {
    if (item.blockedBy && item.blockedBy.length > 0) {
      adjacency.set(
        item.id,
        item.blockedBy.filter((dep) => allIds.has(dep)),
      );
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart).concat(node));
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    for (const dep of adjacency.get(node) ?? []) {
      dfs(dep, [...path, node]);
    }

    inStack.delete(node);
  }

  for (const id of allIds) {
    if (!visited.has(id)) {
      dfs(id, []);
    }
  }

  return cycles;
}

/**
 * Find timestamp and status-field inconsistencies.
 *
 * Detects:
 * - Completed items without completedAt
 * - Non-completed items with stale completedAt
 * - completedAt before startedAt
 */
function findTimestampInconsistencies(items: PRDItem[]): string[] {
  const warnings: string[] = [];

  for (const { item } of walkTree(items)) {
    // Completed items should have completedAt
    if (item.status === "completed" && !item.completedAt) {
      warnings.push(
        `Timestamp inconsistency: "${item.id}" (${item.title}) — ` +
        `status is "completed" but completedAt is missing.`,
      );
    }

    // Non-completed items should not have completedAt
    if (item.status !== "completed" && item.completedAt) {
      warnings.push(
        `Timestamp inconsistency: "${item.id}" (${item.title}) — ` +
        `status is "${item.status}" but completedAt is set. ` +
        `Consider clearing completedAt or updating the status.`,
      );
    }

    // completedAt must be after startedAt
    if (item.startedAt && item.completedAt) {
      const started = new Date(item.startedAt).getTime();
      const completed = new Date(item.completedAt).getTime();
      if (completed < started) {
        warnings.push(
          `Timestamp inconsistency: "${item.id}" (${item.title}) — ` +
          `completedAt is before startedAt.`,
        );
      }
    }
  }

  return warnings;
}

/**
 * Find parent-child status inconsistencies.
 *
 * Detects:
 * - Completed parent with non-terminal children (pending, in_progress, blocked)
 */
function findParentChildInconsistencies(items: PRDItem[]): string[] {
  const warnings: string[] = [];
  const terminalStatuses = new Set<string>(["completed", "deferred"]);

  for (const { item } of walkTree(items)) {
    if (item.status !== "completed") continue;
    if (!item.children || item.children.length === 0) continue;

    const nonTerminal = item.children.filter((c) => !terminalStatuses.has(c.status));
    if (nonTerminal.length > 0) {
      const childSummary = nonTerminal
        .slice(0, 3)
        .map((c) => `"${c.title}" (${c.status})`)
        .join(", ");
      const more = nonTerminal.length > 3 ? ` +${nonTerminal.length - 3} more` : "";
      warnings.push(
        `Parent-child inconsistency: "${item.id}" (${item.title}) — ` +
        `status is "completed" but has non-terminal children: ${childSummary}${more}.`,
      );
    }
  }

  return warnings;
}

/**
 * Find features positioned at root level without a parent epic.
 *
 * These violate the hierarchy rule that features must be under an epic.
 * Returns structured data for each epicless feature, including status
 * and non-deleted child count, suitable for interactive resolution prompts.
 */
export function findEpiclessFeatures(items: PRDItem[]): EpiclessFeature[] {
  return items
    .filter((item) => item.level === "feature" && item.status !== "deleted")
    .map((item) => ({
      itemId: item.id,
      title: item.title,
      status: item.status,
      childCount: (item.children ?? []).filter((c) => c.status !== "deleted").length,
    }));
}

/**
 * Find tasks that are in_progress for too long or are missing startedAt.
 */
function findStuckItems(
  items: PRDItem[],
  options: StructuralOptions,
): StuckItem[] {
  const threshold = options.stuckThresholdMs ?? DEFAULT_STUCK_THRESHOLD_MS;
  const now = options.now ?? Date.now();
  const stuck: StuckItem[] = [];

  for (const { item } of walkTree(items)) {
    if (item.status !== "in_progress") continue;

    if (!item.startedAt) {
      stuck.push({
        itemId: item.id,
        title: item.title,
        stuckSinceMs: 0,
        reason: "in_progress with no startedAt timestamp",
      });
      continue;
    }

    const started = new Date(item.startedAt).getTime();
    const elapsed = now - started;

    if (elapsed > threshold) {
      const hours = Math.floor(elapsed / (60 * 60 * 1000));
      stuck.push({
        itemId: item.id,
        title: item.title,
        stuckSinceMs: elapsed,
        reason: `in_progress for ${hours}h (threshold: ${Math.floor(threshold / (60 * 60 * 1000))}h)`,
      });
    }
  }

  return stuck;
}
