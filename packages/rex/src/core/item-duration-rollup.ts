/**
 * Per-PRD-item duration rollup.
 *
 * Walks the PRD tree and sums recorded work time from each item's
 * `activeIntervals` (plus legacy `startedAt` / `endedAt` fallback) into the
 * item's own `self` bucket, then rolls those sums up to every ancestor so the
 * dashboard and MCP consumers can read elapsed work time at any level
 * (subtask → task → feature → epic) without re-walking the interval log on
 * every request.
 *
 * Design constraints
 * ------------------
 * - **Pure.** `aggregateItemDurations(items, now?)` has no I/O and no hidden
 *   state. `now` is injected so tests can pin a clock and so successive calls
 *   at different clock times yield consistent, mutation-free results.
 * - **No stored-state mutation.** Open intervals in in-progress items are
 *   *virtually* closed at `now` for totals; the underlying PRD data is never
 *   written back.
 * - **Stable totals for completed subtrees.** If every descendant has closed
 *   intervals, `totalMs` is independent of `now` — successive calls return
 *   identical totals.
 * - **Running-aware.** `runningMs` reports only the fraction of `totalMs`
 *   that is "live" (accumulating because of an open interval), so UIs can
 *   display a live tick without recomputing the stable portion.
 * - **Linear.** A single post-order walk visits each item once, per-item cost
 *   is O(intervals). Overall O(items + intervals).
 *
 * This module sits next to `item-token-rollup.ts`; the two aggregators share
 * the same walk discipline but are independent — tokens come from hench runs,
 * durations come from the PRD's own interval log.
 *
 * @module rex/core/item-duration-rollup
 */

import { getTaskDuration } from "./durations.js";
import type { PRDItem } from "../schema/v1.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Rolled-up work duration for a single PRD item. */
export interface ItemDurationTotals {
  /**
   * Cumulative work time for this item plus all descendants, in milliseconds.
   *
   * For closed subtrees (no open intervals anywhere beneath this item) the
   * value is independent of `now` and stable across calls. For subtrees with
   * open intervals, `totalMs` includes the live portion elapsed between each
   * open interval's start and `now`.
   */
  totalMs: number;
  /**
   * The portion of `totalMs` that is currently "live" — i.e. attributable to
   * open intervals on this item or any descendant, measured from each
   * interval's start to `now`. Zero if no descendant is in progress.
   */
  runningMs: number;
  /** True if this item or any descendant currently has an open work interval. */
  isRunning: boolean;
}

/** Result of aggregating durations over a PRD tree. */
export interface ItemDurationAggregation {
  /** Map of `itemId → duration totals` for every item in the PRD. */
  durations: Map<string, ItemDurationTotals>;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Compute the "running" portion of a single item's elapsed time at `nowMs`.
 *
 * Returns the sum of `(now - start)` across every open interval on the item.
 * Closed intervals contribute zero. Items with no `activeIntervals` fall back
 * to the legacy (startedAt, endedAt/completedAt) interpretation: `in_progress`
 * counts as a single virtual open interval from `startedAt`.
 */
function selfRunningMs(item: PRDItem, nowMs: number): number {
  const intervals = item.activeIntervals;
  if (intervals && intervals.length > 0) {
    let live = 0;
    for (const iv of intervals) {
      if (iv.end !== undefined) continue;
      const startMs = Date.parse(iv.start);
      if (!Number.isFinite(startMs)) continue;
      const delta = nowMs - startMs;
      if (delta > 0) live += delta;
    }
    return live;
  }

  // Legacy fallback: treat in_progress + startedAt as a single open interval.
  if (item.status === "in_progress" && item.startedAt) {
    const startMs = Date.parse(item.startedAt);
    if (!Number.isFinite(startMs)) return 0;
    const delta = nowMs - startMs;
    return delta > 0 ? delta : 0;
  }
  return 0;
}

function emptyDuration(): ItemDurationTotals {
  return { totalMs: 0, runningMs: 0, isRunning: false };
}

/**
 * Roll up work durations across every item in the PRD tree.
 *
 * For every item the returned map contains `{ totalMs, runningMs, isRunning }`
 * where `totalMs` is the sum of the item's own elapsed time plus every
 * descendant's `totalMs`, `runningMs` is the live portion at `now`, and
 * `isRunning` is true when the item or any descendant has an open interval.
 *
 * Pure: no I/O, no mutation of the input tree, safe to call repeatedly.
 *
 * @param items - Root-level PRD items (epics).
 * @param now   - Clock for resolving open intervals. Defaults to `Date.now()`.
 */
export function aggregateItemDurations(
  items: PRDItem[],
  now: number | Date = Date.now(),
): ItemDurationAggregation {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const durations = new Map<string, ItemDurationTotals>();

  function rollUp(node: PRDItem): ItemDurationTotals {
    // Start with this item's own elapsed + live portion.
    const self = getTaskDuration(node, nowMs);
    const selfLive = selfRunningMs(node, nowMs);
    let totalMs = self.elapsedMs;
    let runningMs = selfLive;
    let isRunning = self.isRunning || selfLive > 0;

    const kids = node.children;
    if (kids && kids.length > 0) {
      for (let i = 0; i < kids.length; i++) {
        const child = rollUp(kids[i]);
        totalMs += child.totalMs;
        runningMs += child.runningMs;
        if (child.isRunning) isRunning = true;
      }
    }

    const rollup: ItemDurationTotals = { totalMs, runningMs, isRunning };
    durations.set(node.id, rollup);
    return rollup;
  }

  for (const root of items) rollUp(root);

  return { durations };
}
