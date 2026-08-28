/**
 * Persistent "active operations" tray — a small always-visible badge that
 * expands into a list of every long-running dashboard action currently in
 * flight (or recently finished/failed), regardless of which view is active.
 *
 * Renders nothing when there's nothing to show. Data comes from
 * useActiveOperations (hooks/use-active-operations.ts).
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import type { ActiveOperation } from "../hooks/index.js";
import { useTick } from "../hooks/index.js";
import { fmtDuration } from "../utils/format.js";

export interface ActiveOperationsTrayProps {
  operations: ActiveOperation[];
}

const STATUS_ICON: Record<ActiveOperation["status"], string> = {
  running: "●", // ●, spun via CSS
  done: "✓", // ✓
  failed: "✗", // ✗
};

function elapsedFormatter(startedAt: string): string {
  return fmtDuration(startedAt, new Date().toISOString());
}

function OperationRow({ op }: { op: ActiveOperation }) {
  const elapsed = useTick(op.startedAt, elapsedFormatter);

  return h("li", { class: `active-op-row active-op-row-${op.status}` },
    h("span", { class: "active-op-icon", "aria-hidden": "true" }, STATUS_ICON[op.status]),
    h("div", { class: "active-op-info" },
      h("span", { class: "active-op-label" }, op.label),
      h("span", { class: "active-op-detail" },
        op.status === "running"
          ? `running… ${elapsed}`
          : op.status === "failed"
            ? (op.error || op.detail || "Failed")
            : (op.detail || "Complete"),
      ),
    ),
  );
}

export function ActiveOperationsTray({ operations }: ActiveOperationsTrayProps) {
  const [expanded, setExpanded] = useState(false);

  if (operations.length === 0) return null;

  const runningCount = operations.filter((op) => op.status === "running").length;
  const hasFailure = operations.some((op) => op.status === "failed");
  const summary = runningCount > 0
    ? `${runningCount} running`
    : hasFailure
      ? "Finished with errors"
      : "Finished";

  return h("div", { class: "active-operations-tray", role: "status", "aria-live": "polite" },
    h("button", {
      class: `active-operations-toggle${hasFailure ? " active-operations-toggle-error" : ""}`,
      type: "button",
      onClick: () => setExpanded((v) => !v),
      "aria-expanded": String(expanded),
      "aria-label": `${summary} — ${expanded ? "hide" : "show"} active operations`,
    },
      h("span", {
        class: `active-operations-badge-icon${runningCount > 0 ? " spinning" : ""}`,
        "aria-hidden": "true",
      }, runningCount > 0 ? "●" : hasFailure ? "✗" : "✓"),
      h("span", { class: "active-operations-summary" }, summary),
    ),
    expanded
      ? h("ul", { class: "active-operations-list", "aria-label": "Active and recent operations" },
          operations.map((op) => h(OperationRow, { key: op.id, op })),
        )
      : null,
  );
}
