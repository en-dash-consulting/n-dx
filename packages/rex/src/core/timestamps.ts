/**
 * Automatic timestamping for PRD item status changes.
 *
 * Computes the timestamp fields (`startedAt`, `completedAt`, `endedAt`,
 * `activeIntervals`) that should be set when an item's status changes.
 * Centralises the logic so that all callers (CLI, MCP, hench, web) produce
 * consistent timestamps.
 *
 * Rules:
 * - `startedAt` is set the *first* time an item enters `in_progress` (or
 *   skips directly to `completed`). Preserved across re-opens.
 * - `completedAt` is set when an item enters `completed`. Cleared if a
 *   completed item is forced back to a non-completed status.
 * - `endedAt` mirrors `completedAt` on entry/exit of `completed`, and is
 *   cleared whenever work resumes via `in_progress`.
 * - `activeIntervals` accumulates append-only records of work periods.
 *   Entering `in_progress` pushes `{ start: now }`; leaving `in_progress`
 *   closes the last open interval with `end: now`. Direct `pending →
 *   completed` pushes an instant `{ start, end }` pair so totals never
 *   need fallback logic.
 *
 * Legacy items that predate `activeIntervals` are never retroactively
 * backfilled here; `getTaskDuration()` falls back to `startedAt`/`endedAt`
 * when the array is absent.
 *
 * @module core/timestamps
 */

import type { ActiveInterval, ItemStatus, PRDItem } from "../schema/index.js";

export interface TimestampUpdates {
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  endedAt?: string | undefined;
  activeIntervals?: ActiveInterval[] | undefined;
}

type ExistingFields = Pick<
  PRDItem,
  "startedAt" | "completedAt" | "endedAt" | "activeIntervals"
>;

/**
 * Compute timestamp field updates for a status transition.
 *
 * @param from    - Current item status.
 * @param to      - New target status.
 * @param existing - Optional existing timestamp fields on the item.
 * @returns Object with timestamp fields to merge into the item update.
 *          Only includes keys that should change; empty object means no
 *          timestamp updates are needed.
 */
export function computeTimestampUpdates(
  from: ItemStatus,
  to: ItemStatus,
  existing?: ExistingFields,
): TimestampUpdates {
  if (from === to) return {};

  const updates: TimestampUpdates = {};
  const now = new Date().toISOString();

  const enteringInProgress = to === "in_progress";
  const leavingInProgress = from === "in_progress" && to !== "in_progress";
  const enteringCompleted = to === "completed";
  const leavingCompleted = from === "completed" && to !== "completed";

  // startedAt: set the first time we enter in_progress (or skip to completed).
  if ((enteringInProgress || enteringCompleted) && !existing?.startedAt) {
    updates.startedAt = now;
  }

  // completedAt: set on entering completed; clear on leaving it.
  if (enteringCompleted) {
    updates.completedAt = now;
  } else if (leavingCompleted) {
    updates.completedAt = undefined;
  }

  // endedAt: mirrors completedAt on terminal entry/exit, and also clears
  // whenever work resumes (entering in_progress from any other state).
  if (enteringCompleted) {
    updates.endedAt = now;
  } else if (leavingCompleted || enteringInProgress) {
    updates.endedAt = undefined;
  }

  // activeIntervals: append-only log of work periods.
  const existingIntervals = existing?.activeIntervals ?? [];

  if (enteringInProgress) {
    const last = existingIntervals[existingIntervals.length - 1];
    const alreadyOpen = last !== undefined && last.end === undefined;
    if (!alreadyOpen) {
      updates.activeIntervals = [...existingIntervals, { start: now }];
    }
    // If an interval is already open (inconsistent state), leave it alone
    // rather than fabricating a second open entry.
  } else if (leavingInProgress) {
    const last = existingIntervals[existingIntervals.length - 1];
    if (last !== undefined && last.end === undefined) {
      const closed: ActiveInterval = { ...last, end: now };
      updates.activeIntervals = [
        ...existingIntervals.slice(0, -1),
        closed,
      ];
    }
    // No open interval to close (legacy data or already closed) — skip.
  } else if (enteringCompleted) {
    // Non-in_progress → completed (e.g., pending → completed direct jump).
    // Record an instant interval so duration math has no special case.
    updates.activeIntervals = [
      ...existingIntervals,
      { start: now, end: now },
    ];
  }

  return updates;
}
