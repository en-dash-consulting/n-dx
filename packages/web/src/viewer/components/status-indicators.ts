/**
 * Sidebar status indicators — compact health badges for each product section.
 *
 * Fetches `/api/status` with polling and renders:
 * - SourceVision: analysis freshness indicator
 * - Rex: PRD completion percentage + pending task indicator
 * - Hench: run count badge
 *
 * Designed to slot into each sidebar section's item list, below nav items.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import type { ViewId } from "../types.js";

// ---------------------------------------------------------------------------
// Types (mirror server-side ProjectStatus shape)
// ---------------------------------------------------------------------------

type AnalysisFreshness = "fresh" | "stale" | "unavailable";

interface SourceVisionStatus {
  freshness: AnalysisFreshness;
  analyzedAt: string | null;
  minutesAgo: number | null;
  modulesComplete: number;
  modulesTotal: number;
}

interface TreeStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  deferred: number;
  blocked: number;
}

interface RexStatus {
  exists: boolean;
  percentComplete: number;
  stats: TreeStats | null;
  hasInProgress: boolean;
  hasPending: boolean;
  nextTaskTitle: string | null;
}

interface HenchStatus {
  configured: boolean;
  totalRuns: number;
  activeRuns: number;
  staleRuns: number;
}

interface ProjectStatus {
  sv: SourceVisionStatus;
  rex: RexStatus;
  hench: HenchStatus;
}

// ---------------------------------------------------------------------------
// Status fetcher with dedup + polling
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;

let cachedStatus: ProjectStatus | null = null;
let fetchPromise: Promise<ProjectStatus | null> | null = null;

async function fetchStatus(): Promise<ProjectStatus | null> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) return null;
      const data: ProjectStatus = await res.json();
      cachedStatus = data;
      return data;
    } catch {
      return null;
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

/** Hook that returns project status, polling at a regular interval.
 *  Also listens for WebSocket events (hench:run-changed, rex:prd-changed)
 *  to refresh immediately when runs or PRD data change on disk. */
