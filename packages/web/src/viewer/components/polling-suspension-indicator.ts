/**
 * Polling suspension status indicator component.
 *
 * Shows a compact floating indicator when polling is globally suspended
 * due to memory pressure. Informs users that auto-refresh is disabled,
 * explains why, and provides a manual refresh button so they can still
 * trigger data updates on demand.
 *
 * Hidden when polling is running normally.
 */

import { h } from "preact";

export interface PollingSuspensionIndicatorProps {
  /** Whether polling is currently globally suspended. */
  isSuspended: boolean;
  /** Number of polling sources currently suspended. */
  suspendedCount: number;
  /** Called when the user clicks the manual refresh button. */
  onRefresh: () => void;
}

export function PollingSuspensionIndicator({
  isSuspended,
  suspendedCount,
  onRefresh,
}: PollingSuspensionIndicatorProps) {
  if (!isSuspended) return null;

  const detail =
    suspendedCount === 1
      ? "1 data source paused"
      : `${suspendedCount} data sources paused`;

  return h(
    "div",
    {
      class: "polling-suspension-indicator",
      role: "status",
      "aria-live": "polite",
      "aria-label": "Auto-refresh suspended due to memory pressure",
    },
    h("span", { class: "polling-suspension-icon", "aria-hidden": "true" }, "\u23F8\uFE0F"), // pause button emoji
    h(
      "div",
      { class: "polling-suspension-info" },
      h("span", { class: "polling-suspension-title" }, "Auto-refresh paused"),
      h(
        "span",
        { class: "polling-suspension-detail" },
        `${detail} \u2014 memory pressure`,
      ),
    ),
    h(
      "button",
      {
        class: "polling-suspension-refresh",
        onClick: onRefresh,
        type: "button",
        "aria-label": "Refresh data now",
      },
      "Refresh",
    ),
  );
}
