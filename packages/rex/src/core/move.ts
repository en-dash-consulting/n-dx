/**
 * Move (reparent) an item within the PRD tree.
 *
 * Handles validation of structural constraints:
 * - Target parent exists (when specified)
 * - Level hierarchy is respected (LEVEL_HIERARCHY)
 * - No circular moves (item cannot move under its own descendants)
 *
 * @module core/move
 */

import type { PRDItem, ItemLevel } from "../schema/index.js";
import { LEVEL_HIERARCHY } from "../schema/index.js";
import { findItem, removeFromTree, insertChild, walkTree } from "./tree.js";

export interface MoveResult {
  item: PRDItem;
  previousParentId: string | null;
  newParentId: string | null;
}

export interface MoveValidation {
  valid: boolean;
  error?: string;
  suggestion?: string;
}

/**
 * Collect all descendant IDs of an item (excluding the item itself).
 */
function collectDescendantIds(item: PRDItem): Set<string> {
  const ids = new Set<string>();
  if (item.children) {
    for (const child of item.children) {
      ids.add(child.id);
      for (const id of collectDescendantIds(child)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

/**
 * Validate that a move is structurally valid without modifying the tree.
 *
 * Checks:
 * 1. Item exists
 * 2. New parent exists (if specified)
 * 3. Not moving to self
 * 4. Not moving to a descendant (cycle prevention)
 * 5. Level hierarchy is respected
 * 6. Item can be a root if no parent specified
 */
export function validateMove(
  items: PRDItem[],
  itemId: string,
  newParentId: string | undefined,
): MoveValidation {
  // 1. Item must exist
  const entry = findItem(items, itemId);
  if (!entry) {
    return {
      valid: false,
      error: `Item "${itemId}" not found.`,
      suggestion: "Check the ID with 'rex status' and try again.",
    };
  }

  const itemLevel = entry.item.level;
  const currentParentId = entry.parents.length > 0
    ? entry.parents[entry.parents.length - 1].id
    : null;

  // No-op check: already at desired position
  if ((newParentId ?? null) === currentParentId) {
    return {
      valid: false,
      error: `Item "${itemId}" is already ${newParentId ? `under "${newParentId}"` : "at the root"}.`,
    };
  }

  // 2/3. Self-move check
  if (newParentId === itemId) {
    return {
      valid: false,
      error: "Cannot move an item under itself.",
    };
  }

  // 5/6. Level hierarchy check
  const allowedParents = LEVEL_HIERARCHY[itemLevel];
  const canBeRoot = allowedParents.includes(null);
  const allowedParentLevels = allowedParents.filter((p): p is ItemLevel => p !== null);

  if (!newParentId) {
    // Moving to root
    if (!canBeRoot) {
      const parentNames = allowedParentLevels.join(" or ");
      return {
        valid: false,
        error: `A ${itemLevel} cannot be a root item.`,
        suggestion: `Use --parent=<id> to specify a ${parentNames}.`,
      };
    }
    return { valid: true };
  }

  // 2. New parent must exist
  const parentEntry = findItem(items, newParentId);
  if (!parentEntry) {
    return {
      valid: false,
      error: `Parent "${newParentId}" not found.`,
      suggestion: "Check the ID with 'rex status' and try again.",
    };
  }

  // 4. Descendant check (cycle prevention)
  const descendantIds = collectDescendantIds(entry.item);
  if (descendantIds.has(newParentId)) {
    return {
      valid: false,
      error: "Cannot move an item under its own descendant.",
      suggestion: "This would create a circular reference in the tree.",
    };
  }

  // 5. Level hierarchy check against new parent
  if (allowedParentLevels.length > 0 && !allowedParentLevels.includes(parentEntry.item.level)) {
    const parentNames = allowedParentLevels.join(" or ");
    return {
      valid: false,
      error: `A ${itemLevel} must be a child of a ${parentNames}, but "${newParentId}" is a ${parentEntry.item.level}.`,
      suggestion: `Use --parent=<id> to specify a ${parentNames} instead.`,
    };
  }

  return { valid: true };
}

/**
 * Move an item to a new parent in the tree.
 *
 * Validates the move, then performs it atomically by:
 * 1. Removing the item from its current position
 * 2. Inserting it under the new parent (or at root)
 *
 * The item retains all its children and properties.
 *
 * @param items - The mutable items array (will be modified in place)
 * @param itemId - ID of the item to move
 * @param newParentId - ID of the new parent, or undefined to move to root
 * @returns The move result, or throws on validation failure
 */
export function moveItem(
  items: PRDItem[],
  itemId: string,
  newParentId: string | undefined,
): MoveResult {
  const validation = validateMove(items, itemId, newParentId);
  if (!validation.valid) {
    throw new Error(validation.error!);
  }

  const entry = findItem(items, itemId)!;
  const previousParentId = entry.parents.length > 0
    ? entry.parents[entry.parents.length - 1].id
    : null;

  // Remove from current position (preserves children)
  const removed = removeFromTree(items, itemId);
  if (!removed) {
    throw new Error(
      `Failed to remove item "${itemId}" from tree.`,
    );
  }

  // Insert at new position
  if (newParentId) {
    const inserted = insertChild(items, newParentId, removed);
    if (!inserted) {
      // Rollback: try to restore to original position
      if (previousParentId) {
        insertChild(items, previousParentId, removed);
      } else {
        items.push(removed);
      }
      throw new Error(
        `Failed to insert item under "${newParentId}".`,
      );
    }
  } else {
    items.push(removed);
  }

  return {
    item: removed,
    previousParentId,
    newParentId: newParentId ?? null,
  };
}