function useProjectStatus(): ProjectStatus | null {
  const [status, setStatus] = useState<ProjectStatus | null>(cachedStatus);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const refresh = async () => {
      const data = await fetchStatus();
      if (mountedRef.current) setStatus(data);
    };

    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    // Connect to WebSocket for instant status updates when runs/PRD change
    let ws: WebSocket | null = null;
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}`);
      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          // Refresh status on any event that could affect counts
          if (
            msg.type === "hench:run-changed" ||
            msg.type === "hench:task-execution-progress" ||
            msg.type === "rex:prd-changed"
          ) {
            refresh();
          }
        } catch {
          // ignore malformed messages
        }
      };
    } catch {
      // WebSocket not available — polling still works as fallback
    }

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  return status;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// SourceVision freshness indicator
// ---------------------------------------------------------------------------

interface SvIndicatorProps {
  status: SourceVisionStatus;
  onNavigate: (view: ViewId) => void;
  tabIndex: number;
}

export function SvFreshnessIndicator({ status, onNavigate, tabIndex }: SvIndicatorProps) {
  if (status.freshness === "unavailable") {
    return h("div", {
      class: "sidebar-indicator sidebar-indicator-warning",
      role: "status",
      "aria-label": "SourceVision analysis not available",
    },
      h("span", { class: "indicator-dot indicator-dot-unavailable", "aria-hidden": "true" }),
      h("span", { class: "indicator-text" }, "No analysis"),
    );
  }

  const isStale = status.freshness === "stale";
  const timeLabel = status.minutesAgo != null ? formatTimeAgo(status.minutesAgo) : "";

  return h("div", {
    class: `sidebar-indicator${isStale ? " sidebar-indicator-warning" : " sidebar-indicator-ok"}`,
    role: "button",
    tabIndex,
    "aria-label": `Analysis ${isStale ? "stale" : "fresh"}${timeLabel ? ` — last run ${timeLabel}` : ""} — click to view`,
    onClick: () => onNavigate("overview"),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onNavigate("overview");
      }
    },
  },
    h("span", {
      class: `indicator-dot ${isStale ? "indicator-dot-stale" : "indicator-dot-fresh"}`,
      "aria-hidden": "true",
    }),
    h("span", { class: "indicator-text" },
      isStale ? `Stale (${timeLabel})` : `Fresh (${timeLabel})`,
    ),
  );
}

// ---------------------------------------------------------------------------
// Rex PRD completion indicator
// ---------------------------------------------------------------------------

interface RexIndicatorProps {
  status: RexStatus;
  onNavigate: (view: ViewId) => void;
  tabIndex: number;
}

export function RexCompletionIndicator({ status, onNavigate, tabIndex }: RexIndicatorProps) {
  if (!status.exists) {
    return h("div", {
      class: "sidebar-indicator sidebar-indicator-warning",
      role: "status",
      "aria-label": "No PRD data",
    },
      h("span", { class: "indicator-dot indicator-dot-unavailable", "aria-hidden": "true" }),
      h("span", { class: "indicator-text" }, "No PRD"),
    );
  }

  const { percentComplete, stats, hasPending, hasInProgress, nextTaskTitle } = status;
  const total = stats?.total ?? 0;
  const completed = stats?.completed ?? 0;
  const inProgress = stats?.inProgress ?? 0;
  const pending = stats?.pending ?? 0;

  // Color the progress bar based on activity
  const barClass = hasInProgress ? "indicator-fill-active" : "indicator-fill-default";

  const ariaLabel = [
    `PRD: ${percentComplete}% complete`,
    `${completed}/${total} tasks done`,
    inProgress > 0 ? `${inProgress} in progress` : null,
    pending > 0 ? `${pending} pending` : null,
    nextTaskTitle ? `Next: ${nextTaskTitle}` : null,
  ].filter(Boolean).join(", ");

  return h("div", {
    class: "sidebar-indicator sidebar-indicator-prd",
    role: "button",
    tabIndex,
    "aria-label": `${ariaLabel} — click to view`,
    onClick: () => onNavigate("rex-dashboard"),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onNavigate("rex-dashboard");
      }
    },
  },
    // Top row: percentage + task counts
    h("div", { class: "indicator-row" },
      h("span", { class: "indicator-pct" }, `${percentComplete}%`),
      h("span", { class: "indicator-meta" },
        total > 0
          ? `${completed}/${total}`
          : "empty",
      ),
      hasInProgress
        ? h("span", { class: "indicator-badge indicator-badge-active", title: `${inProgress} in progress` }, inProgress)
        : null,
      hasPending
        ? h("span", { class: "indicator-badge indicator-badge-pending", title: `${pending} pending` }, pending)
        : null,
    ),
    // Progress bar
    h("div", { class: "indicator-bar", role: "progressbar", "aria-valuenow": String(percentComplete), "aria-valuemin": "0", "aria-valuemax": "100" },
      h("div", {
        class: `indicator-fill ${barClass}`,
        style: `width: ${percentComplete}%`,
      }),
    ),
    // Next task hint (if available)
    nextTaskTitle
      ? h("div", { class: "indicator-next", title: nextTaskTitle },
          h("span", { class: "indicator-next-label" }, "Next: "),
          nextTaskTitle,
        )
      : null,
  );
}

// ---------------------------------------------------------------------------
// Hench activity indicator
// ---------------------------------------------------------------------------

interface HenchIndicatorProps {
  status: HenchStatus;
  onNavigate: (view: ViewId) => void;
  tabIndex: number;
}

export function HenchActivityIndicator({ status, onNavigate, tabIndex }: HenchIndicatorProps) {
  if (!status.configured) {
    return h("div", {
      class: "sidebar-indicator sidebar-indicator-warning",
      role: "status",
      "aria-label": "Hench not configured",
    },
      h("span", { class: "indicator-dot indicator-dot-unavailable", "aria-hidden": "true" }),
      h("span", { class: "indicator-text" }, "Not configured"),
    );
  }

  const hasStaleRuns = status.staleRuns > 0;

  return h("div", {
    class: `sidebar-indicator ${hasStaleRuns ? "sidebar-indicator-warning" : "sidebar-indicator-ok"}`,
    role: "button",
    tabIndex,
    "aria-label": `Hench: ${status.totalRuns} runs${hasStaleRuns ? `, ${status.staleRuns} stuck` : ""} — click to view`,
    onClick: () => onNavigate("hench-runs"),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onNavigate("hench-runs");
      }
    },
  },
    h("span", {
      class: `indicator-dot ${hasStaleRuns ? "indicator-dot-stale" : "indicator-dot-fresh"}`,
      "aria-hidden": "true",
    }),
    h("span", { class: "indicator-text" },
      hasStaleRuns
        ? `${status.staleRuns} stuck run${status.staleRuns === 1 ? "" : "s"}`
        : `${status.totalRuns} run${status.totalRuns === 1 ? "" : "s"}`,
    ),
  );
}

// ---------------------------------------------------------------------------
// Composite hook export
// ---------------------------------------------------------------------------

export { useProjectStatus };
export type { ProjectStatus, SourceVisionStatus, RexStatus, HenchStatus };
