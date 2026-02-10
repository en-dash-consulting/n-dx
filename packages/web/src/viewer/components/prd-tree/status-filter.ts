/**
 * Status filter controls for the PRD tree view.
 *
 * Renders a row of toggleable status chips that control which items
 * are visible in the tree. All statuses are enabled by default.
 * Quick filter presets provide one-click access to common combinations.
 */

import { h } from "preact";
import { useCallback, useMemo } from "preact/hooks";
import type { ItemStatus } from "./types.js";

/** All available statuses in display order. */
export const ALL_STATUSES: ItemStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "deferred",
  "deleted",
];

/** Human-readable labels and icons for each status. */
const STATUS_DISPLAY: Record<ItemStatus, { icon: string; label: string; cssClass: string }> = {
  pending:     { icon: "\u25CB", label: "Pending",     cssClass: "prd-status-pending" },
  in_progress: { icon: "\u25D0", label: "In Progress", cssClass: "prd-status-in-progress" },
  completed:   { icon: "\u25CF", label: "Completed",   cssClass: "prd-status-completed" },
  blocked:     { icon: "\u2298", label: "Blocked",     cssClass: "prd-status-blocked" },
  deferred:    { icon: "\u25CC", label: "Deferred",    cssClass: "prd-status-deferred" },
  deleted:     { icon: "\u2715", label: "Deleted",     cssClass: "prd-status-deleted" },
};

// ── Filter presets ───────────────────────────────────────────────────

export interface FilterPreset {
  /** Unique key for the preset. */
  key: string;
  /** Label shown on the button. */
  label: string;
  /** Tooltip describing the preset. */
  title: string;
  /** Statuses included in this preset. */
  statuses: ReadonlySet<ItemStatus>;
}

/** Predefined filter presets in display order. */
export const FILTER_PRESETS: readonly FilterPreset[] = [
  {
    key: "all",
    label: "All Items",
    title: "Show all statuses including deleted",
    statuses: new Set<ItemStatus>(ALL_STATUSES),
  },
  {
    key: "active",
    label: "Active Work",
    title: "Show pending, in progress, and blocked items",
    statuses: new Set<ItemStatus>(["pending", "in_progress", "blocked"]),
  },
  {
    key: "completed",
    label: "Completed",
    title: "Show only completed items",
    statuses: new Set<ItemStatus>(["completed"]),
  },
  {
    key: "blocked-deferred",
    label: "Blocked/Deferred",
    title: "Show blocked and deferred items that need attention",
    statuses: new Set<ItemStatus>(["blocked", "deferred"]),
  },
];

/**
 * Determine which preset (if any) matches the current active statuses.
 * Returns the preset key or null if no preset matches exactly.
 */
export function activePresetKey(activeStatuses: Set<ItemStatus>): string | null {
  for (const preset of FILTER_PRESETS) {
    if (
      activeStatuses.size === preset.statuses.size &&
      [...preset.statuses].every((s) => activeStatuses.has(s))
    ) {
      return preset.key;
    }
  }
  return null;
}

// ── Component ────────────────────────────────────────────────────────

export interface StatusFilterProps {
  /** Currently active (visible) statuses. */
  activeStatuses: Set<ItemStatus>;
  /** Called when the set of active statuses changes. */
  onChange: (statuses: Set<ItemStatus>) => void;
}

export function StatusFilter({ activeStatuses, onChange }: StatusFilterProps) {
  const toggleStatus = useCallback(
    (status: ItemStatus) => {
      const next = new Set(activeStatuses);
      if (next.has(status)) {
        // Don't allow deselecting all statuses
        if (next.size <= 1) return;
        next.delete(status);
      } else {
        next.add(status);
      }
      onChange(next);
    },
    [activeStatuses, onChange],
  );

  const currentPreset = useMemo(
    () => activePresetKey(activeStatuses),
    [activeStatuses],
  );

  return h(
    "div",
    { class: "prd-status-filter", role: "group", "aria-label": "Filter by status" },
    // Filter label
    h("span", { class: "prd-status-filter-label" }, "Filter:"),
    // Quick presets
    h(
      "div",
      { class: "prd-status-filter-presets" },
      FILTER_PRESETS.map((preset) =>
        h(
          "button",
          {
            key: preset.key,
            class: `prd-status-preset${currentPreset === preset.key ? " active" : ""}`,
            onClick: () => onChange(new Set(preset.statuses)),
            title: preset.title,
            "aria-pressed": String(currentPreset === preset.key),
            type: "button",
          },
          preset.label,
        ),
      ),
      // Custom indicator when no preset matches
      currentPreset === null
        ? h(
            "span",
            { class: "prd-status-preset-custom", title: "Custom filter combination" },
            "Custom",
          )
        : null,
    ),
    // Status chips
    h(
      "div",
      { class: "prd-status-filter-chips", role: "toolbar", "aria-label": "Status chip toggles" },
      ALL_STATUSES.map((status) => {
        const display = STATUS_DISPLAY[status];
        const isActive = activeStatuses.has(status);
        return h(
          "button",
          {
            key: status,
            class: `prd-status-chip${isActive ? " active" : ""} ${display.cssClass}`,
            onClick: () => toggleStatus(status),
            title: `${isActive ? "Hide" : "Show"} ${display.label.toLowerCase()} items`,
            "aria-pressed": String(isActive),
            type: "button",
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                const next = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
                next?.focus();
              }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                const prev = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
                prev?.focus();
              }
            },
          },
          h("span", { class: "prd-status-chip-icon" }, display.icon),
          h("span", { class: "prd-status-chip-label" }, display.label),
        );
      }),
    ),
  );
}

/** Default set of visible statuses (everything except deleted). */
export function defaultStatusFilter(): Set<ItemStatus> {
  return new Set<ItemStatus>(["pending", "in_progress", "completed", "blocked", "deferred"]);
}
