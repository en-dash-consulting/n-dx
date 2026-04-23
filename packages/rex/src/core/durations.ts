/**
 * Derive elapsed work duration for a PRD item from its timing fields.
 *
 * Consumers should prefer `activeIntervals` (append-only work log) when
 * present; older items may have only `startedAt` / `endedAt` / `completedAt`
 * and fall back to a single implicit interval.
 *
 * @module core/durations
 */

import type { PRDItem } from "../schema/v1.js";

export interface TaskDuration {
  /** Cumulative milliseconds of work recorded across all intervals. */
  elapsedMs: number;
  /** True if the item currently has an open work interval. */
  isRunning: boolean;
}

type DurationInput = Pick<
  PRDItem,
  "status" | "startedAt" | "endedAt" | "completedAt" | "activeIntervals"
>;

/**
 * Compute elapsed work duration for a PRD item.
 *
 * Semantics:
 * - If `activeIntervals` is present, sum `end - start` across every interval.
 *   An open interval (no `end`) uses `now` as its virtual end.
 * - If intervals are absent (legacy item), fall back to `startedAt` /
 *   `endedAt || completedAt`, treating the item as a single interval.
 * - Never-started items return `{ elapsedMs: 0, isRunning: false }`.
 * - Malformed timestamps are skipped rather than throwing.
 *
 * @param item - Item or partial item with timing fields.
 * @param now  - Current time as a `Date` or epoch millis. Defaults to `Date.now()`.
 */
export function getTaskDuration(
  item: DurationInput,
  now: number | Date = Date.now(),
): TaskDuration {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const isRunning = item.status === "in_progress";

  const intervals = item.activeIntervals;
  if (intervals && intervals.length > 0) {
    let total = 0;
    for (const iv of intervals) {
      const startMs = Date.parse(iv.start);
      if (!Number.isFinite(startMs)) continue;
      const endMs = iv.end === undefined ? nowMs : Date.parse(iv.end);
      if (!Number.isFinite(endMs)) continue;
      if (endMs < startMs) continue;
      total += endMs - startMs;
    }
    return { elapsedMs: total, isRunning };
  }

  // Legacy fallback: single interval derived from top-level timestamps.
  if (item.startedAt) {
    const startMs = Date.parse(item.startedAt);
    if (!Number.isFinite(startMs)) {
      return { elapsedMs: 0, isRunning };
    }

    if (isRunning) {
      const elapsed = nowMs - startMs;
      return { elapsedMs: elapsed > 0 ? elapsed : 0, isRunning };
    }

    const endStr = item.endedAt ?? item.completedAt;
    if (endStr) {
      const endMs = Date.parse(endStr);
      if (Number.isFinite(endMs) && endMs >= startMs) {
        return { elapsedMs: endMs - startMs, isRunning: false };
      }
    }
  }

  return { elapsedMs: 0, isRunning };
}
