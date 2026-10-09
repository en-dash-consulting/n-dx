import type { PRDItem } from "../schema/index.js";
import { walkTree } from "./tree.js";

/**
 * Result of a prune operation on the PRD tree.
 *
 * Contains the pruned items (archived subtrees) and the count of
 * items removed. The pruned items preserve their full subtree structure
 * so they can be archived and reviewed later.
 */
export interface PruneResult {
  /** Items removed from the tree (full subtrees, with children intact). */
  pruned: PRDItem[];
  /** Total number of individual items removed (including nested children). */
  prunedCount: number;
}

/**
 * Count the total number of items in a subtree (item + all descendants).
 */
export function countSubtree(item: PRDItem): number {
  let count = 1;
  if (item.children) {
    for (const child of item.children) {
      count += countSubtree(child);
    }
  }
  return count;
}

/**
 * Check whether an item and all its descendants are completed.
 *
 * An item is considered "fully completed" when:
 * - Its own status is "completed"
 * - All children (recursively) are also "completed" or "deleted"
 *
 * Leaf items (no children) only need their own status to be "completed".
 */
export function isFullyCompleted(item: PRDItem): boolean {
  if (item.status !== "completed") return false;
  if (item.children && item.children.length > 0) {
    return item.children.every(
      (child) => child.status === "deleted" || isFullyCompleted(child),
    );
  }
  return true;
}

/** An item prune keeps although it is fully completed, with the reason. */
export interface KeptItem {
  item: PRDItem;
  reason: string;
}

/**
 * Why prune must keep `item` itself, or undefined.
 *
 * On a v2 tree a product node reads "retired" only while an applied change
 * with a `removed` amendment for it exists, and an `added` amendment records
 * where a node came from. Pruning that change would leave a deleted product
 * node with no status row, so it stays. v1 items carry neither field.
 */
export function pruneKeepReason(item: PRDItem): string | undefined {
  const { appliedAt, amends } = item as PRDItem & { appliedAt?: string; amends?: { delta?: string }[] };
  if (!appliedAt) return undefined;
  const kinds = new Set((amends ?? []).map((a) => a.delta).filter((d) => d === "removed" || d === "added"));
  if (kinds.size === 0) return undefined;
  return kinds.has("removed")
    ? `applied change with ${[...kinds].join(" and ")} amendments: product status reads it to mark a node retired`
    : "applied change with added amendments: it records where a product node came from";
}

/** Whether `item` or any descendant must be kept. */
function holdsKept(item: PRDItem): boolean {
  return pruneKeepReason(item) !== undefined || (item.children ?? []).some(holdsKept);
}

/** Fully completed items prune keeps, with the reason, outermost first. */
export function findKeptItems(items: PRDItem[]): KeptItem[] {
  const kept: KeptItem[] = [];
  for (const { item, parents } of walkTree(items)) {
    const reason = pruneKeepReason(item);
    if (!reason || !isFullyCompleted(item)) continue;
    if (parents.some((p) => pruneKeepReason(p))) continue;
    kept.push({ item, reason });
  }
  return kept;
}

/**
 * Identify which root-level subtrees (and nested subtrees) are fully
 * completed and eligible for pruning.
 *
 * This is a read-only preview — it does not mutate the tree.
 * Use {@link pruneItems} to actually remove items.
 */
export function findPrunableItems(items: PRDItem[]): PRDItem[] {
  const prunable: PRDItem[] = [];
  for (const { item, parents } of walkTree(items)) {
    // Only prune top-level completed subtrees — skip items whose parent
    // is also fully completed (they'll be pruned as part of the parent).
    if (!isFullyCompleted(item) || holdsKept(item) || parents.some((p) => pruneKeepReason(p))) continue;
    const parent = parents[parents.length - 1];
    if (parent && isFullyCompleted(parent) && !holdsKept(parent)) continue;
    prunable.push(item);
  }
  return prunable;
}

/**
 * Remove all fully-completed subtrees from the item tree.
 *
 * Mutates `items` in place — completed subtrees are spliced out
 * and returned in the result so they can be archived.
 *
 * A subtree is pruned when:
 * 1. The item's status is "completed"
 * 2. Every descendant is also "completed"
 *
 * Items that are completed but have non-completed children are NOT pruned
 * (to avoid losing in-progress work).
 */
export function pruneItems(items: PRDItem[]): PruneResult {
  const pruned: PRDItem[] = [];
  let prunedCount = 0;

  // Walk the array in reverse so splicing doesn't shift unvisited indices.
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (pruneKeepReason(item)) continue;
    if (isFullyCompleted(item) && !holdsKept(item)) {
      // The entire subtree is completed — remove it.
      // Use unshift to maintain original order despite reverse iteration.
      pruned.unshift(item);
      prunedCount += countSubtree(item);
      items.splice(i, 1);
    } else {
      // The item itself isn't fully done, but some children might be.
      if (item.children && item.children.length > 0) {
        const childResult = pruneItems(item.children);
        pruned.push(...childResult.pruned);
        prunedCount += childResult.prunedCount;
      }
    }
  }

  return { pruned, prunedCount };
}
