/**
 * Bulk actions bar for PRD items.
 *
 * Shows a floating action bar when items are selected, with options
 * to bulk-update status across multiple items.
 */

import { h } from "preact";
import { useState, useCallback } from "preact/hooks";
import type { ItemStatus } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────

export interface BulkActionsProps {
  /** IDs of currently selected items. */
  selectedIds: Set<string>;
  /** Called to clear selection. */
  onClearSelection: () => void;
  /** Called after a bulk action completes (to refresh data). */
  onActionComplete: () => void;
}

// ── Constants ────────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{ value: ItemStatus; label: string; icon: string }> = [
  { value: "pending", label: "Pending", icon: "○" },
  { value: "in_progress", label: "In Progress", icon: "◐" },
  { value: "completed", label: "Completed", icon: "●" },
  { value: "blocked", label: "Blocked", icon: "⊘" },
  { value: "deferred", label: "Deferred", icon: "◌" },
  { value: "deleted", label: "Deleted", icon: "✕" },
];

// ── Component ────────────────────────────────────────────────────────

export function BulkActions({ selectedIds, onClearSelection, onActionComplete }: BulkActionsProps) {
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleStatusUpdate = useCallback(
    async (status: ItemStatus) => {
      if (selectedIds.size === 0) return;

      setApplying(true);
      setResult(null);

      try {
        const res = await fetch("/api/rex/items/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: [...selectedIds],
            updates: { status },
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: "Update failed" }));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const successCount = data.results?.filter((r: { ok: boolean }) => r.ok).length ?? 0;
        setResult(`Updated ${successCount} item${successCount !== 1 ? "s" : ""} to ${status.replace("_", " ")}`);

        // Brief delay to show result, then refresh
        setTimeout(() => {
          setResult(null);
          onActionComplete();
          onClearSelection();
        }, 1500);
      } catch (err) {
        setResult(`Error: ${err}`);
        setTimeout(() => setResult(null), 3000);
      } finally {
        setApplying(false);
      }
    },
    [selectedIds, onActionComplete, onClearSelection],
  );

  if (selectedIds.size === 0) return null;

  return h(
    "div",
    { class: "rex-bulk-bar" },

    // Selection count
    h("div", { class: "rex-bulk-count" },
      h("span", { class: "rex-bulk-count-num" }, String(selectedIds.size)),
      h("span", null, ` item${selectedIds.size !== 1 ? "s" : ""} selected`),
    ),

    // Status actions
    result
      ? h("div", { class: "rex-bulk-result" }, result)
      : h("div", { class: "rex-bulk-actions" },
          h("span", { class: "rex-bulk-label" }, "Set status:"),
          STATUS_OPTIONS.map((opt) =>
            h("button", {
              key: opt.value,
              class: `rex-bulk-action-btn prd-status-${opt.value}`,
              onClick: () => handleStatusUpdate(opt.value),
              disabled: applying,
              title: opt.label,
            },
              h("span", { class: "rex-bulk-action-icon" }, opt.icon),
              h("span", { class: "rex-bulk-action-label" }, opt.label),
            ),
          ),
        ),

    // Clear selection
    h("button", {
      class: "rex-bulk-clear",
      onClick: onClearSelection,
      title: "Clear selection",
    }, "\u00d7"),
  );
}
