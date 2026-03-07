/**
 * PRD CRUD action hooks — item update, add, delete, merge, and prune.
 *
 * Composes focused sub-hooks for selection and deletion, adding
 * mutation handlers (update, add, execute) and detail panel sync.
 *
 * Each handler follows the optimistic update pattern:
 *
 * 1. Apply the change locally for instant UI feedback
 * 2. Send the request to the server
 * 3. Reconcile with authoritative server state
 * 4. On failure, revert by re-fetching from server
 *
 * @see ./use-item-selection.ts — selection, bulk select, navigation
 * @see ./use-delete-actions.ts — optimistic delete, modal, detail panel remove
 * @see ../components/prd-tree/tree-differ.ts — applyItemUpdate (structural sharing)
 */

import { useState, useCallback } from "preact/hooks";
import type { VNode } from "preact";
import { h } from "preact";
import type { PRDDocumentData, PRDItemData } from "../components/prd-tree/types.js";
import type { TaskUsageSummary, WeeklyBudgetResolution } from "../components/prd-tree/types.js";
import type { AddItemInput } from "../components/prd-tree/add-item-form.js";
import type { InlineAddInput } from "../components/prd-tree/inline-add-form.js";
import type { DetailItem, NavigateTo } from "../types.js";
import { TaskDetail } from "../components/prd-tree/task-detail.js";
import { findItemById } from "../components/prd-tree/tree-utils.js";
import { applyItemUpdate } from "../components/prd-tree/tree-differ.js";
import { useItemSelection } from "./use-item-selection.js";
import { useDeleteActions } from "./use-delete-actions.js";

/** Active tab in the command bar. */
export type CommandTab = null | "add" | "merge" | "prune";

export interface PRDActionsDeps {
  /** Current PRD document data. */
  data: PRDDocumentData | null;
  /** Setter for optimistic local state updates. */
  setData: (updater: PRDDocumentData | null | ((prev: PRDDocumentData | null) => PRDDocumentData | null)) => void;
  /** Fetch/reconcile PRD data from server. */
  fetchPRDData: () => Promise<void>;
  /** Fetch/reconcile task usage data from server. */
  fetchTaskUsage: () => Promise<void>;
  /** Show a toast notification. */
  showToast: (message: string, type?: "success" | "error", duration?: number) => void;
  /** External callback for item selection (parent layout). */
  onSelectItem?: (detail: DetailItem | null) => void;
  /** External callback for detail panel content (parent layout). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDetailContent?: (content: VNode<any> | null) => void;
  /** Per-task usage summaries. */
  taskUsageById: Record<string, TaskUsageSummary>;
  /** Resolved weekly budget. */
  weeklyBudget: WeeklyBudgetResolution | null;
  /** Whether to show token budget UI (budget bar, percentage, limit label). */
  showTokenBudget?: boolean;
  /** Navigation callback for deep-linking to other views (e.g. hench-runs). */
  navigateTo?: NavigateTo;
}

export interface PRDActionsState {
  /** Currently selected item ID. */
  selectedItemId: string | null;
  /** Active command bar tab. */
  activeTab: CommandTab;
  /** Set the active command bar tab. */
  setActiveTab: (tab: CommandTab) => void;
  /** Parent ID for the add-item form. */
  addParentId: string | null;
  /** Set the parent ID for the add-item form. */
  setAddParentId: (id: string | null) => void;
  /** Set of item IDs selected for bulk operations. */
  bulkSelectedIds: Set<string>;
  /** Items resolved from bulk selection (for merge preview). */
  selectedItems: PRDItemData[];
  /** Item pending delete confirmation. */
  deleteTarget: PRDItemData | null;
  /** Set the item pending delete confirmation. */
  setDeleteTarget: (item: PRDItemData | null) => void;
  /** ID of item currently being deleted (loading state). */
  deletingItemId: string | null;

  // ── Handlers ─────────────────────────────────────────────────────

