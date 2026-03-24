/**
 * Completion timeline: shows recently completed PRD items sorted by date.
 *
 * Data source walks the tree collecting items with completedAt timestamps.
 * View renders them grouped by day with parent breadcrumbs.
 */

import { h } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { PRDItemData } from "./types.js";

// ── Data source ──────────────────────────────────────────────────────

export interface TimelineEntry {
  id: string;
  title: string;
  level: string;
  completedAt: string;
  parentChain: string[];
}

/**
 * Collect completed items from the tree, sorted by completedAt descending.
 */
export function buildTimeline(items: PRDItemData[], parentChain: string[] = []): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const item of items) {
    if (item.status === "completed" && item.completedAt) {
      entries.push({
        id: item.id,
        title: item.title,
        level: item.level,
        completedAt: item.completedAt,
        parentChain,
      });
    }
    if (item.children) {
      entries.push(...buildTimeline(item.children, [...parentChain, item.title]));
    }
  }
  entries.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return entries;
}

// ── View ─────────────────────────────────────────────────────────────

const LEVEL_ICONS: Record<string, string> = {
  epic: "\u25A0",
  feature: "\u25C6",
  task: "\u25CF",
  subtask: "\u25CB",
};

const RANGE_PRESETS = [
  { label: "Today", days: 1 },
  { label: "This week", days: 7 },
  { label: "This month", days: 30 },
  { label: "All time", days: 0 },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function daysAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

export interface CompletionTimelineProps {
  items: PRDItemData[];
}

export function CompletionTimeline({ items }: CompletionTimelineProps) {
  const [rangeDays, setRangeDays] = useState(7);
  const allEntries = useMemo(() => buildTimeline(items), [items]);

  const filtered = useMemo(() => {
    if (rangeDays === 0) return allEntries;
    return allEntries.filter((e) => daysAgo(e.completedAt) <= rangeDays);
  }, [allEntries, rangeDays]);

  // Group by day
  const grouped = useMemo(() => {
    const groups = new Map<string, TimelineEntry[]>();
    for (const entry of filtered) {
      const day = formatDate(entry.completedAt);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(entry);
    }
    return groups;
  }, [filtered]);

  return h("div", { class: "completion-timeline" },
    // Range presets
    h("div", { class: "timeline-range-bar" },
      RANGE_PRESETS.map((preset) =>
        h("button", {
          key: preset.label,
          class: `timeline-range-btn${rangeDays === preset.days ? " active" : ""}`,
          onClick: () => setRangeDays(preset.days),
        }, preset.label),
      ),
      h("span", { class: "timeline-count" }, `${filtered.length} items`),
    ),
    // Grouped entries
    filtered.length === 0
      ? h("div", { class: "timeline-empty" }, "No completions in this range.")
      : Array.from(grouped.entries()).map(([day, entries]) =>
          h("div", { key: day, class: "timeline-day-group" },
            h("div", { class: "timeline-day-header" }, day),
            entries.map((entry) =>
              h("div", { key: entry.id, class: "timeline-entry" },
                h("span", { class: `timeline-level timeline-level-${entry.level}` }, LEVEL_ICONS[entry.level] || "\u25CF"),
                h("span", { class: "timeline-title" }, entry.title),
                entry.parentChain.length > 0
                  ? h("span", { class: "timeline-breadcrumb" }, entry.parentChain.join(" \u203A "))
                  : null,
                h("span", { class: "timeline-time" }, formatTime(entry.completedAt)),
              ),
            ),
          ),
        ),
  );
}
