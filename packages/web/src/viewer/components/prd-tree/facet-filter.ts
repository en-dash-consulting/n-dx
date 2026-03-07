/**
 * Tag and status facet filter chips for the PRD tree search.
 *
 * Renders toggleable chip rows below the search input so users can
 * narrow results by tag and/or status. Tag chips are populated
 * dynamically from the current PRD data; status chips use the
 * canonical status list.
 *
 * Tags use a searchable typeahead instead of a flat chip list to
 * handle PRDs with hundreds of unique tags. Selected tags appear as
 * dismissable chips; unselected tags are revealed via a text filter.
 *
 * Facets combine with AND logic: selecting a tag AND a status shows
 * only items that have that tag AND that status. Within the tag group,
 * AND logic applies (item must have ALL selected tags). Within the
 * status group, OR logic applies (item matches ANY selected status).
 *
 * @see ./tree-search.ts — SearchFacets type and searchTree integration
 * @see ./status-filter.ts — reuses status display config
 */

import { h } from "preact";
import { useCallback, useState, useRef, useEffect, useMemo } from "preact/hooks";
import type { ItemStatus } from "./types.js";

// ── Status display config (mirrors status-filter.ts) ─────────────────────

const STATUS_FACETS: { status: ItemStatus; label: string; icon: string; cssClass: string }[] = [
  { status: "pending",     label: "Pending",     icon: "\u25CB", cssClass: "prd-status-pending" },
  { status: "in_progress", label: "In Progress", icon: "\u25D0", cssClass: "prd-status-in-progress" },
  { status: "completed",   label: "Completed",   icon: "\u25CF", cssClass: "prd-status-completed" },
  { status: "failing",     label: "Failing",     icon: "\u26A0", cssClass: "prd-status-failing" },
  { status: "blocked",     label: "Blocked",     icon: "\u2298", cssClass: "prd-status-blocked" },
  { status: "deferred",    label: "Deferred",    icon: "\u25CC", cssClass: "prd-status-deferred" },
];

/** Max suggestions shown in the typeahead dropdown. */
const MAX_SUGGESTIONS = 20;

// ── Component ────────────────────────────────────────────────────────────────

export interface FacetFilterProps {
  /** All unique tags found in the PRD (sorted). */
  availableTags: string[];
  /** Currently selected tag facets. */
  activeTags: Set<string>;
  /** Currently selected status facets. */
  activeStatuses: Set<ItemStatus>;
  /** Called when the set of active tags changes. */
  onTagsChange: (tags: Set<string>) => void;
  /** Called when the set of active statuses changes. */
  onStatusesChange: (statuses: Set<ItemStatus>) => void;
  /** Called to clear all facets. */
  onClearAll: () => void;
}

