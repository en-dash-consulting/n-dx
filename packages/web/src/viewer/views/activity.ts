/**
 * Activity view — the PRD execution log.
 *
 * Renders `.rex/execution-log.jsonl` (served by GET /api/rex/log): every
 * status change, item mutation, sync, reorganize and agent work-log entry.
 * This is the human surface for the MCP `append_log` write path, which
 * previously had no viewer at all.
 */

import { h } from "preact";
import { useState, useEffect, useMemo, useCallback } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";

interface LogEntry {
  timestamp: string;
  event: string;
  itemId?: string;
  detail?: string;
}

/** How many entries to request; the log rotates at 1 MB so this is a tail. */
const LOG_LIMIT = 500;

export function ActivityView() {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rex/log?limit=${LOG_LIMIT}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { entries?: LogEntry[] };
      setEntries(body.entries ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Distinct event names, most frequent first, for the filter control. */
  const eventNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries ?? []) counts.set(e.event, (counts.get(e.event) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [entries]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (entries ?? [])
      .filter((e) => eventFilter === "all" || e.event === eventFilter)
      .filter((e) => !needle
        || e.event.toLowerCase().includes(needle)
        || (e.detail ?? "").toLowerCase().includes(needle)
        || (e.itemId ?? "").toLowerCase().includes(needle))
      .slice()
      .reverse(); // newest first
  }, [entries, eventFilter, search]);

  return h("div", { class: "activity-container" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "view-title" }, "Activity"),
    ),
    h("p", { class: "section-sub" },
      "Append-only execution log: status changes, item mutations, syncs, and agent work logs.",
    ),

    error
      ? h("div", { class: "cmd-result cmd-result-error", role: "alert" },
          `Could not load the execution log: ${error}`)
      : null,

    !entries && !error
      ? h("div", { class: "empty-state", role: "status" }, "Loading activity…")
      : null,

    entries && entries.length === 0
      ? h("div", { class: "empty-state" },
          "No activity recorded yet. Entries appear as items change status and agents log their work.")
      : null,

    entries && entries.length > 0
      ? h("div", { class: "filter-bar" },
          h("input", {
            type: "text",
            class: "filter-input",
            placeholder: "Search detail, event, or item id…",
            value: search,
            "aria-label": "Search activity",
            onInput: (e: Event) => setSearch((e.target as HTMLInputElement).value),
          }),
          h("select", {
            class: "filter-select",
            value: eventFilter,
            "aria-label": "Filter by event",
            onChange: (e: Event) => setEventFilter((e.target as HTMLSelectElement).value),
          },
            h("option", { value: "all" }, "All events"),
            eventNames.map((name) => h("option", { key: name, value: name }, name)),
          ),
          h("button", { class: "filter-toggle-btn", onClick: load }, "Refresh"),
          h("span", { class: "filter-result-count" },
            `${visible.length} of ${entries.length} entries`),
        )
      : null,

    visible.length > 0
      ? h("table", { class: "data-table activity-table" },
          h("thead", null,
            h("tr", null,
              h("th", null, "When"),
              h("th", null, "Event"),
              h("th", null, "Item"),
              h("th", null, "Detail"),
            ),
          ),
          h("tbody", null,
            visible.map((entry, i) =>
              h("tr", { key: `${entry.timestamp}-${i}` },
                h("td", { class: "mono-sm activity-when" },
                  new Date(entry.timestamp).toLocaleString()),
                h("td", null, h("span", { class: "tag" }, entry.event)),
                h("td", { class: "mono-sm" }, entry.itemId ? entry.itemId.slice(0, 8) : ""),
                h("td", { class: "activity-detail" }, entry.detail ?? ""),
              ),
            ),
          ),
        )
      : null,
  );
}
