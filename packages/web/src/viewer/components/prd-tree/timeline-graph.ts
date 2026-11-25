/**
 * Timeline graph: the PRD laid out along a horizontal time axis.
 *
 * Now sits at the right edge, the past scrolls away to the left. Each
 * completed item hangs off the axis on a stem that turns diagonal to carry
 * its title; the open top-level items are listed to the right of today. A
 * month bar above the graph jumps to where each month begins.
 *
 * Geometry: every label leaves its stem at 45°, and a column is exactly
 * `lanes` lane-steps wide, so each (column, lane) pair sits on its own
 * diagonal — no two labels can overlap, and no stem reaches a label from a
 * newer column. A column with more completions than lanes shows the rest
 * behind a "+N more" list.
 *
 * @see ./timeline-graph-model.ts — bucketing, months and the open-items summary
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { PRDItemData } from "./types.js";
import type { TimelineEntry } from "./completion-timeline.js";
import {
  buildTimelineGraph,
  summarizeOpenItems,
  type TimelineColumn,
  type TimelineScale,
} from "./timeline-graph-model.js";
import { appUrl } from "../../base-path.js";
import { viewPathname } from "../../route-state.js";

/** Distance between two lanes along a stem, in px. */
const LANE_STEP = 24;
const LANES: Record<TimelineScale, number> = { day: 3, week: 7 };
/** Stem height to the first lane. */
const STEM_BASE = 18;
/** Room under the axis for the tick labels. */
const AXIS_BOTTOM = 34;
/** Longest a diagonal label may run before it is cut with an ellipsis. */
const LABEL_MAX = 200;
/** Room left of the first column for its labels, which lean into the past. */
const LEFT_PAD = Math.ceil(LABEL_MAX * Math.SQRT1_2) + 24;
const TODAY_GAP = 20;
const OPEN_PANEL_WIDTH = 280;
const OPEN_LIMIT = 8;

const SCALE_KEY = "ndx.prd.timeline-scale";

function readScale(): TimelineScale {
  try { return localStorage.getItem(SCALE_KEY) === "week" ? "week" : "day"; } catch { return "day"; }
}

function itemHref(id: string): string {
  return appUrl(viewPathname("prd", id));
}