export function FacetFilter({
  availableTags,
  activeTags,
  activeStatuses,
  onTagsChange,
  onStatusesChange,
  onClearAll,
}: FacetFilterProps) {
  const hasActiveFacets = activeTags.size > 0 || activeStatuses.size > 0;

  // ── Tag typeahead state ──────────────────────────────────────────────
  const [tagQuery, setTagQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filtered suggestions: exclude already-selected tags, match query
  const suggestions = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    const filtered = availableTags.filter(
      (tag) => !activeTags.has(tag) && (!q || tag.toLowerCase().includes(q)),
    );
    return filtered.slice(0, MAX_SUGGESTIONS);
  }, [availableTags, activeTags, tagQuery]);

  const totalMatches = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    return availableTags.filter(
      (tag) => !activeTags.has(tag) && (!q || tag.toLowerCase().includes(q)),
    ).length;
  }, [availableTags, activeTags, tagQuery]);

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightIdx(-1);
  }, [suggestions.length, tagQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectTag = useCallback(
    (tag: string) => {
      const next = new Set(activeTags);
      next.add(tag);
      onTagsChange(next);
      setTagQuery("");
      setDropdownOpen(false);
      inputRef.current?.focus();
    },
    [activeTags, onTagsChange],
  );

  const removeTag = useCallback(
    (tag: string) => {
      const next = new Set(activeTags);
      next.delete(tag);
      onTagsChange(next);
    },
    [activeTags, onTagsChange],
  );

  const toggleStatus = useCallback(
    (status: ItemStatus) => {
      const next = new Set(activeStatuses);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      onStatusesChange(next);
    },
    [activeStatuses, onStatusesChange],
  );

  const onInputKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && highlightIdx >= 0 && highlightIdx < suggestions.length) {
        e.preventDefault();
        selectTag(suggestions[highlightIdx]);
      } else if (e.key === "Escape") {
        setDropdownOpen(false);
        setTagQuery("");
      } else if (e.key === "Backspace" && tagQuery === "" && activeTags.size > 0) {
        // Remove last active tag on backspace in empty input
        const last = [...activeTags].pop();
        if (last) removeTag(last);
      }
    },
    [suggestions, highlightIdx, selectTag, tagQuery, activeTags, removeTag],
  );

  // Always render — we show status facets and tag typeahead

  return h(
    "div",
    { class: "prd-facet-filter", role: "group", "aria-label": "Search facets" },

    // ── Status facets ─────────────────────────────────────────────────
    h(
      "div",
      { class: "prd-facet-row" },
      h("span", { class: "prd-facet-label" }, "Status:"),
      h(
        "div",
        { class: "prd-facet-chips", role: "toolbar", "aria-label": "Status facets" },
        STATUS_FACETS.map((sf) => {
          const isActive = activeStatuses.has(sf.status);
          return h(
            "button",
            {
              key: sf.status,
              class: `prd-facet-chip prd-facet-status${isActive ? " active" : ""} ${sf.cssClass}`,
              onClick: () => toggleStatus(sf.status),
              title: `${isActive ? "Remove" : "Add"} ${sf.label.toLowerCase()} filter`,
              "aria-pressed": String(isActive),
              type: "button",
            },
            h("span", { class: "prd-facet-chip-icon" }, sf.icon),
            h("span", { class: "prd-facet-chip-label" }, sf.label),
          );
        }),
      ),
    ),

    // ── Tag facets (typeahead) ────────────────────────────────────────
    h(
      "div",
      { class: "prd-facet-row prd-facet-row--tags" },
      h("span", { class: "prd-facet-label" }, "Tags:"),
      availableTags.length > 0
        ? h(
            "div",
            { class: "prd-tag-typeahead", ref: containerRef },

            // Selected tag chips
            activeTags.size > 0
              ? h(
                  "div",
                  { class: "prd-facet-chips prd-tag-selected", role: "toolbar", "aria-label": "Active tag filters" },
                  [...activeTags].sort().map((tag) =>
                    h(
                      "button",
                      {
                        key: tag,
                        class: "prd-facet-chip prd-facet-tag active",
                        onClick: () => removeTag(tag),
                        title: `Remove "${tag}" tag filter`,
                        "aria-pressed": "true",
                        type: "button",
                      },
                      h("span", { class: "prd-facet-chip-icon" }, "#"),
                      h("span", { class: "prd-facet-chip-label" }, tag),
                      h("span", { class: "prd-tag-remove" }, "\u00d7"),
                    ),
                  ),
                )
              : null,

            // Search input
            h(
              "div",
              { class: "prd-tag-input-wrap" },
              h("input", {
                ref: inputRef,
                type: "text",
                class: "prd-tag-input",
                placeholder: `Search ${availableTags.length} tags\u2026`,
                value: tagQuery,
                onInput: (e: Event) => {
                  setTagQuery((e.target as HTMLInputElement).value);
                  setDropdownOpen(true);
                },
                onFocus: () => setDropdownOpen(true),
                onKeyDown: onInputKeyDown,
                "aria-label": "Search tags",
                "aria-expanded": String(dropdownOpen && suggestions.length > 0),
                "aria-autocomplete": "list",
                autocomplete: "off",
              }),

              // Dropdown suggestions
              dropdownOpen && tagQuery.trim().length > 0 && suggestions.length > 0
                ? h(
                    "ul",
                    { class: "prd-tag-dropdown", role: "listbox" },
                    suggestions.map((tag, idx) =>
                      h(
                        "li",
                        {
                          key: tag,
                          class: `prd-tag-option${idx === highlightIdx ? " highlighted" : ""}`,
                          role: "option",
                          "aria-selected": String(idx === highlightIdx),
                          onMouseDown: (e: MouseEvent) => {
                            e.preventDefault(); // prevent blur
                            selectTag(tag);
                          },
                          onMouseEnter: () => setHighlightIdx(idx),
                        },
                        h("span", { class: "prd-tag-option-hash" }, "#"),
                        tag,
                      ),
                    ),
                    totalMatches > MAX_SUGGESTIONS
                      ? h("li", { class: "prd-tag-option prd-tag-more" },
                          `+${totalMatches - MAX_SUGGESTIONS} more\u2026 refine your search`)
                      : null,
                  )
                : dropdownOpen && tagQuery.trim().length > 0 && suggestions.length === 0
                  ? h(
                      "ul",
                      { class: "prd-tag-dropdown", role: "listbox" },
                      h("li", { class: "prd-tag-option prd-tag-no-match" }, "No matching tags"),
                    )
                  : null,
            ),
          )
        : h("span", { class: "prd-facet-empty" }, "No tags in current PRD"),
    ),

    // ── Clear all facets button ──────────────────────────────────────
    hasActiveFacets
      ? h(
          "button",
          {
            class: "prd-facet-clear",
            onClick: onClearAll,
            title: "Clear all facet filters",
            type: "button",
          },
          "\u00d7 Clear facets",
        )
      : null,
  );
}
