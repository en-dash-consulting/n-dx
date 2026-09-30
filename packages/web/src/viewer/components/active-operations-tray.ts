/**
 * Persistent job tray — a small always-visible badge that expands into a list
 * of every long-running dashboard action currently in flight (or recently
 * finished/failed), regardless of which view is active.
 *
 * Each running row carries a Stop; each finished row carries a result card
 * linking to where the job's output landed. Both come off the operation
 * itself (`stopUrl`, `result`) rather than being switched on `kind` here —
 * adding a job to the tray is then a single edit in the hook's source table,
 * not two edits in two files that can disagree.
 *
 * Renders nothing when there's nothing to show. Data comes from
 * useActiveOperations (hooks/use-active-operations.ts).
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import type { ActiveOperation } from "../hooks/index.js";
import { useTick } from "../hooks/index.js";
import { fmtDuration } from "../utils/format.js";
import type { NavigateTo } from "../types.js";

export interface ActiveOperationsTrayProps {
  operations: ActiveOperation[];
  navigateTo?: NavigateTo;
  /** Interrupt a running job. Rows render no Stop without it. */
  onStop?: (op: ActiveOperation) => void;
}

const STATUS_ICON: Record<ActiveOperation["status"], string> = {
  running: "●", // ●, spun via CSS
  done: "✓", // ✓
  failed: "✗", // ✗
};

function elapsedFormatter(startedAt: string): string {
  return fmtDuration(startedAt, new Date().toISOString());
}

function OperationRow(
  { op, navigateTo, onStop }: { op: ActiveOperation; navigateTo?: NavigateTo; onStop?: (op: ActiveOperation) => void },
) {
  const elapsed = useTick(op.startedAt, elapsedFormatter);
  // The full failure detail (untruncated) is only actually logged to the
  // Activity log for hench task executions (routes-hench.ts's
  // task_execution_failed entries) — don't offer the link for operation
  // kinds where it'd lead to an empty search.
  const canViewDetails = op.status === "failed" && op.kind === "hench" && !!navigateTo;
  // Only a completed run has something to show. A failure has no output to
  // link to, and a stop leaves whatever the run had written half-done —
  // pointing at either would promise a result that is not there.
  const showResult = op.status === "done" && !op.stopped && !!navigateTo;

  return h("li", { class: `active-op-row active-op-row-${op.status}` },
    h("span", { class: "active-op-icon", "aria-hidden": "true" }, STATUS_ICON[op.status]),
    h("div", { class: "active-op-info" },
      h("span", { class: "active-op-label" }, op.label),
      h("span", { class: "active-op-detail" },
        op.status === "running"
          ? `running… ${elapsed}`
          : op.status === "failed"
            ? "Task failed"
            : (op.detail || "Complete"),
      ),
      op.status === "failed" && (op.error || op.detail)
        ? h("span", { class: "active-op-reason", title: op.error || op.detail }, op.error || op.detail)
        : null,
      canViewDetails
        ? h("button", {
            class: "active-op-details-link",
            type: "button",
            onClick: () => navigateTo!("activity"),
          }, "View details")
        : null,
      showResult
        ? h("div", { class: "active-op-result" },
            h("span", { class: "active-op-result-text" }, op.detail || "Complete"),
            h("button", {
              class: "active-op-result-link",
              type: "button",
              onClick: () => navigateTo!(op.result.view),
            }, op.result.label),
          )
        : null,
    ),
    op.status === "running" && onStop
      ? h("button", {
          class: "active-op-stop",
          type: "button",
          onClick: () => onStop(op),
          title: `Stop ${op.label}`,
          "aria-label": `Stop ${op.label}`,
        }, "Stop")
      : null,
  );
}

export function ActiveOperationsTray({ operations, navigateTo, onStop }: ActiveOperationsTrayProps) {
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
          operations.map((op) => h(OperationRow, { key: op.id, op, navigateTo, onStop })),
        )
      : null,
  );
}
