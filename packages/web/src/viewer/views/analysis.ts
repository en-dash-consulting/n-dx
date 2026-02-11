/**
 * Analysis view — dedicated Rex view for triggering analysis, smart add,
 * batch import, and reviewing proposals.
 *
 * Shows: smart add (natural language → proposals), batch import (multi-file/text),
 * project analysis, pending proposals list with accept/reject, and recent analysis history.
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { AnalyzePanel } from "../components/prd-tree/analyze-panel.js";
import { SmartAddInput } from "../components/prd-tree/smart-add-input.js";
import { BatchImportPanel } from "../components/prd-tree/batch-import-panel.js";
import { BrandedHeader } from "../components/logos.js";

// ── Types ────────────────────────────────────────────────────────────

/** @see packages/rex/src/schema/v1.ts — LogEntry (viewer duplicate for browser bundling) */
interface LogEntry {
  timestamp: string;
  event: string;
  itemId?: string;
  detail?: string;
}

type AnalysisTab = "smart-add" | "batch-import" | "scan";

// ── Component ────────────────────────────────────────────────────────

export function AnalysisView() {
  const [activeTab, setActiveTab] = useState<AnalysisTab>("smart-add");
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
            e.event.includes("plan") ||
            e.event.includes("smart_add") ||
            e.event.includes("batch_import"),
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
        "Add items with natural language or scan the project to discover new work items.",
      ),
    ),

    // Tab bar
    h("div", { class: "rex-analysis-tabs" },
      h("button", {
        class: `rex-analysis-tab${activeTab === "smart-add" ? " active" : ""}`,
        onClick: () => setActiveTab("smart-add"),
        type: "button",
      }, "Smart Add"),
      h("button", {
        class: `rex-analysis-tab${activeTab === "batch-import" ? " active" : ""}`,
        onClick: () => setActiveTab("batch-import"),
        type: "button",
      }, "Batch Import"),
      h("button", {
        class: `rex-analysis-tab${activeTab === "scan" ? " active" : ""}`,
        onClick: () => setActiveTab("scan"),
        type: "button",
      }, "Project Scan"),
    ),

    // Tab content
    activeTab === "smart-add"
      ? h(SmartAddInput, { onPrdChanged: handlePrdChanged })
      : activeTab === "batch-import"
        ? h(BatchImportPanel, { onPrdChanged: handlePrdChanged })
        : h(AnalyzePanel, { onPrdChanged: handlePrdChanged }),

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
