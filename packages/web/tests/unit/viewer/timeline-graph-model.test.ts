import { describe, it, expect } from "vitest";
import {
  bucketStart,
  buildTimelineGraph,
  summarizeOpenItems,
} from "../../../src/viewer/components/prd-tree/timeline-graph-model.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

/**
 * The PRD's timeline layout: completions bucketed into day or week columns
 * from the first completion up to now, the month bar's jump targets, and the
 * open top-level items listed to the right of today.
 */

function item(overrides: Partial<PRDItemData> & { id: string }): PRDItemData {
  return { title: overrides.id, status: "pending", type: "task", ...overrides };
}

/** Local-time timestamp, so bucketing is checked against the viewer's own calendar. */
function at(y: number, m: number, d: number, hh = 12): number {
  return new Date(y, m - 1, d, hh).getTime();
}

const iso = (t: number) => new Date(t).toISOString();

describe("bucketStart", () => {
  it("starts a day at local midnight", () => {
    expect(bucketStart(at(2026, 10, 23, 18), "day")).toBe(new Date(2026, 9, 23).getTime());
  });

  it("starts a week on Monday", () => {
    // 2026-10-23 is a Friday; its week starts Monday 2026-10-19.
    expect(bucketStart(at(2026, 10, 23), "week")).toBe(new Date(2026, 9, 19).getTime());
    // A Sunday belongs to the week that began six days earlier.
    expect(bucketStart(at(2026, 10, 25), "week")).toBe(new Date(2026, 9, 19).getTime());
    expect(bucketStart(at(2026, 10, 19, 0), "week")).toBe(new Date(2026, 9, 19).getTime());
  });
});

describe("buildTimelineGraph", () => {
  const now = at(2026, 10, 23, 15);

  it("runs one column per day from the first completion through today, idle days included", () => {
    const items = [
      item({ id: "a", status: "completed", completedAt: iso(at(2026, 10, 20, 9)) }),
      item({ id: "b", status: "completed", completedAt: iso(at(2026, 10, 23, 8)) }),
    ];
    const graph = buildTimelineGraph(items, "day", now);
    expect(graph.columns).toHaveLength(4); // 20, 21, 22, 23
    expect(graph.columns.map((c) => c.entries.map((e) => e.id))).toEqual([["a"], [], [], ["b"]]);
    expect(graph.total).toBe(2);
  });

  it("finds completions at any depth and lists a column newest first", () => {
    const items = [
      item({
        id: "epic", type: "epic", status: "in_progress",
        children: [
          item({ id: "early", status: "completed", completedAt: iso(at(2026, 10, 23, 9)) }),
          item({ id: "late", status: "completed", completedAt: iso(at(2026, 10, 23, 14)) }),
          item({ id: "open" }),
        ],
      }),
    ];
    const graph = buildTimelineGraph(items, "day", now);
    expect(graph.columns).toHaveLength(1);
    expect(graph.columns[0].entries.map((e) => e.id)).toEqual(["late", "early"]);
    expect(graph.columns[0].entries[0].parentChain).toEqual(["epic"]);
    expect(graph.columns[0].entries[0].item.id).toBe("late");
  });

  it("buckets by week on the week scale", () => {
    const items = [
      item({ id: "a", status: "completed", completedAt: iso(at(2026, 10, 6)) }),
      item({ id: "b", status: "completed", completedAt: iso(at(2026, 10, 7)) }),
      item({ id: "c", status: "completed", completedAt: iso(at(2026, 10, 21)) }),
    ];
    const graph = buildTimelineGraph(items, "week", now);
    // Weeks of Oct 5, 12 and 19.
    expect(graph.columns.map((c) => c.entries.map((e) => e.id))).toEqual([["b", "a"], [], ["c"]]);
  });

  it("drops a completion with no usable date or one in the future", () => {
    const items = [
      item({ id: "bad", status: "completed", completedAt: "not a date" }),
      item({ id: "future", status: "completed", completedAt: iso(at(2026, 11, 2)) }),
      item({ id: "pending", completedAt: iso(at(2026, 10, 1)) }),
    ];
    const graph = buildTimelineGraph(items, "day", now);
    expect(graph.total).toBe(0);
    expect(graph.columns).toHaveLength(1); // just today
  });

  it("marks the column holding each month's first day", () => {
    const items = [item({ id: "a", status: "completed", completedAt: iso(at(2026, 8, 20)) })];
    const graph = buildTimelineGraph(items, "day", now);
    const start = graph.columns[0].start;
    const dayOf = (i: number) => new Date(graph.columns[i].start).getDate();
    expect(graph.months.map((m) => m.key)).toEqual(["2026-08", "2026-09", "2026-10"]);
    // August starts before the first column, so it jumps to column 0.
    expect(graph.months[0].columnIndex).toBe(0);
    expect(new Date(start).getDate()).toBe(20);
    expect(dayOf(graph.months[1].columnIndex)).toBe(1);
    expect(dayOf(graph.months[2].columnIndex)).toBe(1);
  });

  it("puts a month inside the week that contains its first day", () => {
    const items = [item({ id: "a", status: "completed", completedAt: iso(at(2026, 9, 22)) })];
    const graph = buildTimelineGraph(items, "week", now);
    const october = graph.months.find((m) => m.key === "2026-10")!;
    const col = graph.columns[october.columnIndex];
    // 2026-10-01 is a Thursday, in the week of Monday Sep 28.
    expect(col.start).toBe(new Date(2026, 8, 28).getTime());
    expect(col.end).toBeGreaterThan(new Date(2026, 9, 1).getTime());
  });
});

describe("summarizeOpenItems", () => {
  const items = [
    item({ id: "done", status: "completed" }),
    item({ id: "cancelled", status: "cancelled" }),
    item({ id: "later", status: "deferred", priority: "critical" }),
    item({ id: "low", priority: "low" }),
    item({ id: "high", priority: "high" }),
    item({
      id: "active", status: "in_progress", priority: "low",
      children: [
        item({ id: "c1", status: "completed" }),
        item({ id: "c2", children: [item({ id: "c3", status: "completed" })] }),
        item({ id: "c4", status: "deleted" }),
      ],
    }),
  ];

  it("lists open top-level items, work in hand first, then by priority", () => {
    const { shown, hidden } = summarizeOpenItems(items, 10);
    expect(shown.map((o) => o.id)).toEqual(["active", "high", "low", "later"]);
    expect(hidden).toBe(0);
  });

  it("counts done over total descendants, leaving out cancelled and deleted", () => {
    const active = summarizeOpenItems(items, 10).shown[0];
    expect(active).toMatchObject({ done: 2, total: 3 });
  });

  it("cuts to the limit and says how many it left out", () => {
    const { shown, hidden } = summarizeOpenItems(items, 2);
    expect(shown.map((o) => o.id)).toEqual(["active", "high"]);
    expect(hidden).toBe(2);
  });
});
