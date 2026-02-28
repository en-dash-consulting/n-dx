/**
 * Degradation notification banner component.
 *
 * Informs the user when features have been automatically disabled due to
 * memory pressure. Explains what's disabled and why, and provides a button
 * to dismiss the notice. Shows only when degradation is active (tier > normal)
 * and the memory warning banner is NOT already visible (to avoid stacking).
 */

import { h } from "preact";
import type { MemoryLevel } from "../memory-monitor.js";
import type { DegradableFeature } from "../graceful-degradation.js";

export interface DegradationBannerProps {
  /** Current degradation tier. */
  tier: MemoryLevel;
  /** Whether degradation is active (tier !== "normal"). */
  isDegraded: boolean;
  /** Human-readable summary message. */
  summary: string;
  /** Set of disabled features. */
  disabledFeatures: ReadonlySet<DegradableFeature>;
  /** Whether this banner should be visible. */
  visible: boolean;
  /** Called when the user dismisses the banner. */
  onDismiss: () => void;
}

/** Human-readable names for degradable features. */
const FEATURE_LABELS: Record<DegradableFeature, string> = {
  autoRefresh: "Auto-refresh",
  deferredLoading: "Background loading",
  graphRendering: "Graph view",
  animations: "Animations",
  detailPanel: "Detail panel",
};

const TIER_ICON: Record<MemoryLevel, string> = {
  normal: "",
  elevated: "\u26A1",       // lightning bolt
  warning: "\u26A0\uFE0F",  // warning sign
  critical: "\uD83D\uDED1", // stop sign
};

export function DegradationBanner({
  tier,
  isDegraded,
  summary,
  disabledFeatures,
  visible,
  onDismiss,
}: DegradationBannerProps) {
  if (!visible || !isDegraded || tier === "normal") return null;

  const icon = TIER_ICON[tier];
  const tierClass =
    tier === "critical"
      ? "degradation-banner degradation-critical"
      : tier === "warning"
        ? "degradation-banner degradation-warning"
        : "degradation-banner degradation-elevated";

  const featureList = Array.from(disabledFeatures)
    .map((f) => FEATURE_LABELS[f])
    .join(", ");

  return h(
    "div",
    {
      class: tierClass,
      role: "status",
      "aria-live": "polite",
    },
    h(
      "div",
      { class: "degradation-content" },
      h("span", { class: "degradation-icon", "aria-hidden": "true" }, icon),
      h(
        "div",
        { class: "degradation-text" },
        h("strong", null, "Reduced functionality"),
        h("p", { class: "degradation-summary" }, summary),
        h(
          "p",
          { class: "degradation-features" },
          `Disabled: ${featureList}`
        ),
      ),
      h(
        "button",
        {
          class: "degradation-dismiss",
          onClick: onDismiss,
          "aria-label": "Dismiss degradation notice",
          type: "button",
        },
        "\u2715"
      ),
    ),
  );
}
