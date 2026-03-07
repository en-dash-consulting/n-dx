import type { PRDItem } from "../schema/index.js";
import { getLevelLabel } from "../schema/index.js";
import { findItem } from "./tree.js";
import { deleteItem, cleanBlockedByRefs } from "./delete.js";

/**
 * Result of a {@link removeEpic} operation.
 *
 * On success, `ok` is `true` and `deletedIds` contains the IDs of every
 * item removed (the epic itself plus all descendants). On failure, `ok`
 * is `false`, `error` explains why, and the tree is left unchanged.
 */
export interface RemoveEpicResult {
  /** Whether the removal succeeded. */
  ok: boolean;
  /** IDs of all items removed (epic + descendants). Empty on failure. */
  deletedIds: string[];
  /** Human-readable description of what happened. */
  detail: string;
  /** Error message when `ok` is `false`. Undefined on success. */
  error?: string;
}

/**
 * Remove an epic and all its descendants from the PRD tree.
 *
 * This is a safe, atomic operation:
 * - Validates the target exists and is actually an epic before mutating.
 * - Removes the epic and every nested feature/task/subtask.
 * - Cleans up `blockedBy` references in remaining items that pointed
 *   to any of the deleted items.
 *
 * The function mutates `items` in place (consistent with {@link deleteItem}
 * and {@link pruneItems}).
 *
 * @param items - The root-level PRD item array (mutated on success).
 * @param epicId - The ID of the epic to remove.
 * @returns A result object describing success/failure and deleted IDs.
 */
export function removeEpic(items: PRDItem[], epicId: string): RemoveEpicResult {
  // 1. Validate the item exists
  const entry = findItem(items, epicId);
  if (!entry) {
    return {
      ok: false,
      deletedIds: [],
      detail: `Epic "${epicId}" not found.`,
      error: `Item "${epicId}" not found in the PRD tree.`,
    };
  }

  // 2. Validate it's actually an epic
  if (entry.item.level !== "epic") {
    return {
      ok: false,
      deletedIds: [],
      detail: `Item "${epicId}" is a ${getLevelLabel(entry.item.level)}, not an ${getLevelLabel("epic")}.`,
      error: `Item "${entry.item.title}" (${epicId}) is not an ${getLevelLabel("epic")} — it is a ${getLevelLabel(entry.item.level)}.`,
    };
  }

  const epicTitle = entry.item.title;

  // 3. Delete the epic and all descendants
  const deletedIds = deleteItem(items, epicId);

  // 4. Clean up blockedBy references pointing to deleted items
  cleanBlockedByRefs(items, new Set(deletedIds));

  return {
    ok: true,
    deletedIds,
    detail: `Removed epic: ${epicTitle} (${deletedIds.length} item(s) deleted)`,
  };
}