function formatDay(time: number): string {
  return new Date(time).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function tickLabel(col: TimelineColumn, scale: TimelineScale): string {
  const d = new Date(col.start);
  return scale === "week"
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : String(d.getDate());
}

function columnLabel(col: TimelineColumn, scale: TimelineScale): string {
  return scale === "week" ? `Week of ${formatDay(col.start)}` : formatDay(col.start);
}

export interface TimelineGraphProps {
  items: PRDItemData[];
  /** Opens the item in the detail panel, as a click on a tree row does. */
  onSelectItem: (item: PRDItemData) => void;
  /** Switches back to the tree, where every open item is listed. */
  onShowTree?: () => void;
}

export function TimelineGraph({ items, onSelectItem, onShowTree }: TimelineGraphProps) {
  const [scale, setScaleState] = useState<TimelineScale>(readScale);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const setScale = (next: TimelineScale) => {
    setScaleState(next);
    setExpanded(null);
    try { localStorage.setItem(SCALE_KEY, next); } catch { /* storage unavailable */ }
  };

  const graph = useMemo(() => buildTimelineGraph(items, scale), [items, scale]);
  const open = useMemo(() => summarizeOpenItems(items, OPEN_LIMIT), [items]);

  const lanes = LANES[scale];
  const colWidth = lanes * LANE_STEP;
  const stemTop = STEM_BASE + (lanes - 1) * LANE_STEP;
  const height = AXIS_BOTTOM + stemTop + Math.ceil(LABEL_MAX * Math.SQRT1_2) + 28;
  const todayX = LEFT_PAD + graph.columns.length * colWidth + TODAY_GAP / 2;
  const width = todayX + TODAY_GAP / 2 + OPEN_PANEL_WIDTH + 16;

  const columnX = (index: number) => LEFT_PAD + index * colWidth;

  const monthAt = (scrollLeft: number, clientWidth: number): string | null => {
    const centre = Math.floor((scrollLeft + clientWidth / 2 - LEFT_PAD) / colWidth);
    let key: string | null = graph.months[0]?.key ?? null;
    for (const m of graph.months) if (m.columnIndex <= centre) key = m.key;
    return key;
  };

  // Open on now: the right end, where the open items are.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    setActiveMonth(monthAt(el.scrollLeft, el.clientWidth));
  }, [scale, graph.columns.length]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => setActiveMonth(monthAt(el.scrollLeft, el.clientWidth));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [graph, colWidth]);

  const jumpToMonth = (columnIndex: number) => {
    scrollerRef.current?.scrollTo({ left: Math.max(0, columnX(columnIndex) - 24), behavior: "smooth" });
  };

  /** A link that opens the item in the detail panel, and in a new tab on a modified click. */
  const itemLink = (item: PRDItemData, cls: string, title: string, label: string) =>
    h("a", {
      class: cls,
      href: itemHref(item.id),
      title,
      onClick: (e: MouseEvent) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onSelectItem(item);
      },
    }, label);

  const entryTitle = (entry: TimelineEntry) =>
    [entry.title, `completed ${new Date(entry.completedAt).toLocaleString()}`, entry.parentChain.join(" › ")]
      .filter(Boolean).join("\n");

  const renderColumn = (col: TimelineColumn, index: number) => {
    if (col.entries.length === 0) return null;
    const overflow = col.entries.length > lanes;
    const shown = overflow ? col.entries.slice(0, lanes - 1) : col.entries;
    const usedLanes = shown.length + (overflow ? 1 : 0);
    const x = columnX(index) + colWidth / 2;
    const joint = (lane: number, child: ComponentChild, key: string) =>
      h("div", {
        key,
        class: "tlg-joint",
        style: { left: `${x}px`, bottom: `${AXIS_BOTTOM + STEM_BASE + lane * LANE_STEP}px` },
      }, child);

    return h("div", { key: col.start, class: "tlg-column" },
      h("div", {
        class: "tlg-stem",
        style: { left: `${x}px`, bottom: `${AXIS_BOTTOM}px`, height: `${STEM_BASE + (usedLanes - 1) * LANE_STEP}px` },
      }),
      h("div", { class: "tlg-dot", style: { left: `${x}px`, bottom: `${AXIS_BOTTOM}px` }, title: columnLabel(col, scale) }),
      shown.map((entry, lane) =>
        joint(lane, itemLink(entry.item, `tlg-label tlg-type-${entry.itemType}`, entryTitle(entry), entry.title), entry.id),
      ),
      overflow
        ? joint(lanes - 1, h("button", {
            type: "button",
            class: `tlg-label tlg-more${expanded === index ? " active" : ""}`,
            "aria-expanded": String(expanded === index),
            title: `Every item completed ${scale === "week" ? "that week" : "that day"}`,
            onClick: () => setExpanded(expanded === index ? null : index),
          }, `+${col.entries.length - shown.length} more`), "more")
        : null,
    );
  };

  const expandedCol = expanded !== null ? graph.columns[expanded] : null;

  return h("div", { class: "timeline-graph" },
    // Toolbar: scale, and the months to jump between
    h("div", { class: "tlg-toolbar" },
      h("div", { class: "tlg-scale", role: "group", "aria-label": "Timeline scale" },
        (["day", "week"] as const).map((s) =>
          h("button", {
            key: s,
            type: "button",
            class: `tlg-scale-btn${scale === s ? " active" : ""}`,
            "aria-pressed": String(scale === s),
            onClick: () => setScale(s),
          }, s === "day" ? "Day" : "Week"),
        ),
      ),
      h("nav", { class: "tlg-months", "aria-label": "Jump to month" },
        graph.months.map((m) =>
          h("button", {
            key: m.key,
            type: "button",
            class: `tlg-month-btn${activeMonth === m.key ? " active" : ""}`,
            "aria-current": activeMonth === m.key ? "true" : undefined,
            onClick: () => jumpToMonth(m.columnIndex),
          }, m.label),
        ),
      ),
      h("span", { class: "tlg-count" }, `${graph.total} completed`),
    ),

    // The scrolling graph
    h("div", {
      ref: scrollerRef,
      class: "tlg-scroller",
      tabIndex: 0,
      role: "region",
      "aria-label": "Completed items by date; scroll left for older work",
    },
      h("div", { class: "tlg-canvas", style: { width: `${width}px`, height: `${height}px` } },
        // Month bands and their names along the top
        graph.months.map((m, i) => {
          const left = columnX(m.columnIndex);
          const right = i + 1 < graph.months.length ? columnX(graph.months[i + 1].columnIndex) : columnX(graph.columns.length);
          return h("div", {
            key: m.key,
            class: `tlg-month-band${i % 2 ? " odd" : ""}${activeMonth === m.key ? " active" : ""}`,
            style: { left: `${left}px`, width: `${Math.max(0, right - left)}px` },
          }, h("span", { class: "tlg-month-name" }, m.label));
        }),

        // Axis and ticks
        h("div", { class: "tlg-axis", style: { left: `${LEFT_PAD}px`, width: `${todayX - LEFT_PAD}px`, bottom: `${AXIS_BOTTOM}px` } }),
        graph.columns.map((col, i) =>
          h("div", {
            key: col.start,
            class: `tlg-tick${new Date(col.start).getDay() === 1 || scale === "week" ? " major" : ""}`,
            style: { left: `${columnX(i)}px`, width: `${colWidth}px` },
            title: columnLabel(col, scale),
          }, tickLabel(col, scale)),
        ),

        // Completed items
        graph.columns.map(renderColumn),
        graph.total === 0
          ? h("div", { class: "tlg-empty", style: { right: `${width - todayX + 16}px` } }, "Nothing completed yet.")
          : null,

        // Now
        h("div", { class: "tlg-today", style: { left: `${todayX}px`, bottom: `${AXIS_BOTTOM - 6}px` } },
          h("span", { class: "tlg-today-label" }, "Today"),
        ),

        // Still open, to the right of today
        h("section", {
          class: "tlg-open",
          "aria-label": "Still open",
          style: { left: `${todayX + TODAY_GAP / 2}px`, width: `${OPEN_PANEL_WIDTH}px`, bottom: `${AXIS_BOTTOM + 8}px`, maxHeight: `${height - AXIS_BOTTOM - 16}px` },
        },
          h("h3", { class: "tlg-open-heading" }, "Still open"),
          open.shown.length === 0
            ? h("p", { class: "tlg-open-empty" }, "Everything is done.")
            : h("ul", { class: "tlg-open-list" },
                open.shown.map((o) =>
                  h("li", { key: o.id, class: `tlg-open-item tlg-status-${o.status}` },
                    h("span", { class: "tlg-open-status", "aria-hidden": "true" }),
                    itemLink(o.item, "tlg-open-title", `${o.title}\n${o.status.replace("_", " ")}`, o.title),
                    o.total > 0 ? h("span", { class: "tlg-open-progress" }, `${o.done}/${o.total}`) : null,
                  ),
                ),
              ),
          open.hidden > 0
            ? onShowTree
              ? h("button", { type: "button", class: "tlg-open-more", onClick: onShowTree }, `+${open.hidden} more in the tree`)
              : h("p", { class: "tlg-open-more" }, `+${open.hidden} more`)
            : null,
        ),
      ),
    ),

    // Everything completed in the column whose "+N more" is open
    expandedCol
      ? h("div", { class: "tlg-expanded", role: "region", "aria-label": columnLabel(expandedCol, scale) },
          h("div", { class: "tlg-expanded-header" },
            h("span", null, `${columnLabel(expandedCol, scale)} · ${expandedCol.entries.length} completed`),
            h("button", { type: "button", class: "tlg-expanded-close", onClick: () => setExpanded(null), "aria-label": "Close" }, "×"),
          ),
          h("ul", { class: "tlg-expanded-list" },
            expandedCol.entries.map((entry) =>
              h("li", { key: entry.id },
                itemLink(entry.item, "tlg-expanded-title", entryTitle(entry), entry.title),
                entry.parentChain.length > 0
                  ? h("span", { class: "tlg-expanded-crumb" }, entry.parentChain.join(" › "))
                  : null,
              ),
            ),
          ),
        )
      : null,
  );
}
