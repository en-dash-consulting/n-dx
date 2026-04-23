/**
 * Tests for per-PRD-item duration rollup.
 *
 * Verifies the pure aggregator that walks a PRD tree, sums each item's
 * recorded work intervals, and rolls them up to parents and ancestors.
 * Covers the three scenarios called out in the acceptance criteria:
 *   - epic with all completed tasks (stable totals)
 *   - epic with one running task (live running totals)
 *   - epic with a re-opened task whose intervals span non-contiguous periods
 */

import { describe, it, expect } from "vitest";
import {
  aggregateItemDurations,
  type ItemDurationTotals,
} from "../../../src/core/item-duration-rollup.js";
import type { PRDItem, ActiveInterval } from "../../../src/schema/v1.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TaskOpts = {
  intervals?: ActiveInterval[];
  status?: PRDItem["status"];
  startedAt?: string;
  endedAt?: string;
  completedAt?: string;
};

function task(id: string, opts: TaskOpts = {}): PRDItem {
  return {
    id,
    title: id,
    level: "task",
    status: opts.status ?? "pending",
    activeIntervals: opts.intervals,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
    completedAt: opts.completedAt,
  };
}

function parent(id: string, level: PRDItem["level"], children: PRDItem[]): PRDItem {
  return { id, title: id, level, status: "pending", children };
}

function iv(startIso: string, endIso?: string): ActiveInterval {
  return endIso === undefined ? { start: startIso } : { start: startIso, end: endIso };
}

function get(
  durations: Map<string, ItemDurationTotals>,
  id: string,
): ItemDurationTotals {
  const d = durations.get(id);
  if (!d) throw new Error(`missing duration for ${id}`);
  return d;
}