  /** Update an item's fields (optimistic + server reconciliation). */
  handleItemUpdate: (id: string, updates: Partial<PRDItemData>) => Promise<void>;
  /** Select an item (opens detail panel). */
  handleSelectItem: (item: PRDItemData) => void;
  /**
   * Multi-select handler for bulk operations.
   * Ctrl/Cmd+click toggles individual items, Shift+click selects a
   * contiguous range from the anchor, plain click selects only that item.
   * `visibleIds` provides the flat ordering of currently visible nodes
   * (needed for shift-range computation).
   */
  handleBulkSelect: (item: PRDItemData, modifiers: { ctrlKey: boolean; shiftKey: boolean }, visibleIds: string[]) => void;
  /** Clear all bulk-selected items. */
  clearBulkSelection: () => void;
  /** Navigate to an item by ID (from detail panel links). */
  handleNavigateToItem: (id: string) => void;
  /** Add a child item from the detail panel. */
  handleAddChild: (input: { title: string; parentId: string; level: string; description?: string; priority?: string }) => Promise<void>;
  /** Start a hench execution for a task. */
  handleExecuteTask: (taskId: string) => Promise<void>;
  /** Add an item from the command bar form. */
  handleAddItem: (input: AddItemInput) => Promise<void>;
  /** Add an item from the inline tree form. */
  handleInlineAddItem: (input: InlineAddInput) => Promise<void>;
  /** Remove an item from the tree node (opens modal). */
  handleRemoveItemFromTree: (item: PRDItemData) => void;
  /** Confirm deletion from the modal dialog. */
  handleConfirmDelete: (id: string) => Promise<void>;
  /** Remove an item from the detail panel. */
  handleRemoveFromDetail: (id: string) => Promise<void>;
  /** Called when merge completes successfully. */
  handleMergeComplete: () => void;
  /** Called when prune completes successfully. */
  handlePruneComplete: () => void;
  /** Open the merge preview panel. */
  handleOpenMerge: () => void;
  /** Synchronize the detail panel content with current state. */
  syncDetailContent: () => void;
}

/**
 * Hook providing all PRD CRUD action handlers and related UI state.
 *
 * Composes {@link useItemSelection} for selection/navigation and
 * {@link useDeleteActions} for optimistic deletion, then adds
 * mutation handlers and detail panel synchronization.
 */
