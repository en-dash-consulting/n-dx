/**
 * Timeline graph model: the pure half of the PRD's timeline layout.
 *
 * Buckets completed items into day or week columns running from the first
 * completion up to now, marks where each month begins so the month bar can
 * jump to it, and summarises the top-level items still open for the panel
 * to the right of today. Rendering lives in `timeline-graph.ts`.
 */

import type { PRDItemData, ItemStatus, Priority } from "./types.js";
import { buildTimeline, type TimelineEntry } from "./completion-timeline.js";
import { itemTypeOf } from "../../external.js";

export type TimelineScale = "day" | "week";

export interface TimelineColumn {
  /** Local-time start of the bucket (midnight; Monday for a week). */
  start: number;
  /** Exclusive end of the bucket. */
  end: number;
  /** Completions in the bucket, newest first. */
  entries: TimelineEntry[];
}

export interface TimelineMonth {
  /** `YYYY-MM`, stable across renders. */
  key: string;
  label: string;
  /** Index of the column that holds the month's first day. */
  columnIndex: number;
}

export interface TimelineGraphData {
  columns: TimelineColumn[];
  months: TimelineMonth[];
  /** Completions that made it into a column (an unparseable date is dropped). */
  total: number;
}

/** Start of the bucket holding `time`, in local time. Weeks start on Monday. */
export function bucketStart(time: number, scale: TimelineScale): number {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  if (scale === "week") {
    const sinceMonday = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - sinceMonday);
  }
  return d.getTime();
}

/** The bucket after the one starting at `start` — by calendar, so DST never skews it. */
function nextBucket(start: number, scale: TimelineScale): number {
  const d = new Date(start);
  d.setDate(d.getDate() + (scale === "week" ? 7 : 1));
  return d.getTime();
}

/**
 * Columns from the earliest completion's bucket through the bucket holding
 * `now`, one per day or week with none skipped, so the axis stays linear and
 * an idle stretch reads as one.
 */
export function buildTimelineGraph(
  items: PRDItemData[],
  scale: TimelineScale,
  now: number = Date.now(),
): TimelineGraphData {
  const dated = buildTimeline(items)
    .map((entry) => ({ entry, time: Date.parse(entry.completedAt) }))
    .filter(({ time }) => Number.isFinite(time) && time <= now);

  const last = bucketStart(now, scale);
  const first = dated.length > 0
    ? Math.min(last, bucketStart(Math.min(...dated.map((d) => d.time)), scale))
    : last;

  const columns: TimelineColumn[] = [];
  for (let start = first; start <= last; start = nextBucket(start, scale)) {
    columns.push({ start, end: nextBucket(start, scale), entries: [] });
  }

  // `buildTimeline` sorts newest first, so each column fills newest first too.
  let col = columns.length - 1;
  for (const { entry, time } of dated) {
    while (col > 0 && time < columns[col].start) col--;
    columns[col].entries.push(entry);
  }

  return { columns, months: monthsOf(columns), total: dated.length };
}

function monthsOf(columns: TimelineColumn[]): TimelineMonth[] {
  if (columns.length === 0) return [];
  const months: TimelineMonth[] = [];
  const cursor = new Date(columns[0].start);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  const lastEnd = columns[columns.length - 1].end;
  let col = 0;
  while (cursor.getTime() < lastEnd) {
    const firstDay = cursor.getTime();
    while (col < columns.length - 1 && columns[col].end <= firstDay) col++;
    months.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
      label: cursor.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      columnIndex: col,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

// ── Still open ──────────────────────────────────────────────────────

export interface OpenItemSummary {
  item: PRDItemData;
  id: string;
  title: string;
  itemType: string;
  status: ItemStatus;
  /** Completed descendants. */
  done: number;
  /** Descendants that count toward progress (cancelled and deleted do not). */
  total: number;
}

const CLOSED: ReadonlySet<ItemStatus> = new Set(["completed", "cancelled", "deleted"]);

/** Work in hand first, then what is waiting, then what is parked. */
const STATUS_RANK: Partial<Record<ItemStatus, number>> = {
  in_progress: 0,
  failing: 1,
  blocked: 2,
  pending: 3,
  deferred: 4,
};

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function countDescendants(item: PRDItemData): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const walk = (children: PRDItemData[] | undefined) => {
    for (const child of children ?? []) {
      if (child.status !== "cancelled" && child.status !== "deleted") {
        total++;
        if (child.status === "completed") done++;
      }
      walk(child.children);
    }
  };
  walk(item.children);
  return { done, total };
}

/**
 * The top-level items not yet finished, ordered by status then priority,
 * cut to `limit`. `hidden` is how many the cut left out.
 */
export function summarizeOpenItems(
  items: PRDItemData[],
  limit: number,
): { shown: OpenItemSummary[]; hidden: number } {
  const open = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !CLOSED.has(item.status))
    .sort((a, b) =>
      (STATUS_RANK[a.item.status] ?? 9) - (STATUS_RANK[b.item.status] ?? 9)
      || PRIORITY_RANK[a.item.priority ?? "medium"] - PRIORITY_RANK[b.item.priority ?? "medium"]
      || a.index - b.index,
    );
  const shown = open.slice(0, limit).map(({ item }) => ({
    item,
    id: item.id,
    title: item.title,
    itemType: itemTypeOf(item),
    status: item.status,
    ...countDescendants(item),
  }));
  return { shown, hidden: open.length - shown.length };
}
