/**
 * Automatic parent status reset for PRD items.
 *
 * When a new child is added under a completed parent, the parent should be
 * reset to `pending` since it now has outstanding work. This walks up the
 * tree from the given parent, resetting any completed ancestors.
 *
 * Rules:
 * - Only parents with `completed` status are reset (pending, in_progress,
 *   deferred, and blocked parents are left alone).
 * - Reset cascades up the ancestor chain: if a parent is reset, its own
 *   parent should also be checked.
 * - Stops cascading when an ancestor is not `completed`.
 * - Returns the list of item IDs that should be reset, ordered from the
 *   immediate parent outward (bottom-up).
 *
 * This is the inverse complement of {@link findAutoCompletions} in
 * `parent-completion.ts`.
 *
 * @module core/parent-reset
 */

import type { PRDItem } from "../schema/index.js";
import { findItem } from "./tree.js";

export interface ParentResetResult {
  /** IDs of items that should be reset, ordered bottom-up (child → ancestor). */
  resetIds: string[];
  /** Human-readable descriptions of what was reset. */
  resetItems: Array<{ id: string; title: string; level: string }>;
}

/**
 * Given a parent item that just received a new child, find all ancestors
 * (including the parent itself) that should be reset from `completed` to
 * `pending`.
 *
 * Call this after `store.addItem(child, parentId)` with the parentId to
 * determine which completed ancestors need to be reopened.
 *
 * @param items     - The full PRD item tree (after the child was added).
 * @param parentId  - The ID of the parent that received the new child.
 * @returns Items to reset, ordered bottom-up. Empty if no reset needed.
 */
export function findParentResets(
  items: PRDItem[],
  parentId: string,
): ParentResetResult {
  const result: ParentResetResult = {
    resetIds: [],
    resetItems: [],
  };

  const entry = findItem(items, parentId);
  if (!entry) return result;

  // Check the parent itself first, then walk up its ancestors
  const chain = [...entry.parents, entry.item];

  // Walk from the target item (end of chain) upward
  for (let i = chain.length - 1; i >= 0; i--) {
    const item = chain[i];

    if (item.status !== "completed") break;

    result.resetIds.push(item.id);
    result.resetItems.push({
      id: item.id,
      title: item.title,
      level: item.level,
    });
  }

  return result;
}