const T0 = "2026-01-01T00:00:00.000Z";
const t = (offsetSec: number): string =>
  new Date(Date.parse(T0) + offsetSec * 1000).toISOString();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("aggregateItemDurations", () => {
  it("returns a duration entry for every item in the PRD", () => {
    const prd: PRDItem[] = [
      parent("epic1", "epic", [
        parent("feat1", "feature", [task("t1"), task("t2")]),
      ]),
    ];
    const { durations } = aggregateItemDurations(prd, 0);
    expect(new Set(durations.keys())).toEqual(
      new Set(["epic1", "feat1", "t1", "t2"]),
    );
  });

  it("zeroes counts for items with no recorded work", () => {
    const prd: PRDItem[] = [parent("epic1", "epic", [task("t1")])];
    const { durations } = aggregateItemDurations(prd, Date.parse(T0));
    for (const id of ["epic1", "t1"]) {
      expect(get(durations, id)).toEqual({
        totalMs: 0,
        runningMs: 0,
        isRunning: false,
      });
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 1: epic with all completed tasks — stable totals
  // -------------------------------------------------------------------------

  it("sums descendant durations for an epic with all completed tasks", () => {
    const prd: PRDItem[] = [
      parent("epic1", "epic", [
        parent("feat1", "feature", [
          task("t1", { status: "completed", intervals: [iv(t(0), t(60))] }),
          task("t2", { status: "completed", intervals: [iv(t(100), t(250))] }),
        ]),
      ]),
    ];

    const { durations } = aggregateItemDurations(prd, Date.parse(t(10_000)));
    expect(get(durations, "t1").totalMs).toBe(60_000);
    expect(get(durations, "t2").totalMs).toBe(150_000);
    expect(get(durations, "feat1").totalMs).toBe(210_000);
    expect(get(durations, "epic1").totalMs).toBe(210_000);
    for (const id of ["t1", "t2", "feat1", "epic1"]) {
      const d = get(durations, id);
      expect(d.runningMs).toBe(0);
      expect(d.isRunning).toBe(false);
    }
  });

  it("returns identical totals on successive calls for a completed subtree", () => {
    const prd: PRDItem[] = [
      parent("epic1", "epic", [
        task("t1", { status: "completed", intervals: [iv(t(0), t(60))] }),
        task("t2", { status: "completed", intervals: [iv(t(0), t(120))] }),
      ]),
    ];
    const first = aggregateItemDurations(prd, Date.parse(t(1_000)));
    const second = aggregateItemDurations(prd, Date.parse(t(99_999)));
    expect(get(first.durations, "epic1")).toEqual(get(second.durations, "epic1"));
  });

  // -------------------------------------------------------------------------
  // Scenario 2: epic with one running task — live running duration
  // -------------------------------------------------------------------------

  it("includes live running time for an epic with one running task", () => {
    const prd: PRDItem[] = [
      parent("epic1", "epic", [
        task("t1", { status: "completed", intervals: [iv(t(0), t(60))] }),
        task("t2", {
          status: "in_progress",
          startedAt: t(100),
          intervals: [iv(t(100))], // open
        }),
      ]),
    ];
    const now = Date.parse(t(250));

    const { durations } = aggregateItemDurations(prd, now);
    expect(get(durations, "t1")).toEqual({
      totalMs: 60_000,
      runningMs: 0,
      isRunning: false,
    });
    expect(get(durations, "t2")).toEqual({
      totalMs: 150_000,
      runningMs: 150_000,
      isRunning: true,
    });
    expect(get(durations, "epic1")).toEqual({
      totalMs: 210_000,
      runningMs: 150_000,
      isRunning: true,
    });
  });

  it("advances totalMs and runningMs by the clock delta between calls", () => {
    const prd: PRDItem[] = [
      parent("epic1", "epic", [
        task("t1", { status: "in_progress", startedAt: t(0), intervals: [iv(t(0))] }),
      ]),
    ];
    const a = aggregateItemDurations(prd, Date.parse(t(60)));
    const b = aggregateItemDurations(prd, Date.parse(t(120)));
    expect(get(a.durations, "epic1").totalMs).toBe(60_000);
    expect(get(b.durations, "epic1").totalMs).toBe(120_000);
    expect(get(a.durations, "epic1").runningMs).toBe(60_000);
    expect(get(b.durations, "epic1").runningMs).toBe(120_000);
  });

  it("does not mutate the input tree when computing live running totals", () => {
    const interval: ActiveInterval = { start: t(0) };
    const prd: PRDItem[] = [
      parent("epic1", "epic", [
        task("t1", { status: "in_progress", startedAt: t(0), intervals: [interval] }),
      ]),
    ];
    aggregateItemDurations(prd, Date.parse(t(999)));
    // The open interval is still open; nothing closed it.
    expect(interval).toEqual({ start: t(0) });
    expect(prd[0].children?.[0].activeIntervals).toEqual([{ start: t(0) }]);
  });

  // -------------------------------------------------------------------------
  // Scenario 3: epic with a re-opened task (non-contiguous intervals)
  // -------------------------------------------------------------------------

  it("sums re-opened task intervals that span non-contiguous chronological periods", () => {
    // t1 was completed at t=60, re-opened at t=200, completed again at t=260.
    // Totals MUST be 60 + 60 = 120 seconds — the gap between intervals is not
    // counted, and the task's two intervals are each summed independently.
    const prd: PRDItem[] = [
      parent("epic1", "epic", [
        task("t1", {
          status: "completed",
          intervals: [iv(t(0), t(60)), iv(t(200), t(260))],
        }),
      ]),
    ];
    const { durations } = aggregateItemDurations(prd, Date.parse(t(10_000)));
    expect(get(durations, "t1").totalMs).toBe(120_000);
    expect(get(durations, "t1").runningMs).toBe(0);
    expect(get(durations, "t1").isRunning).toBe(false);
    expect(get(durations, "epic1").totalMs).toBe(120_000);
  });

  it("rolls up a re-opened, now-running task alongside completed siblings", () => {
    // sibling done: [0, 60]
    // re-opened task: first ran [0, 60], now re-opened at 400 and still open.
    // At now=500, its total is 60 (closed) + 100 (live) = 160.
    const prd: PRDItem[] = [
      parent("epic1", "epic", [
        task("done", { status: "completed", intervals: [iv(t(0), t(60))] }),
        task("re", {
          status: "in_progress",
          startedAt: t(0),
          intervals: [iv(t(0), t(60)), iv(t(400))],
        }),
      ]),
    ];
    const now = Date.parse(t(500));

    const { durations } = aggregateItemDurations(prd, now);
    expect(get(durations, "done").totalMs).toBe(60_000);
    expect(get(durations, "re").totalMs).toBe(160_000);
    expect(get(durations, "re").runningMs).toBe(100_000);
    expect(get(durations, "re").isRunning).toBe(true);
    expect(get(durations, "epic1").totalMs).toBe(220_000);
    expect(get(durations, "epic1").runningMs).toBe(100_000);
    expect(get(durations, "epic1").isRunning).toBe(true);
  });

  it("treats chronologically overlapping sibling intervals as independent (no wall-clock coalescing)", () => {
    // Two sibling tasks worked concurrently across overlapping wall-clock
    // windows — e.g. one assistant ran t1 from [0, 100] while another ran
    // t2 from [50, 150]. The rollup must sum their work time (100 + 100 =
    // 200), not collapse to the 150-second wall-clock span.
    const prd: PRDItem[] = [
      parent("epic1", "epic", [
        task("t1", { status: "completed", intervals: [iv(t(0), t(100))] }),
        task("t2", { status: "completed", intervals: [iv(t(50), t(150))] }),
      ]),
    ];
    const { durations } = aggregateItemDurations(prd, Date.parse(t(1000)));
    expect(get(durations, "epic1").totalMs).toBe(200_000);
  });

  // -------------------------------------------------------------------------
  // Legacy fallback (items without activeIntervals)
  // -------------------------------------------------------------------------

  it("falls back to startedAt/endedAt for legacy items without intervals", () => {
    const prd: PRDItem[] = [
      parent("epic1", "epic", [
        task("legacy", {
          status: "completed",
          startedAt: t(0),
          endedAt: t(90),
        }),
      ]),
    ];
    const { durations } = aggregateItemDurations(prd, Date.parse(t(10_000)));
    expect(get(durations, "legacy").totalMs).toBe(90_000);
    expect(get(durations, "epic1").totalMs).toBe(90_000);
  });

  it("counts a legacy in_progress item as running from startedAt", () => {
    const prd: PRDItem[] = [
      parent("epic1", "epic", [
        task("legacy-running", {
          status: "in_progress",
          startedAt: t(0),
        }),
      ]),
    ];
    const { durations } = aggregateItemDurations(prd, Date.parse(t(45)));
    expect(get(durations, "legacy-running").totalMs).toBe(45_000);
    expect(get(durations, "legacy-running").runningMs).toBe(45_000);
    expect(get(durations, "legacy-running").isRunning).toBe(true);
    expect(get(durations, "epic1").isRunning).toBe(true);
  });
});
