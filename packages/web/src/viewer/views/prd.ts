/**
 * PRD view — displays Rex PRD hierarchy with interactive tree.
 *
 * Loads PRD data from /data/prd.json (served by the unified web server)
 * or accepts it via props. Manages task selection, detail panel content,
 * add item form, bulk actions, and merge preview.
 *
 * This component is a thin render shell that composes focused hooks
 * for data fetching, WebSocket updates, CRUD actions, and deep-linking.
 *
 * @see ../hooks/use-prd-data.ts — data fetching, polling, dedup
 * @see ../hooks/use-prd-websocket.ts — WebSocket message pipeline
 * @see ../hooks/use-prd-actions.ts — CRUD mutation handlers
 * @see ../hooks/use-prd-deep-link.ts — deep-link resolution
 * @see ../hooks/use-toast.ts — toast notification state
 */

import { h, Fragment } from "preact";
import type { VNode } from "preact";
import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks";
import { PRDTree, ALL_STATUSES } from "../components/prd-tree/index.js";
import { AddItemForm } from "../components/prd-tree/add-item-form.js";
import { BulkActions } from "../components/prd-tree/bulk-actions.js";
import { MergePreview } from "../components/prd-tree/merge-preview.js";
import { PruneConfirmation } from "../components/prd-tree/prune-confirmation.js";
import { DeleteConfirmation } from "../components/prd-tree/delete-confirmation.js";
import { BrandedHeader } from "../components/logos.js";
import { CompletionTimeline } from "../components/prd-tree/completion-timeline.js";
import type { PRDDocumentData } from "../components/prd-tree/index.js";
import type { DetailItem, NavigateTo } from "../types.js";
import {
  useToast,
  usePRDData,
  usePRDWebSocket,
  usePRDActions,
  usePRDDeepLink,
  usePersistentFilter,
  useFeatureToggle,
  useFacetState,
} from "../hooks/index.js";
import { searchTree, collectAllTags } from "../components/prd-tree/tree-search.js";
import { FacetFilter } from "../components/prd-tree/facet-filter.js";

export interface PRDViewProps {
  /** Pre-loaded PRD data. If not provided, fetches from /data/prd.json. */
  prdData?: PRDDocumentData | null;
  /** Called when a PRD item is selected, to open the detail panel. */
  onSelectItem?: (detail: DetailItem | null) => void;
  /** Called with rendered TaskDetail content for the detail panel. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDetailContent?: (content: VNode<any> | null) => void;
  /** When set, auto-select this task on mount (from deep-link URL). */
  initialTaskId?: string | null;
  /** Navigation callback for URL updates. */
  navigateTo?: NavigateTo;
}

