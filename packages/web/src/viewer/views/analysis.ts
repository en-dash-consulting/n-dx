/**
 * Analysis view — dedicated Rex view for triggering analysis and
 * reviewing proposals.
 *
 * Shows: trigger analysis button, pending proposals list with
 * accept/reject, and recent analysis history from the execution log.
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { AnalyzePanel } from "../components/prd-tree/analyze-panel.js";
import { BrandedHeader } from "../components/logos.js";

// ── Types ────────────────────────────────────────────────────────────

interface LogEntry {
  timestamp: string;
  event: string;
  itemId?: string;
  detail?: string;
}

// ── Component ────────────────────────────────────────────────────────

export function AnalysisView() {
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(true);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch("/api/rex/log?limit=50");
      if (res.ok) {
        const data = await res.json();
        // Filter to analysis-related events
        const analysisEvents = (data.entries as LogEntry[]).filter(
          (e) =>
            e.event.includes("analysis") ||
            e.event.includes("analyze") ||
            e.event.includes("proposal") ||
            e.event.includes("plan"),
        );
        setLogEntries(analysisEvents.reverse());
      }
    } catch {
      // Silently fail — log is non-critical
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const handlePrdChanged = useCallback(() => {
    // Refresh log after proposals are accepted
    fetchLog();
  }, [fetchLog]);

  return h(
    "div",
    { class: "rex-analysis-view" },

    // View header
    h("div", { class: "rex-analysis-view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", null, "Analysis"),
      h("p", { class: "rex-analysis-view-subtitle" },
        "Scan the project to discover new work items and review proposals before adding them to the PRD.",
      ),
    ),

    // Analyze panel (reused component)
    h(AnalyzePanel, { onPrdChanged: handlePrdChanged }),

    // Analysis history
    h("div", { class: "rex-analysis-history" },
      h("h3", { class: "rex-analysis-history-title" }, "Recent Activity"),
      logLoading
        ? h("p", { class: "rex-analysis-history-empty" }, "Loading...")
        : logEntries.length === 0
          ? h("p", { class: "rex-analysis-history-empty" }, "No analysis activity recorded yet.")
          : h("div", { class: "rex-analysis-history-list" },
              logEntries.map((entry, i) =>
                h("div", { key: i, class: "rex-analysis-history-entry" },
                  h("span", { class: "rex-analysis-history-time" }, formatTime(entry.timestamp)),
                  h("span", { class: `rex-analysis-history-event ${eventClass(entry.event)}` }, formatEvent(entry.event)),
                  entry.detail
                    ? h("span", { class: "rex-analysis-history-detail" }, entry.detail)
                    : null,
                ),
              ),
            ),
    ),
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }) + " " + d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function formatEvent(event: string): string {
  return event
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function eventClass(event: string): string {
  if (event.includes("completed") || event.includes("accepted")) return "success";
  if (event.includes("error") || event.includes("failed")) return "error";
  if (event.includes("started") || event.includes("running")) return "running";
  return "";
}
