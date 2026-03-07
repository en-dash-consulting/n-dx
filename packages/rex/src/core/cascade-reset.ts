/**
 * Helper to reset completed ancestors after a child is added.
 *
 * This is the integration glue between `findParentResets` and the store.
 * Call it after `store.addItem(child, parentId)` to automatically reopen
 * any completed parents that now have outstanding work.
 *
 * @module core/cascade-reset
 */

import type { PRDStore } from "../store/contracts.js";
import type { PRDItem, ItemStatus } from "../schema/index.js";
import { findParentResets } from "./parent-reset.js";

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
      status: "pending" as ItemStatus,
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
