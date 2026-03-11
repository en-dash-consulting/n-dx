/**
 * Sidebar status indicators — compact health badges for each product section.
 *
 * Pure presentation components that render status data as sidebar badges.
 * The infrastructure coupling (polling, WebSocket, messaging) lives in the
 * `use-project-status` hook, following the consistent hook abstraction
 * pattern used across all infrastructure services.
 */

import { h } from "preact";
import type { ViewId } from "../types.js";

// Re-export hook and types from the canonical hooks location.
// This preserves backward-compatibility for any consumer that imported
// from this module before the extraction.
export { useProjectStatus } from "../hooks/index.js";
export type {
  ProjectStatus,
  SourceVisionStatus,
  RexStatus,
  HenchStatus,
} from "../hooks/index.js";

// Import types for use in component props
import type { SourceVisionStatus, RexStatus, HenchStatus } from "../hooks/index.js";

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
