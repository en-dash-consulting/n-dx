/**
 * Refresh queue status indicator component.
 *
 * Shows current queue depth, memory-adjusted refresh state, and estimated
 * completion time when refresh operations are queued or throttled. Hidden
 * when the queue is empty and no throttling is active.
 */

import { h } from "preact";
import type { MemoryLevel } from "../memory-monitor.js";
import type { RefreshQueueState } from "../refresh-throttle.js";

export interface RefreshQueueStatusProps {
  /** Current queue state from the refresh throttle. */
  state: RefreshQueueState;
  /** Whether this indicator should be visible. */
  visible: boolean;
}

/** Human-readable labels for memory levels in context of refresh. */
const LEVEL_LABELS: Record<MemoryLevel, string> = {
  normal: "Normal speed",
  elevated: "Throttled (2\u00D7 interval)",
  warning: "Heavily throttled (4\u00D7 interval)",
  critical: "Paused \u2014 memory critical",
};

const LEVEL_ICON: Record<MemoryLevel, string> = {
  normal: "\uD83D\uDD04",       // arrows counterclockwise
  elevated: "\u26A1",            // lightning bolt
  warning: "\u26A0\uFE0F",      // warning sign
  critical: "\u23F8\uFE0F",     // pause button
};

/** Format milliseconds as a human-friendly duration. */
function formatDuration(ms: number): string {
  if (ms < 0) return "unknown";
  if (ms === 0) return "done";
  if (ms < 1000) return "< 1s";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `~${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes}m`;
}

export function RefreshQueueStatus({
  state,
  visible,
}: RefreshQueueStatusProps) {
  if (!visible) return null;

  const { queueLength, activeCount, paused, memoryLevel, estimatedCompletionMs } = state;
  const hasActivity = queueLength > 0 || activeCount > 0;
  const isThrottled = memoryLevel !== "normal";

  // Don't show anything if there's nothing to report.
  if (!hasActivity && !isThrottled) return null;

  const icon = LEVEL_ICON[memoryLevel];
  const levelLabel = LEVEL_LABELS[memoryLevel];

  const statusClass = paused
    ? "refresh-queue-status refresh-queue-paused"
    : isThrottled
      ? "refresh-queue-status refresh-queue-throttled"
      : "refresh-queue-status refresh-queue-active";

  return h(
    "div",
    {
      class: statusClass,
      role: "status",
      "aria-live": "polite",
      "aria-label": "Refresh queue status",
    },
    h("span", { class: "refresh-queue-icon", "aria-hidden": "true" }, icon),
    h(
      "div",
      { class: "refresh-queue-info" },
      h(
        "span",
        { class: "refresh-queue-level" },
        levelLabel,
      ),
      hasActivity
        ? h(
            "span",
            { class: "refresh-queue-detail" },
            paused
              ? `${queueLength} queued \u2014 waiting for memory to stabilize`
              : `${activeCount} active, ${queueLength} queued`,
            estimatedCompletionMs > 0
              ? ` \u2014 ETA ${formatDuration(estimatedCompletionMs)}`
              : null,
          )
        : null,
    ),
  );
}
