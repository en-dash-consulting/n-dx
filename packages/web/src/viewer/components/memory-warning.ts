/**
 * Memory warning banner component.
 *
 * Displays a non-intrusive banner when memory usage approaches browser limits.
 * Provides actionable guidance based on the severity level. The banner is
 * dismissible but reappears if the level escalates.
 */

import { h } from "preact";
import type { MemorySnapshot, MemoryLevel } from "../performance/index.js";
import { formatBytes, formatRatio } from "../performance/index.js";

export interface MemoryWarningProps {
  /** Current memory snapshot (null = no data yet). */
  snapshot: MemorySnapshot | null;
  /** Current memory warning level. */
  level: MemoryLevel;
  /** Whether the banner should be visible. */
  visible: boolean;
  /** Called when the user dismisses the banner. */
  onDismiss: () => void;
}

const LEVEL_CONFIG: Record<
  "warning" | "critical",
  { icon: string; label: string; className: string; advice: string }
> = {
  warning: {
    icon: "\u26A0\uFE0F",
    label: "High memory usage",
    className: "memory-warning-banner memory-warning-level-warning",
    advice: "Consider closing the graph view or other heavy views to free memory.",
  },
  critical: {
    icon: "\uD83D\uDED1",
    label: "Critical memory usage",
    className: "memory-warning-banner memory-warning-level-critical",
    advice: "Memory is nearly exhausted. Close heavy views or refresh the page to avoid a crash.",
  },
};

export function MemoryWarningBanner({
  snapshot,
  level,
  visible,
  onDismiss,
}: MemoryWarningProps) {
  if (!visible || (level !== "warning" && level !== "critical")) return null;

  const cfg = LEVEL_CONFIG[level];
  const used = snapshot ? formatBytes(snapshot.usedJSHeapSize) : "N/A";
  const limit = snapshot ? formatBytes(snapshot.jsHeapSizeLimit) : "N/A";
  const ratio = snapshot ? formatRatio(snapshot.usageRatio) : "N/A";

  return h(
    "div",
    {
      class: cfg.className,
      role: "alert",
      "aria-live": "assertive",
    },
    h("div", { class: "memory-warning-content" },
      h("span", { class: "memory-warning-icon", "aria-hidden": "true" }, cfg.icon),
      h("div", { class: "memory-warning-text" },
        h("strong", null, cfg.label),
        h("span", { class: "memory-warning-detail" },
          ` — ${ratio} of heap used (${used} / ${limit})`
        ),
        h("p", { class: "memory-warning-advice" }, cfg.advice),
      ),
      h(
        "button",
        {
          class: "memory-warning-dismiss",
          onClick: onDismiss,
          "aria-label": "Dismiss memory warning",
          type: "button",
        },
        "\u2715"
      ),
    ),
  );
}
