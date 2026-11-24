/**
 * Analysis view — dedicated Rex view for triggering analysis, smart add,
 * batch import, and reviewing proposals.
 *
 * Shows: smart add (natural language → proposals), batch import (multi-file/text),
 * project analysis, pending proposals list with accept/reject, and recent analysis history.
 *
 * On Plan it is the capture tile (`onMore` set): one Smart Add row whose
 * "More" opens the tile's modal, where the view renders whole. Both sit under
 * a {@link CaptureDraftProvider}, so text typed and images attached in the
 * row are there in the modal, and the other way round.
 */

import { h, createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useState, useEffect, useCallback, useContext, useMemo } from "preact/hooks";
import type { Dispatch, StateUpdater } from "preact/hooks";
import type { PendingImage } from "../components/prd-tree/image-attachments.js";
import { AnalyzePanel } from "../components/prd-tree/analyze-panel.js";
import { SmartAddInput, BatchImportPanel } from "../components/prd-tree/index.js";
import { BrandedHeader } from "../components/index.js";
import type { NavigateTo } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────

/** @see packages/rex/src/schema/v1.ts — LogEntry (viewer duplicate for browser bundling) */
interface LogEntry {
  timestamp: string;
  event: string;
  itemId?: string;
  detail?: string;
}

type AnalysisTab = "smart-add" | "batch-import" | "scan";

// ── Shared draft ─────────────────────────────────────────────────────

interface CaptureDraft {
  text: string;
  setText: (text: string) => void;
  /** Images waiting to be attached; the capture that adds the change clears them. */
  images: PendingImage[];
  setImages: Dispatch<StateUpdater<PendingImage[]>>;
  /** Captures made by any view sharing the draft; the others drop their preview when it moves. */
  captures: number;
  markCaptured: () => void;
}

const CaptureDraftContext = createContext<CaptureDraft | null>(null);

/**
 * One draft — description and images — shared by every Analysis view beneath
 * it: Plan's capture tile and its modal, so neither loses or keeps what the
 * other was given.
 */
export function CaptureDraftProvider({ children }: { children?: ComponentChildren }) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [captures, setCaptures] = useState(0);
  const markCaptured = useCallback(() => setCaptures((n) => n + 1), []);
  const value = useMemo(() => ({ text, setText, images, setImages, captures, markCaptured }), [text, images, captures, markCaptured]);
  return h(CaptureDraftContext.Provider, { value }, children);
}

// ── Component ────────────────────────────────────────────────────────

export interface AnalysisViewProps {
  /** Opens an added change's detail panel (Quick Add's "Amends…"). */
  navigateTo?: NavigateTo;
  /**
   * Render the capture row only, with a "More" button that calls this. The
   * button has focus when it is called, so a dialog it opens (Plan's capture
   * tile) returns focus to it.
   */
  onMore?: () => void;
}

export function AnalysisView({ navigateTo, onMore }: AnalysisViewProps = {}) {
  const openChange = navigateTo ? (id: string) => navigateTo("prd", { taskId: id }) : undefined;
  const draft = useContext(CaptureDraftContext);
  const [activeTab, setActiveTab] = useState<AnalysisTab>("smart-add");
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const row = !!onMore;

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

  // The row shows no history, so it does not read the log.
  useEffect(() => {
    if (!row) fetchLog();
  }, [fetchLog, row]);

  // A v2 add captures a change into the Inbox rather than generating
  // proposals, so the panel's words depend on the layout. /api/rex/changes
  // answers `{ layout }` on both; a failed read takes the v1 wording. Until it
  // answers the layout is unknown (null): the capture row waits rather than
  // show v1's Generate first on a v2 project.
  const [read, setLayout] = useState<"v1" | "v2" | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/rex/changes")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { layout?: string } | null) => {
        if (!cancelled) setLayout(body?.layout === "v2" ? "v2" : "v1");
      })
      .catch(() => { if (!cancelled) setLayout("v1"); });
    return () => { cancelled = true; };
  }, []);
  const layout = read ?? "v1";

  const handlePrdChanged = useCallback(() => {
    // Refresh log after proposals are accepted
    if (!row) fetchLog();
  }, [fetchLog, row]);

  const smartAdd = (bar: boolean) => h(SmartAddInput, {
    onPrdChanged: handlePrdChanged,
    bar,
    barAction: bar ? moreButton(onMore!) : null,
    layout,
    onOpenChange: openChange,
    ...(draft
      ? { draft: draft.text, onDraftChange: draft.setText, images: draft.images, onImagesChange: draft.setImages, captureCount: draft.captures, onCaptured: draft.markCaptured }
      : {}),
  });

  if (row) {
    return h("div", { class: "rex-analysis-view rex-analysis-view--row" },
      read === null ? h("p", { class: "stage-tile-empty", role: "status" }, "Loading...") : smartAdd(true));
  }

  return h(
    "div",
    { class: "rex-analysis-view" },

    // View header
    h("div", { class: "rex-analysis-view-header view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "view-title" }, "Analysis"),
      h("p", { class: "section-sub rex-analysis-view-subtitle" },
        "Add items with natural language or scan the project to discover new work items.",
      ),
    ),

    h("div", { class: "rex-analysis-tabs-row" },
      h("div", { class: "rex-analysis-tabs" },
        h("button", {
          class: `rex-analysis-tab${activeTab === "smart-add" ? " active" : ""}`,
          onClick: () => setActiveTab("smart-add"),
          type: "button",
        }, layout === "v2" ? "Add to Inbox" : "Smart Add"),
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
    ),

    activeTab === "smart-add"
      ? smartAdd(false)
      : activeTab === "batch-import"
        ? h(BatchImportPanel, { onPrdChanged: handlePrdChanged })
        : h(AnalyzePanel, { onPrdChanged: handlePrdChanged }),

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

/** The row's "More": opens the full form in a dialog. */
function moreButton(onMore: () => void) {
  return h("button", {
    type: "button",
    class: "cmd-btn cmd-btn-secondary rex-analysis-more",
    onClick: (e: Event) => {
      // Where a click does not focus a button (Safari), the dialog would return focus elsewhere.
      (e.currentTarget as HTMLElement).focus();
      onMore();
    },
    "aria-haspopup": "dialog",
    title: "Attachments, scope, batch import, project scan and history",
  }, "More…");
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
