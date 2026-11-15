/**
 * How a PRD item status is drawn: its glyph, its label and its badge class.
 *
 * The tree rows, the detail panel's status selector, the inline status
 * picker, the bulk-actions bar and the facet filter all read this one table,
 * so a status looks the same wherever it appears. Each picker chooses which
 * statuses it offers, and in what order, with `statusOptions`.
 */

import type { ItemStatus } from "./types.js";

export interface StatusDisplay {
  icon: string;
  label: string;
  cssClass: string;
}

export const STATUS_DISPLAY: Readonly<Record<ItemStatus, StatusDisplay>> = {
  pending: { icon: "○", label: "Pending", cssClass: "prd-status-pending" },
  in_progress: { icon: "◐", label: "In Progress", cssClass: "prd-status-in-progress" },
  completed: { icon: "●", label: "Completed", cssClass: "prd-status-completed" },
  failing: { icon: "⚠", label: "Failing", cssClass: "prd-status-failing" },
  blocked: { icon: "⊘", label: "Blocked", cssClass: "prd-status-blocked" },
  deferred: { icon: "◌", label: "Deferred", cssClass: "prd-status-deferred" },
  cancelled: { icon: "⊗", label: "Cancelled", cssClass: "prd-status-cancelled" },
  deleted: { icon: "✕", label: "Deleted", cssClass: "prd-status-deleted" },
};

export interface StatusOption {
  value: ItemStatus;
  label: string;
  icon: string;
}

/** A picker's options: the given statuses, in the given order. */
export function statusOptions(statuses: readonly ItemStatus[]): StatusOption[] {
  return statuses.map((value) => ({ value, label: STATUS_DISPLAY[value].label, icon: STATUS_DISPLAY[value].icon }));
}
