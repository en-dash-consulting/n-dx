import type { PRDItem, ItemLevel } from "../schema/index.js";
import { LEVEL_HIERARCHY } from "../schema/index.js";
import { walkTree, collectAllIds } from "./tree.js";

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

export interface StructuralResult {
  valid: boolean;
  errors: string[];
  orphanedItems: OrphanedItem[];
  cycles: string[][];
  stuckItems: StuckItem[];
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
 */
export function validateStructure(
  items: PRDItem[],
  options: StructuralOptions = {},
): StructuralResult {
  const errors: string[] = [];
  const orphanedItems = findOrphanedItems(items);
  const cycles = findCycles(items);
  const stuckItems = findStuckItems(items, options);

  for (const orphan of orphanedItems) {
    errors.push(`Orphaned: "${orphan.itemId}" (${orphan.level}) — ${orphan.reason}`);
  }
  for (const cycle of cycles) {
    errors.push(`Cycle: ${cycle.join(" → ")}`);
  }
  for (const stuck of stuckItems) {
    errors.push(`Stuck: "${stuck.itemId}" — ${stuck.reason}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    orphanedItems,
    cycles,
    stuckItems,
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
