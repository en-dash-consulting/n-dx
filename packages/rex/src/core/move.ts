/**
 * Move (reparent) an item within the PRD tree.
 *
 * Handles validation of structural constraints:
 * - Target parent exists (when specified)
 * - The parent rule is respected: the level hierarchy (LEVEL_HIERARCHY) on
 *   a v1 tree, the node types on a v2 change layer ({@link changeLayerParentRule})
 * - No circular moves (item cannot move under its own descendants)
 *
 * @module core/move
 */

import type { PRDItem, ItemLevel } from "../schema/index.js";
import { LEVEL_HIERARCHY } from "../schema/index.js";
import {findItem, removeFromTree, insertChild} from "./tree.js";
import { changeLayerType } from "./layer-projection.js";
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
 * 5/6. `rule` accepts the new parent, or the root when none is given
 *    (default: the level hierarchy)
 */
export function validateMove(
  items: PRDItem[],
  itemId: string,
  newParentId: string | undefined,
  rule: ParentRule = levelParentRule,
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

  // 6. Moving to root
  if (!newParentId) return rule(entry.item, null) ?? { valid: true };

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

  // 5. The new parent
  return rule(entry.item, parentEntry.item) ?? { valid: true };
}

/**
 * Whether `item` may sit under `parent` (null: at the root). Returns the
 * refusal, or null when the placement is allowed.
 */
export type ParentRule = (item: PRDItem, parent: PRDItem | null) => MoveValidation | null;

/** The v1 rule: {@link LEVEL_HIERARCHY}. */
export const levelParentRule: ParentRule = (item, parent) => {
  const allowedParents = LEVEL_HIERARCHY[item.level];
  const allowedParentLevels = allowedParents.filter((p): p is ItemLevel => p !== null);
  const parentNames = allowedParentLevels.join(" or ");
  if (!parent) {
    if (allowedParents.includes(null)) return null;
    return {
      valid: false,
      error: `A ${item.level} cannot be a root item.`,
      suggestion: `Use --parent=<id> to specify a ${parentNames}.`,
    };
  }
  if (allowedParentLevels.length === 0 || allowedParentLevels.includes(parent.level)) return null;
  return {
    valid: false,
    error: `A ${item.level} must be a child of a ${parentNames}, but "${parent.id}" is a ${parent.level}.`,
    suggestion: `Use --parent=<id> to specify a ${parentNames} instead.`,
  };
};

/** Parent types on a v2 change layer; null is the root. */
const CHANGE_LAYER_PARENTS = {
  change: [null, "change"],
  task: ["change"],
  subtask: ["task"],
} as const;

/**
 * The v2 change-layer rule, by node type rather than level: a change sits at
 * the root or under a change, a task under a change, a subtask under a task.
 */
export const changeLayerParentRule: ParentRule = (item, parent) => {
  const type = changeLayerType(item);
  if (!type) return { valid: false, error: `Item "${item.id}" is not a change-layer node.` };
  const allowed: readonly (string | null)[] = CHANGE_LAYER_PARENTS[type];
  const parentType = parent ? changeLayerType(parent) ?? parent.level : null;
  if (allowed.includes(parentType)) return null;
  const names = allowed.map((t) => t ?? "the root").join(" or ");
  return {
    valid: false,
    error: parent
      ? `A ${type} cannot move under a ${parentType}: "${parent.id}" is a ${parentType}, and a ${type}'s parent is ${names}.`
      : `A ${type} cannot be a root item: its parent is a ${names}.`,
  };
};

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
 * @param rule - Which parents the item may take (default: the level hierarchy)
 * @returns The move result, or throws on validation failure
 */
/** Append `child` under `parentId` without a level check; false when the parent is missing. */
function appendChild(items: PRDItem[], parentId: string, child: PRDItem): boolean {
  const parent = findItem(items, parentId)?.item;
  if (!parent) return false;
  (parent.children ??= []).push(child);
  return true;
}

export function moveItem(
  items: PRDItem[],
  itemId: string,
  newParentId: string | undefined,
  rule: ParentRule = levelParentRule,
): MoveResult {
  const validation = validateMove(items, itemId, newParentId, rule);
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
    // insertChild re-checks the level hierarchy; any other rule was checked
    // above, and a change nested under a change still reads as an epic.
    const inserted = rule === levelParentRule
      ? insertChild(items, newParentId, removed)
      : appendChild(items, newParentId, removed);
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
