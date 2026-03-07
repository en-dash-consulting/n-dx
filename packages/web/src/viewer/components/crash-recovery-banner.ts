/**
 * Crash recovery banner component.
 *
 * Displays after a detected crash to inform the user what happened and
 * offer to restore their previous navigation state. The banner adapts
 * its messaging based on whether the crash is a one-off or part of a
 * crash loop (multiple recent crashes).
 */

import { h } from "preact";
import type { SavedNavigationState } from "../performance/index.js";

export interface CrashRecoveryBannerProps {
  /** Whether the banner should be visible. */
  visible: boolean;
  /** Whether the app is in a crash loop (multiple recent crashes). */
  crashLoop: boolean;
  /** Number of recent crashes. */
  recentCrashCount: number;
  /** Recovered navigation state (null if nothing to restore). */
  recoveredState: SavedNavigationState | null;
  /** Called when the user dismisses the banner. */
  onDismiss: () => void;
  /** Called when the user chooses to restore their previous state. */
  onRestore: () => void;
}

export function CrashRecoveryBanner({
  visible,
  crashLoop,
  recentCrashCount,
  recoveredState,
  onDismiss,
  onRestore,
}: CrashRecoveryBannerProps) {
  if (!visible) return null;

  const hasState = recoveredState !== null;

  const heading = crashLoop
    ? "Repeated crashes detected"
    : "Recovered from a crash";

  const description = crashLoop
    ? `The page has crashed ${recentCrashCount} times recently, likely due to high memory usage. ` +
      "Heavy views have been avoided to prevent another crash."
    : "The page was automatically recovered after an unexpected crash. " +
      "This was likely caused by high memory usage.";

  return h(
    "div",
    {
      class: `crash-recovery-banner${crashLoop ? " crash-recovery-loop" : ""}`,
      role: "alert",
      "aria-live": "assertive",
    },
    h("div", { class: "crash-recovery-content" },
      h("span", { class: "crash-recovery-icon", "aria-hidden": "true" },
        crashLoop ? "\uD83D\uDD04" : "\u2705"),
      h("div", { class: "crash-recovery-text" },
        h("strong", null, heading),
        h("p", { class: "crash-recovery-description" }, description),
        hasState && !crashLoop
          ? h("p", { class: "crash-recovery-state-info" },
              `Your previous location (${formatViewName(recoveredState.view)}) has been saved.`)
          : null,
      ),
      h("div", { class: "crash-recovery-actions" },
        hasState && !crashLoop
          ? h("button", {
              class: "crash-recovery-restore",
              onClick: onRestore,
              type: "button",
            }, "Restore view")
          : null,
        h("button", {
          class: "crash-recovery-dismiss",
          onClick: onDismiss,
          "aria-label": "Dismiss crash recovery message",
          type: "button",
        }, crashLoop ? "Dismiss" : (hasState ? "Start fresh" : "Dismiss")),
      ),
    ),
  );
}

/** Format a ViewId into a human-readable label. */
function formatViewName(view: string): string {
  return view
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
