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
import { useEffect } from "preact/hooks";
import { PRDTree, StatusFilter } from "../components/prd-tree/index.js";
import { AddItemForm } from "../components/prd-tree/add-item-form.js";
import { BulkActions } from "../components/prd-tree/bulk-actions.js";
import { MergePreview } from "../components/prd-tree/merge-preview.js";
import { PruneConfirmation } from "../components/prd-tree/prune-confirmation.js";
import { DeleteConfirmation } from "../components/prd-tree/delete-confirmation.js";
import { BrandedHeader } from "../components/logos.js";
import type { PRDDocumentData } from "../components/prd-tree/index.js";
import type { DetailItem, NavigateTo } from "../types.js";
import { useToast } from "../hooks/use-toast.js";
import { usePRDData } from "../hooks/use-prd-data.js";
import { usePRDWebSocket } from "../hooks/use-prd-websocket.js";
import { usePRDActions } from "../hooks/use-prd-actions.js";
import { usePRDDeepLink } from "../hooks/use-prd-deep-link.js";
import { usePersistentFilter } from "../hooks/use-persistent-filter.js";

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

  // ── WebSocket real-time updates ────────────────────────────────
  usePRDWebSocket({ setData, fetchPRDData, fetchTaskUsage });

  // ── CRUD actions & UI state ────────────────────────────────────
  const actions = usePRDActions({
    data, setData,
    fetchPRDData, fetchTaskUsage,
    showToast,
    onSelectItem, onDetailContent,
    taskUsageById, weeklyBudget,
  });

  // ── Status filter (persists across view switches) ────────────
  const { activeStatuses, setActiveStatuses } = usePersistentFilter();

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

    // Command bar — action buttons
    h("div", { class: "rex-command-bar" },
      h("button", {
        class: `rex-command-btn${actions.activeTab === "add" ? " active" : ""}`,
        onClick: () => {
          actions.setActiveTab(actions.activeTab === "add" ? null : "add");
          actions.setAddParentId(null);
        },
        title: "Add a new item to the PRD",
      }, "+ Add Item"),
      h("button", {
        class: `rex-command-btn${actions.activeTab === "prune" ? " active" : ""}`,
        onClick: () => {
          actions.setActiveTab(actions.activeTab === "prune" ? null : "prune");
        },
        title: "Remove completed subtrees from the PRD",
      }, "\u2702 Prune"),
    ),

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

    // Sticky filter bar — consolidated above the tree
    h("div", { class: "prd-filter-bar" },
      h(StatusFilter, { activeStatuses, onChange: setActiveStatuses }),
    ),

    // PRD tree
    h(PRDTree, {
      document: data,
      taskUsageById,
      weeklyBudget,
      defaultExpandDepth: 2,
      onSelectItem: actions.handleSelectItem,
      selectedItemId: actions.selectedItemId,
      bulkSelectedIds: actions.bulkSelectedIds,
      onToggleBulkSelect: actions.handleToggleBulkSelect,
      onInlineAddSubmit: actions.handleInlineAddItem,
      highlightedItemId: highlightedTaskId,
      deepLinkExpandIds,
      onRemoveItem: actions.handleRemoveItemFromTree,
      onUpdateItem: actions.handleItemUpdate,
      deletingItemId: actions.deletingItemId,
      activeStatuses,
    }),

    // Bulk actions bar (floating at bottom)
    h(BulkActions, {
      selectedIds: actions.bulkSelectedIds,
      onClearSelection: () => { actions.clearBulkSelection(); actions.setActiveTab(null); },
      onActionComplete: fetchPRDData,
      onMerge: actions.handleOpenMerge,
    }),

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
