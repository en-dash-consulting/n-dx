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

import type { PRDStore } from "../store/contracts.js";
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

export interface CascadeResetResult {
  /** Items that were reset, in bottom-up order. */
  resetItems: Array<{ id: string; title: string; level: string }>;
}

/**
 * After adding a child to a parent, check whether the parent (and its
 * ancestors) need to be reset from `completed` to `pending`.
 *
 * Loads the current document from the store, computes resets, applies
 * them, and logs each reset.
 *
 * @param store    - The PRD store to read/write.
 * @param parentId - The ID of the parent the child was added to.
 *                   Pass `undefined` for root-level items (no reset needed).
 * @returns Items that were reset. Empty array when no reset was needed.
 */
export async function cascadeParentReset(
  store: PRDStore,
  parentId: string | undefined,
): Promise<CascadeResetResult> {
  if (!parentId) return { resetItems: [] };

  const doc = await store.loadDocument();
  const { resetIds, resetItems } = findParentResets(doc.items, parentId);

  if (resetIds.length === 0) return { resetItems: [] };

  for (const id of resetIds) {
    const item = await store.getItem(id);
    if (!item) continue;

    await store.updateItem(id, {
      status: "pending",
      completedAt: undefined,
    });
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "status_reset",
      itemId: id,
      detail: `Reset ${item.level}: ${item.title} from completed to pending (new child added)`,
    });
  }

  return { resetItems };
}
