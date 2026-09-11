/**
 * Automatic parent completion for PRD items.
 *
 * When all children of a parent item are `completed`, the parent can be
 * automatically marked as completed. This walks up the tree from a given
 * item, propagating completion as far as it goes.
 *
 * Rules:
 * - A parent is auto-completable when *every* child is `completed`.
 *   `deferred`, `blocked`, and `failing` are terminal-in-the-sense-of-stopped
 *   but NOT successful — a child in any of those states means the work is
 *   not actually done, so it must block the parent from auto-completing
 *   (GitHub #364: an epic was reported complete with deferred children still
 *   outstanding — half-migrated work read as finished).
 * - Propagation walks up the ancestor chain: if completing a parent makes its
 *   own parent fully done, that grandparent is completed too.
 * - Only items with `pending` or `in_progress` status are auto-completed
 *   (already-completed, deferred, and blocked parents are left alone).
 * - Returns the list of item IDs that were auto-completed, bottom-up.
 *
 * @module core/parent-completion
 */

import type { PRDItem, ItemStatus } from "../schema/index.js";
import { findItem } from "./tree.js";

export interface AutoCompletionResult {
  /** IDs of items that should be auto-completed, ordered bottom-up (child → ancestor). */
  completedIds: string[];
  /** Human-readable descriptions of what was auto-completed. */
  completedItems: Array<{ id: string; title: string; level: string }>;
}

const AUTO_COMPLETABLE_STATUSES: Set<ItemStatus> = new Set(["pending", "in_progress"]);

/**
 * The only child status that counts as successfully done for the purpose of
 * auto-completing a parent. `deferred`, `blocked`, and `failing` are all
 * terminal-ish (they stop a task from progressing further on its own) but
 * they are not *successful* completions, so they must not let a parent be
 * reported as done. This is the single predicate every auto-completion check
 * in the codebase should use — see `remove-task.ts`, `structural.ts`, and
 * `cli/commands/status-sections.ts`.
 */
export const SUCCESSFUL_CHILD_STATUSES: Set<ItemStatus> = new Set(["completed"]);

/**
 * Check whether all children of an item are successfully done (`completed`),
 * treating any IDs in `virtuallyCompleted` as if they were already completed.
 */
export function allChildrenSuccessful(
  item: PRDItem,
  virtuallyCompleted: Set<string>,
): boolean {
  if (!item.children || item.children.length === 0) return false;
  return item.children.every(
    (c) => SUCCESSFUL_CHILD_STATUSES.has(c.status) || virtuallyCompleted.has(c.id),
  );
}

/**
 * Scan the whole PRD tree bottom-up and return every parent that is
 * `pending` or `in_progress` but whose children are all `completed`.
 * Operates independently of any single trigger item, so it self-heals
 * parents whose event-driven cascade was previously lost (e.g. due to an
 * `appendLog` failure after child completion).
 *
 * Items are returned bottom-up: a feature appears before its epic so that
 * callers can apply updates in order without re-checking the tree.
 *
 * @param items - The full PRD item tree.
 * @returns Items to auto-complete, ordered bottom-up. Empty when everything is consistent.
 */
export function reconcileAutoCompletions(items: PRDItem[]): AutoCompletionResult {
  const result: AutoCompletionResult = {
    completedIds: [],
    completedItems: [],
  };

  // Collect all items in post-order (children before parents)
  const postOrder: PRDItem[] = [];
  function collectPostOrder(nodes: PRDItem[]): void {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        collectPostOrder(node.children);
      }
      postOrder.push(node);
    }
  }
  collectPostOrder(items);

  // Track items that are already terminal or have been decided as auto-completable
  const virtuallyCompleted = new Set<string>();

  for (const item of postOrder) {
    // Already successfully done: treat as virtually completed for ancestor
    // checks. Anything else terminal-but-unsuccessful (deferred/blocked/
    // failing) falls through to the AUTO_COMPLETABLE_STATUSES check below
    // and is skipped without being marked virtually completed — it must
    // keep blocking its parent.
    if (SUCCESSFUL_CHILD_STATUSES.has(item.status)) {
      virtuallyCompleted.add(item.id);
      continue;
    }

    // Only auto-complete pending / in_progress parents
    if (!AUTO_COMPLETABLE_STATUSES.has(item.status)) continue;

    // allChildrenSuccessful returns false when there are no children — leaf
    // items in a non-terminal status are never auto-completed.
    if (!allChildrenSuccessful(item, virtuallyCompleted)) continue;

    result.completedIds.push(item.id);
    result.completedItems.push({
      id: item.id,
      title: item.title,
      level: item.level,
    });
    virtuallyCompleted.add(item.id);
  }

  return result;
}

/**
 * Given a recently-completed item, find all ancestors that should be
 * auto-completed because all their children are now successfully done.
 *
 * Walks up the parent chain, simulating each completion so that
 * grandparents can see their child (which we just decided to complete)
 * as successfully done.
 *
 * @param items     - The full PRD item tree.
 * @param itemId    - The ID of the item that just completed.
 * @returns Items to auto-complete, ordered bottom-up. Empty if no propagation needed.
 */
export function findAutoCompletions(
  items: PRDItem[],
  itemId: string,
): AutoCompletionResult {
  const result: AutoCompletionResult = {
    completedIds: [],
    completedItems: [],
  };

  const entry = findItem(items, itemId);
  if (!entry) return result;

  // Callers invoke this after ANY terminal-ish status change (completed OR
  // deferred). If the item itself didn't land on a successful completion,
  // it cannot make its parent auto-completable — seeding it into
  // `virtuallyCompleted` below would silently reintroduce GitHub #364
  // (a deferred child masquerading as done for its parent's check).
  if (!SUCCESSFUL_CHILD_STATUSES.has(entry.item.status)) return result;

  // Track items we've decided to auto-complete so higher ancestors
  // see them as terminal when checking their own children.
  const virtuallyCompleted = new Set<string>([itemId]);

  // Walk up the parent chain from immediate parent to root
  const parents = entry.parents;

  for (let i = parents.length - 1; i >= 0; i--) {
    const parent = parents[i];

    // Only auto-complete parents that are pending or in_progress
    if (!AUTO_COMPLETABLE_STATUSES.has(parent.status)) break;

    // Check if all children are successfully done (including virtually
    // completed ones). A deferred/blocked/failing child breaks the cascade.
    if (!allChildrenSuccessful(parent, virtuallyCompleted)) break;

    result.completedIds.push(parent.id);
    result.completedItems.push({
      id: parent.id,
      title: parent.title,
      level: parent.level,
    });

    // This parent is now virtually completed for the next ancestor check
    virtuallyCompleted.add(parent.id);
  }

  return result;
}