export function usePRDActions({
  data,
  setData,
  fetchPRDData,
  fetchTaskUsage,
  showToast,
  onSelectItem,
  onDetailContent,
  taskUsageById,
  weeklyBudget,
  showTokenBudget,
  navigateTo,
}: PRDActionsDeps): PRDActionsState {
  const [activeTab, setActiveTab] = useState<CommandTab>(null);
  const [addParentId, setAddParentId] = useState<string | null>(null);

  // ── Selection (delegated to sub-hook) ─────────────────────────────

  const {
    selectedItemId,
    setSelectedItemId,
    bulkSelectedIds,
    setBulkSelectedIds,
    selectedItems,
    handleSelectItem,
    handleBulkSelect,
    clearBulkSelection,
    handleNavigateToItem,
  } = useItemSelection({ data, onSelectItem });

  // ── Deletion (delegated to sub-hook) ──────────────────────────────

  const {
    deleteTarget,
    setDeleteTarget,
    deletingItemId,
    handleRemoveItemFromTree,
    handleConfirmDelete,
    handleRemoveFromDetail,
  } = useDeleteActions({
    data,
    setData,
    fetchPRDData,
    fetchTaskUsage,
    showToast,
    selectedItemId,
    setSelectedItemId,
    setBulkSelectedIds,
    onDetailContent,
  });

  // ── Item update (optimistic + reconcile) ─────────────────────────

  const handleItemUpdate = useCallback(
    async (id: string, updates: Partial<PRDItemData>) => {
      setData((prev) => {
        if (!prev) return prev;
        const newItems = applyItemUpdate(prev.items, id, updates);
        return newItems === prev.items ? prev : { ...prev, items: newItems };
      });

      try {
        const res = await fetch(`/api/rex/items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          console.error("Failed to update item:", await res.text());
          await fetchPRDData();
          return;
        }
        await fetchPRDData();
        await fetchTaskUsage();
      } catch (err) {
        console.error("Failed to update item:", err);
        await fetchPRDData();
      }
    },
    [setData, fetchPRDData, fetchTaskUsage],
  );

  // ── Add child (from detail panel) ────────────────────────────────

  const handleAddChild = useCallback(
    async (input: { title: string; parentId: string; level: string; description?: string; priority?: string }) => {
      const res = await fetch("/api/rex/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Failed to add item" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      showToast(`Created ${result.level}: ${result.title}`);
      await fetchPRDData();
      await fetchTaskUsage();
    },
    [fetchPRDData, fetchTaskUsage, showToast],
  );

  // ── Execute task ─────────────────────────────────────────────────

  const handleExecuteTask = useCallback(
    async (taskId: string) => {
      const res = await fetch("/api/hench/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      showToast(`Hench execution started for task`);
    },
    [showToast],
  );

  // ── Add item (command bar form) ──────────────────────────────────

  const handleAddItem = useCallback(
    async (input: AddItemInput) => {
      const res = await fetch("/api/rex/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Failed to add item" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      showToast(`Created ${result.level}: ${result.title}`);
      setActiveTab(null);
      setAddParentId(null);
      await fetchPRDData();
      await fetchTaskUsage();
    },
    [fetchPRDData, fetchTaskUsage, showToast],
  );

  // ── Inline add item (tree node form) ─────────────────────────────

  const handleInlineAddItem = useCallback(
    async (input: InlineAddInput) => {
      const res = await fetch("/api/rex/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Failed to add item" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      showToast(`Created ${result.level}: ${result.title}`);
      await fetchPRDData();
      await fetchTaskUsage();
    },
    [fetchPRDData, fetchTaskUsage, showToast],
  );

  // ── Merge/prune completion ───────────────────────────────────────

  const handleMergeComplete = useCallback(() => {
    setActiveTab(null);
    setBulkSelectedIds(new Set());
    showToast("Items merged successfully");
    fetchPRDData();
    fetchTaskUsage();
  }, [setBulkSelectedIds, fetchPRDData, fetchTaskUsage, showToast]);

  const handlePruneComplete = useCallback(() => {
    setActiveTab(null);
    showToast("Completed items pruned and archived");
    fetchPRDData();
    fetchTaskUsage();
  }, [fetchPRDData, fetchTaskUsage, showToast]);

  const handleOpenMerge = useCallback(() => {
    setActiveTab("merge");
  }, []);

  // ── Detail panel sync ────────────────────────────────────────────
  // This is called as a side effect to keep the detail panel in sync
  // with the current selection and data state.

  const syncDetailContent = useCallback(() => {
    if (!data || !selectedItemId || !onDetailContent) {
      if (onDetailContent) onDetailContent(null);
      return;
    }

    const item = findItemById(data.items, selectedItemId);
    if (!item) {
      onDetailContent(null);
      return;
    }

    // Keep the detail header in sync with the current item title
    if (onSelectItem) {
      onSelectItem({
        type: "prd",
        title: item.title,
        id: item.id,
        level: item.level,
        status: item.status,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria,
        priority: item.priority,
        tags: item.tags,
        blockedBy: item.blockedBy,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
      });
    }

    onDetailContent(
      h(TaskDetail, {
        item,
        taskUsage: taskUsageById[item.id],
        weeklyBudget,
        showTokenBudget: showTokenBudget ?? false,
        allItems: data.items,
        onUpdate: handleItemUpdate,
        onNavigateToItem: handleNavigateToItem,
        onExecuteTask: handleExecuteTask,
        onPrdChanged: () => {
          fetchPRDData();
          fetchTaskUsage();
        },
        onAddChild: handleAddChild,
        onRemove: handleRemoveFromDetail,
        navigateTo,
      }),
    );
  }, [
    data,
    selectedItemId,
    taskUsageById,
    weeklyBudget,
    showTokenBudget,
    onSelectItem,
    onDetailContent,
    handleItemUpdate,
    handleNavigateToItem,
    handleExecuteTask,
    fetchPRDData,
    fetchTaskUsage,
    handleAddChild,
    handleRemoveFromDetail,
    navigateTo,
  ]);

  return {
    selectedItemId,
    activeTab,
    setActiveTab,
    addParentId,
    setAddParentId,
    bulkSelectedIds,
    selectedItems,
    deleteTarget,
    setDeleteTarget,
    deletingItemId,
    handleItemUpdate,
    handleSelectItem,
    handleBulkSelect,
    clearBulkSelection,
    handleNavigateToItem,
    handleAddChild,
    handleExecuteTask,
    handleAddItem,
    handleInlineAddItem,
    handleRemoveItemFromTree,
    handleConfirmDelete,
    handleRemoveFromDetail,
    handleMergeComplete,
    handlePruneComplete,
    handleOpenMerge,
    syncDetailContent,
  };
}
