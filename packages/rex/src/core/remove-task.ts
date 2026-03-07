import type { PRDItem, ItemStatus } from "../schema/index.js";
import { getLevelLabel } from "../schema/index.js";
import { findItem } from "./tree.js";
import { deleteItem, cleanBlockedByRefs } from "./delete.js";

/**
 * Statuses that count as terminal for auto-completion checks.
 * A parent is auto-completable only when every remaining child has one of these.
 */
const TERMINAL_STATUSES: Set<ItemStatus> = new Set(["completed", "deferred"]);

/**
 * Statuses where a parent is eligible for auto-completion.
 * Already-completed, deferred, or blocked parents are left alone.
 */
const AUTO_COMPLETABLE_STATUSES: Set<ItemStatus> = new Set(["pending", "in_progress"]);

/**
 * Descriptor for a parent item that is eligible for auto-completion
 * after the task removal.
 */
export interface ParentAutoCompletion {
  /** ID of the parent item. */
  id: string;
  /** Title of the parent item. */
  title: string;
  /** Level of the parent item (feature, epic). */
  level: string;
}

/**
 * Result of a {@link removeTask} operation.
 *
 * On success, `ok` is `true` and `deletedIds` contains the IDs of every
 * item removed (the task itself plus any subtasks). On failure, `ok`
 * is `false`, `error` explains why, and the tree is left unchanged.
 */
export interface RemoveTaskResult {
  /** Whether the removal succeeded. */
  ok: boolean;
  /** IDs of all items removed (task + descendants). Empty on failure. */
  deletedIds: string[];
  /** Human-readable description of what happened. */
  detail: string;
  /** Error message when `ok` is `false`. Undefined on success. */
  error?: string;
  /**
   * Parent items that are now eligible for auto-completion because all
   * their remaining children are in a terminal state (completed/deferred).
   *
   * Ordered bottom-up (immediate parent first, then grandparent, etc.).
   * The caller is responsible for actually updating these items' status —
   * this function only identifies candidates, consistent with
   * {@link findAutoCompletions}.
   *
   * Empty when:
   * - The operation failed.
   * - The parent still has pending/in_progress children.
   * - The parent has no remaining children (empty parents don't auto-complete).
   * - The parent is already completed or in a non-completable state.
   */
  parentAutoCompletions: ParentAutoCompletion[];
}

/**
 * Remove a task and all its subtasks from the PRD tree.
 *
 * This is a safe, atomic operation:
 * - Validates the target exists and is actually a task before mutating.
 * - Removes the task and every nested subtask.
 * - Cleans up `blockedBy` references in remaining items that pointed
 *   to any of the deleted items.
 * - Identifies parent items that are now eligible for auto-completion
 *   (all remaining children completed or deferred).
 *
 * The function mutates `items` in place (consistent with {@link deleteItem}
 * and {@link pruneItems}).
 *
 * @param items  - The root-level PRD item array (mutated on success).
 * @param taskId - The ID of the task to remove.
 * @returns A result object describing success/failure, deleted IDs, and
 *          parent auto-completion candidates.
 */
export function removeTask(items: PRDItem[], taskId: string): RemoveTaskResult {
  // 1. Validate the item exists
  const entry = findItem(items, taskId);
  if (!entry) {
    return {
      ok: false,
      deletedIds: [],
      detail: `Task "${taskId}" not found.`,
      error: `Item "${taskId}" not found in the PRD tree.`,
      parentAutoCompletions: [],
    };
  }

  // 2. Validate it's actually a task
  if (entry.item.level !== "task") {
    return {
      ok: false,
      deletedIds: [],
      detail: `Item "${taskId}" is a ${getLevelLabel(entry.item.level)}, not a ${getLevelLabel("task")}.`,
      error: `Item "${entry.item.title}" (${taskId}) is not a ${getLevelLabel("task")} — it is a ${getLevelLabel(entry.item.level)}.`,
      parentAutoCompletions: [],
    };
  }

  const taskTitle = entry.item.title;
  const parents = entry.parents;

  // 3. Delete the task and all descendants (subtasks)
  const deletedIds = deleteItem(items, taskId);

  // 4. Clean up blockedBy references pointing to deleted items
  cleanBlockedByRefs(items, new Set(deletedIds));

  // 5. Check for parent auto-completion candidates
  //    Walk up the ancestor chain: if a parent's remaining children are all
  //    terminal, it becomes a candidate. Keep going as long as each ancestor
  //    would also become terminal (simulating the cascade).
  const parentAutoCompletions: ParentAutoCompletion[] = [];
  const virtuallyCompleted = new Set<string>();

  for (let i = parents.length - 1; i >= 0; i--) {
    const parent = parents[i];

    // Only auto-complete parents that are pending or in_progress
    if (!AUTO_COMPLETABLE_STATUSES.has(parent.status)) break;

    // Check if all remaining children are terminal
    // (including parents we've already decided to auto-complete)
    const childrenTerminal = parent.children && parent.children.length > 0 &&
      parent.children.every(
        (c) => TERMINAL_STATUSES.has(c.status) || virtuallyCompleted.has(c.id),
      );

    if (!childrenTerminal) break;

    parentAutoCompletions.push({
      id: parent.id,
      title: parent.title,
      level: parent.level,
    });

    // This parent is now virtually completed for the next ancestor check
    virtuallyCompleted.add(parent.id);
  }

  return {
    ok: true,
    deletedIds,
    detail: `Removed task: ${taskTitle} (${deletedIds.length} item(s) deleted)`,
    parentAutoCompletions,
  };
}
