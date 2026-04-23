/**
 * Client-side port of rex's `getTaskDuration`.
 *
 * The viewer bundle can't import `@n-dx/rex` at runtime (rex is a Node.js
 * package), but the PRD document sent over the wire already carries the
 * timing fields the aggregator reads. This function mirrors rex's
 * semantics exactly — if the canonical implementation changes, update
 * this port and the drift test in
 * `packages/web/tests/unit/server/type-consistency.test.ts` will catch it
 * at compile time.
 *
 * @see packages/rex/src/core/durations.ts — canonical implementation
 */

import type { PRDItemData } from "./types.js";

export interface TaskDurationResult {
  /** Cumulative milliseconds of work recorded across all intervals. */
  elapsedMs: number;
  /** True if the item currently has an open work interval. */
  isRunning: boolean;
  /**
   * True if the item has any recorded work (either a closed interval
   * or an open one). Tasks that have never started return false so the
   * UI can render `—` rather than `0s`.
   */
  hasRecord: boolean;
}

type DurationInput = Pick<
  PRDItemData,
  "status" | "startedAt" | "endedAt" | "completedAt" | "activeIntervals"
>;

/**
 * Compute elapsed work duration for a PRD item.
 *
 * - If `activeIntervals` is present, sum `end - start` across every interval.
 *   An open interval (no `end`) uses `now` as its virtual end.
 * - If intervals are absent (legacy item), fall back to `startedAt` /
 *   `endedAt || completedAt`, treating the item as a single interval.
 * - Never-started items return `{ elapsedMs: 0, isRunning: false, hasRecord: false }`.
 * - Malformed timestamps are skipped rather than throwing.
 *
 * @param item Item (or partial item) carrying the timing fields.
 * @param nowMs Current time in epoch millis. Defaults to `Date.now()`.
 */
export function getTaskDuration(
  item: DurationInput,
  nowMs: number = Date.now(),
): TaskDurationResult {
  const isRunning = item.status === "in_progress";

  const intervals = item.activeIntervals;
  if (intervals && intervals.length > 0) {
    let total = 0;
    let counted = 0;
    for (const iv of intervals) {
      const startMs = Date.parse(iv.start);
      if (!Number.isFinite(startMs)) continue;
      const endMs = iv.end === undefined ? nowMs : Date.parse(iv.end);
      if (!Number.isFinite(endMs)) continue;
      if (endMs < startMs) continue;
      total += endMs - startMs;
      counted++;
    }
    return { elapsedMs: total, isRunning, hasRecord: counted > 0 };
  }

  // Legacy fallback: single interval derived from top-level timestamps.
  if (item.startedAt) {
    const startMs = Date.parse(item.startedAt);
    if (!Number.isFinite(startMs)) {
      return { elapsedMs: 0, isRunning, hasRecord: false };
    }

    if (isRunning) {
      const elapsed = nowMs - startMs;
      return { elapsedMs: elapsed > 0 ? elapsed : 0, isRunning, hasRecord: true };
    }

    const endStr = item.endedAt ?? item.completedAt;
    if (endStr) {
      const endMs = Date.parse(endStr);
      if (Number.isFinite(endMs) && endMs >= startMs) {
        return { elapsedMs: endMs - startMs, isRunning: false, hasRecord: true };
      }
    }
  }

  return { elapsedMs: 0, isRunning, hasRecord: false };
}
