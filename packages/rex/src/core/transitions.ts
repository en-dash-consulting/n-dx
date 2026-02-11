/**
 * Status transition rules for PRD items.
 *
 * Defines which status changes are allowed without `--force`.
 * The general principle: forward progress is always allowed;
 * going backwards (e.g. completed → pending) requires explicit force.
 *
 * @module core/transitions
 */

import type { ItemStatus } from "../schema/index.js";

/**
 * Map of each status to the set of statuses it can transition to
 * without requiring `--force`.
 *
 * Design rationale:
 * - pending → in_progress, deferred, blocked, completed (start, defer, block, or skip)
 * - in_progress → completed, blocked, deferred (finish, block, or defer)
 * - completed → (none without force — completed is a terminal state)
 * - deferred → pending, in_progress, blocked (re-activate)
 * - blocked → pending, in_progress, deferred (unblock)
 */
const ALLOWED_TRANSITIONS: Record<ItemStatus, Set<ItemStatus>> = {
  pending: new Set(["in_progress", "deferred", "blocked", "completed", "deleted"]),
  in_progress: new Set(["completed", "failing", "blocked", "deferred", "pending", "deleted"]),
  completed: new Set(["failing", "deleted"]),
  failing: new Set(["in_progress", "pending", "deferred", "deleted"]),
  deferred: new Set(["pending", "in_progress", "blocked", "deleted"]),
  blocked: new Set(["pending", "in_progress", "deferred", "deleted"]),
  deleted: new Set([]),
};

export interface TransitionResult {
  allowed: boolean;
  from: ItemStatus;
  to: ItemStatus;
  message?: string;
}

/**
 * Check whether a status transition is allowed.
 *
 * @param from - Current item status.
 * @param to - Desired new status.
 * @returns Result indicating whether the transition is allowed, with an error message if not.
 */
export function validateTransition(
  from: ItemStatus,
  to: ItemStatus,
): TransitionResult {
  // No-op transitions are always fine
  if (from === to) {
    return { allowed: true, from, to };
  }

  const allowed = ALLOWED_TRANSITIONS[from];
  if (allowed.has(to)) {
    return { allowed: true, from, to };
  }

  return {
    allowed: false,
    from,
    to,
    message: transitionErrorMessage(from, to),
  };
}

/**
 * Build a clear error message explaining why a transition is blocked
 * and what the user can do about it.
 */
function transitionErrorMessage(from: ItemStatus, to: ItemStatus): string {
  const allowed = ALLOWED_TRANSITIONS[from];
  const allowedList = [...allowed].join(", ");

  if (from === "completed") {
    return `Cannot move from "completed" to "${to}" — completed items can only transition to "failing". Use --force to override.`;
  }

  if (allowedList) {
    return `Cannot move from "${from}" to "${to}". Allowed transitions: ${allowedList}. Use --force to override.`;
  }

  return `Cannot move from "${from}" to "${to}". Use --force to override.`;
}

/**
 * Get the list of valid target statuses for a given current status.
 */
export function allowedTargets(from: ItemStatus): ItemStatus[] {
  return [...ALLOWED_TRANSITIONS[from]];
}
