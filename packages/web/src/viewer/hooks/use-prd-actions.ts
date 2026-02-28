/**
 * PRD CRUD action hooks — item update, add, delete, merge, and prune.
 *
 * Encapsulates all mutation handlers extracted from PRDView. Each
 * handler follows the optimistic update pattern:
 *
 * 1. Apply the change locally for instant UI feedback
 * 2. Send the request to the server
 * 3. Reconcile with authoritative server state
 * 4. On failure, revert by re-fetching from server
 *
 * @see ../components/prd-tree/tree-differ.ts — applyItemUpdate (structural sharing)
 * @see ../components/prd-tree/tree-utils.ts — removeItemById, collectSubtreeIds, findItemById
 */

import { useState, useCallback, useMemo } from "preact/hooks";
import type { VNode } from "preact";
import { h } from "preact";
import type { PRDDocumentData, PRDItemData } from "../components/prd-tree/types.js";
import type { TaskUsageSummary, WeeklyBudgetResolution } from "../components/prd-tree/types.js";
import type { AddItemInput } from "../components/prd-tree/add-item-form.js";
import type { InlineAddInput } from "../components/prd-tree/inline-add-form.js";
import type { DetailItem, NavigateTo } from "../types.js";
import { TaskDetail } from "../components/prd-tree/task-detail.js";
import { findItemById, collectSubtreeIds, removeItemById } from "../components/prd-tree/tree-utils.js";
import { applyItemUpdate } from "../components/prd-tree/tree-differ.js";

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
  /** Toggle bulk selection checkbox for an item. */
  handleToggleBulkSelect: (item: PRDItemData) => void;
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
}: PRDActionsDeps): PRDActionsState {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CommandTab>(null);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<PRDItemData | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  // Resolve selected items for merge preview
  const selectedItems = useMemo(() => {
    if (!data || bulkSelectedIds.size === 0) return [];
    const items: PRDItemData[] = [];
    for (const id of bulkSelectedIds) {
      const item = findItemById(data.items, id);
      if (item) items.push(item);
    }
    return items;
  }, [data, bulkSelectedIds]);

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

  // ── Item selection ───────────────────────────────────────────────

  const handleSelectItem = useCallback(
    (item: PRDItemData) => {
      setSelectedItemId(item.id);
      history.replaceState(
        { view: "prd", file: null, zone: null, runId: null, taskId: item.id },
        "",
        `/prd/${item.id}`,
      );
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
    },
    [onSelectItem],
  );

  // ── Bulk selection ───────────────────────────────────────────────

  const handleToggleBulkSelect = useCallback(
    (item: PRDItemData) => {
      setBulkSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
    },
    [],
  );

  const clearBulkSelection = useCallback(() => {
    setBulkSelectedIds(new Set());
  }, []);

  // ── Navigation ───────────────────────────────────────────────────

  const handleNavigateToItem = useCallback(
    (id: string) => {
      if (!data) return;
      const item = findItemById(data.items, id);
      if (item) handleSelectItem(item);
    },
    [data, handleSelectItem],
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

  // ── Remove item (optimistic delete) ──────────────────────────────

  const handleRemoveItem = useCallback(
    async (id: string) => {
      const targetItem = data ? findItemById(data.items, id) : null;
      const affectedIds = targetItem ? collectSubtreeIds(targetItem) : new Set([id]);

      setDeletingItemId(id);

      // Optimistic removal
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, items: removeItemById(prev.items, id) };
      });

      // Clean up bulk selection for deleted items
      setBulkSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        let changed = false;
        const next = new Set(prev);
        for (const affectedId of affectedIds) {
          if (next.has(affectedId)) {
            next.delete(affectedId);
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      // Deselect if the selected item is being deleted
      if (selectedItemId && affectedIds.has(selectedItemId)) {
        setSelectedItemId(null);
        if (onDetailContent) onDetailContent(null);
        history.replaceState(
          { view: "prd", file: null, zone: null, runId: null, taskId: null },
          "",
          "/prd",
        );
      }

      try {
        const res = await fetch(`/api/rex/items/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: "Delete failed" }));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }
        const result = await res.json();
        showToast(`Deleted ${result.level}: ${result.title}`);
        await fetchPRDData();
        await fetchTaskUsage();
      } catch (err) {
        await fetchPRDData();
        throw err;
      } finally {
        setDeletingItemId(null);
      }
    },
    [data, selectedItemId, onDetailContent, setData, fetchPRDData, fetchTaskUsage, showToast],
  );

  // ── Remove from tree (opens modal) ───────────────────────────────

  const handleRemoveItemFromTree = useCallback(
    (item: PRDItemData) => {
      setDeleteTarget(item);
    },
    [],
  );

  // ── Confirm delete (modal callback) ──────────────────────────────

  const handleConfirmDelete = useCallback(
    async (id: string) => {
      try {
        await handleRemoveItem(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delete failed";
        showToast(`Failed to delete item: ${msg}`, "error", 4000);
      }
      setDeleteTarget(null);
    },
    [handleRemoveItem, showToast],
  );

  // ── Remove from detail panel ─────────────────────────────────────

  const handleRemoveFromDetail = useCallback(
    async (id: string) => {
      try {
        await handleRemoveItem(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delete failed";
        showToast(`Failed to delete item: ${msg}`, "error", 4000);
        throw err; // Re-throw so TaskDetail can reset its confirming state
      }
    },
    [handleRemoveItem, showToast],
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
  }, [fetchPRDData, fetchTaskUsage, showToast]);

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

    onDetailContent(
      h(TaskDetail, {
        item,
        taskUsage: taskUsageById[item.id],
        weeklyBudget,
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
      }),
    );
  }, [
    data,
    selectedItemId,
    taskUsageById,
    weeklyBudget,
    onDetailContent,
    handleItemUpdate,
    handleNavigateToItem,
    handleExecuteTask,
    fetchPRDData,
    fetchTaskUsage,
    handleAddChild,
    handleRemoveFromDetail,
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
    handleToggleBulkSelect,
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