export function PRDView({ prdData, onSelectItem, onDetailContent, initialTaskId, navigateTo }: PRDViewProps) {
  // ── Toast notifications ────────────────────────────────────────
  const { toast, toastType, showToast } = useToast();

  // ── Data fetching & polling ────────────────────────────────────
  const {
    data, setData, loading, error, setError,
    taskUsageById, weeklyBudget,
    fetchPRDData, fetchTaskUsage,
  } = usePRDData(prdData);

  // ── Feature toggles ────────────────────────────────────────────
  const showTokenBudget = useFeatureToggle("rex.showTokenBudget", false);

  // ── WebSocket real-time updates ────────────────────────────────
  usePRDWebSocket({ setData, fetchPRDData, fetchTaskUsage });

  // ── CRUD actions & UI state ────────────────────────────────────
  const actions = usePRDActions({
    data, setData,
    fetchPRDData, fetchTaskUsage,
    showToast,
    onSelectItem, onDetailContent,
    taskUsageById, weeklyBudget,
    showTokenBudget,
    navigateTo,
  });

  // ── Status filter (persists across view switches) ────────────
  const { activeStatuses, setActiveStatuses } = usePersistentFilter();

  // ── Smart expand depth: collapsed when no active work ────────
  const hasActiveWork = useMemo(() => {
    if (!data) return false;
    function check(items: any[]): boolean {
      for (const item of items) {
        if (item.status === "pending" || item.status === "in_progress" || item.status === "blocked") return true;
        if (item.children && check(item.children)) return true;
      }
      return false;
    }
    return check(data.items);
  }, [data]);

  // ── Inline tree search ──────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Facet filters (tags + status, URL-persisted) ──────────────
  const {
    activeTags, activeSearchStatuses, searchFacets,
    setActiveTags, setActiveSearchStatuses,
    clearFacets, hasFacets,
  } = useFacetState();

  // Collect all unique tags from the PRD for facet chip rendering
  const availableTags = useMemo(
    () => data ? collectAllTags(data.items) : [],
    [data],
  );

  // Prune stale active tags that no longer exist in the PRD
  useEffect(() => {
    if (activeTags.size === 0) return;
    const tagSet = new Set(availableTags);
    const pruned = new Set<string>();
    for (const tag of activeTags) {
      if (tagSet.has(tag)) pruned.add(tag);
    }
    if (pruned.size !== activeTags.size) {
      setActiveTags(pruned);
    }
  }, [availableTags, activeTags, setActiveTags]);

  const searchResult = useMemo(
    () => data ? searchTree(data.items, searchQuery, searchFacets) : null,
    [data, searchQuery, searchFacets],
  );

  // Keyboard shortcut: Ctrl+F / Cmd+F to focus the search input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        // Only intercept when the PRD view is rendered (data exists)
        if (!data) return;
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [data]);

  // Clear search and facets on Escape when input is focused
  const handleSearchKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setSearchQuery("");
      clearFacets();
      (e.target as HTMLInputElement).blur();
    }
  }, [clearFacets]);

  // ── Deep-link resolution ───────────────────────────────────────
  const { deepLinkError, setDeepLinkError, highlightedTaskId, deepLinkExpandIds } =
    usePRDDeepLink({
      initialTaskId, loading, data,
      onSelectItem: actions.handleSelectItem,
    });

  // ── Detail panel sync ──────────────────────────────────────────
  // Keep the detail panel content in sync when selection or data changes.
  useEffect(() => {
    actions.syncDetailContent();
  }, [actions.syncDetailContent]);

  // ── Click-outside to clear bulk selection ─────────────────────
  // Clicks outside the `.prd-tree` container and the `.rex-bulk-bar`
  // deselect all items.
  useEffect(() => {
    if (actions.bulkSelectedIds.size === 0) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(".prd-tree") ||
        target.closest(".rex-bulk-bar") ||
        target.closest(".merge-preview")
      ) {
        return;
      }
      actions.clearBulkSelection();
    };

    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [actions.bulkSelectedIds.size, actions.clearBulkSelection]);

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return h("div", { class: "loading" }, "Loading PRD...");
  }

  if (error) {
    return h("div", { class: "prd-empty" },
      h("p", null, error),
    );
  }

  if (!data) {
    return h("div", { class: "prd-empty" },
      h("p", null, "No PRD data available."),
    );
  }

  return h(
    Fragment,
    null,

    // Branded header
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "section-header" }, "Tasks"),
    ),

    // Deep-link error banner
    deepLinkError
      ? h("div", { class: "prd-deep-link-error", role: "alert" },
          h("span", null, deepLinkError),
          h("button", {
            class: "prd-deep-link-error-dismiss",
            onClick: () => setDeepLinkError(null),
            "aria-label": "Dismiss",
          }, "\u00d7"),
        )
      : null,

    // Active panel
    actions.activeTab === "add"
      ? h(AddItemForm, {
          allItems: data.items,
          onSubmit: actions.handleAddItem,
          onCancel: () => { actions.setActiveTab(null); actions.setAddParentId(null); },
          defaultParentId: actions.addParentId,
        })
      : null,

    // Merge preview panel
    actions.activeTab === "merge" && actions.selectedItems.length >= 2
      ? h(MergePreview, {
          selectedItems: actions.selectedItems,
          onMergeComplete: actions.handleMergeComplete,
          onCancel: () => actions.setActiveTab(null),
        })
      : null,

    // Prune confirmation panel
    actions.activeTab === "prune"
      ? h(PruneConfirmation, {
          onPruneComplete: actions.handlePruneComplete,
          onCancel: () => actions.setActiveTab(null),
        })
      : null,

    // Sticky filter bar — search input + status filter
    h("div", { class: "prd-filter-bar" },
      h("div", { class: "prd-search-row" },
        h("input", {
          ref: searchInputRef,
          class: "prd-search-input",
          type: "search",
          placeholder: "Search tasks\u2026 (Ctrl+F)",
          value: searchQuery,
          "aria-label": "Search PRD tree",
          onInput: (e: Event) => setSearchQuery((e.target as HTMLInputElement).value),
          onKeyDown: handleSearchKeyDown,
        }),
        (searchQuery || hasFacets) && searchResult
          ? h("span", { class: "prd-search-count", "aria-live": "polite" },
              `${searchResult.matchCount} match${searchResult.matchCount !== 1 ? "es" : ""}`,
            )
          : null,
        searchQuery || hasFacets
          ? h("button", {
              class: "prd-search-clear",
              onClick: () => { setSearchQuery(""); clearFacets(); searchInputRef.current?.focus(); },
              "aria-label": "Clear search and facets",
              title: "Clear search and facets",
            }, "\u00d7")
          : null,
        // Command actions inline
        h("button", {
          class: `prd-search-action${actions.activeTab === "add" ? " active" : ""}`,
          onClick: () => { actions.setActiveTab(actions.activeTab === "add" ? null : "add"); actions.setAddParentId(null); },
          title: "Add item",
          "aria-label": "Add a new item to the PRD",
        }, "+"),
        h("button", {
          class: `prd-search-action${actions.activeTab === "prune" ? " active" : ""}`,
          onClick: () => { actions.setActiveTab(actions.activeTab === "prune" ? null : "prune"); },
          title: "Prune completed",
          "aria-label": "Remove completed subtrees",
        }, "\u2702"),
      ),
      // Facet filter chips (tags for search, statuses for tree visibility)
      h(FacetFilter, {
        availableTags,
        activeTags,
        activeStatuses,
        onTagsChange: setActiveTags,
        onStatusesChange: setActiveStatuses,
        onClearAll: () => { clearFacets(); setActiveStatuses(new Set(ALL_STATUSES)); },
      }),
    ),

    // PRD tree (key forces remount when expand strategy changes)
    h(PRDTree, {
      key: `prd-${hasActiveWork ? "active" : "done"}`,
      document: data,
      taskUsageById,
      weeklyBudget,
      showTokenBudget,
      defaultExpandDepth: hasActiveWork ? 2 : 0,
      onSelectItem: actions.handleSelectItem,
      selectedItemId: actions.selectedItemId,
      bulkSelectedIds: actions.bulkSelectedIds,
      onBulkSelect: actions.handleBulkSelect,
      onInlineAddSubmit: actions.handleInlineAddItem,
      highlightedItemId: highlightedTaskId,
      deepLinkExpandIds,
      onRemoveItem: actions.handleRemoveItemFromTree,
      onUpdateItem: actions.handleItemUpdate,
      deletingItemId: actions.deletingItemId,
      activeStatuses,
      searchQuery: searchQuery || undefined,
      searchVisibleIds: searchResult?.visibleIds,
      searchMatchIds: searchResult?.matchIds,
    }),

    // Bulk actions bar (floating at bottom)
    h(BulkActions, {
      selectedIds: actions.bulkSelectedIds,
      onClearSelection: () => { actions.clearBulkSelection(); actions.setActiveTab(null); },
      onActionComplete: fetchPRDData,
      onMerge: actions.handleOpenMerge,
    }),

    // Completion timeline
    h(CompletionTimeline, { items: data.items }),

    // Toast notification (success = green, error = red)
    toast
      ? h("div", {
          class: `rex-toast${toastType === "error" ? " rex-toast-error" : ""}`,
          role: toastType === "error" ? "alert" : "status",
          "aria-live": toastType === "error" ? "assertive" : "polite",
        }, toast)
      : null,

    // Delete confirmation modal
    actions.deleteTarget
      ? h(DeleteConfirmation, {
          item: actions.deleteTarget,
          onConfirm: actions.handleConfirmDelete,
          onCancel: () => actions.setDeleteTarget(null),
        })
      : null,
  );
}
