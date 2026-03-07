/**
 * Delete action hooks — optimistic removal, modal confirmation, and detail panel deletion.
 *
 * Extracted from usePRDActions to isolate delete state management and
 * the optimistic-delete-then-reconcile pattern from other mutations.
 *
 * @see ./use-prd-actions.ts — parent hook that composes this
 */

import { useState, useCallback } from "preact/hooks";
import type { VNode } from "preact";
import type { PRDDocumentData, PRDItemData } from "../components/prd-tree/types.js";
import { findItemById, collectSubtreeIds, removeItemById } from "../components/prd-tree/tree-utils.js";

export interface DeleteActionsDeps {
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
  /** Currently selected item ID (to clear on delete). */
  selectedItemId: string | null;
  /** Set the selected item ID (to clear on delete). */
  setSelectedItemId: (id: string | null) => void;
  /** Setter for bulk selection (to clear deleted items). */
  setBulkSelectedIds: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  /** External callback for detail panel content (to clear on delete). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDetailContent?: (content: VNode<any> | null) => void;
}

export interface DeleteActionsState {
  /** Item pending delete confirmation. */
  deleteTarget: PRDItemData | null;
  /** Set the item pending delete confirmation. */
  setDeleteTarget: (item: PRDItemData | null) => void;
  /** ID of item currently being deleted (loading state). */
  deletingItemId: string | null;
  /** Remove an item from the tree node (opens modal). */
  handleRemoveItemFromTree: (item: PRDItemData) => void;
  /** Confirm deletion from the modal dialog. */
  handleConfirmDelete: (id: string) => Promise<void>;
  /** Remove an item from the detail panel. */
  handleRemoveFromDetail: (id: string) => Promise<void>;
}

/**
 * Hook for delete actions — optimistic removal, modal confirmation, and detail panel deletion.
 */
export function useDeleteActions({
  data,
  setData,
  fetchPRDData,
  fetchTaskUsage,
  showToast,
  selectedItemId,
  setSelectedItemId,
  setBulkSelectedIds,
  onDetailContent,
}: DeleteActionsDeps): DeleteActionsState {
  const [deleteTarget, setDeleteTarget] = useState<PRDItemData | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  // ── Core remove (optimistic delete + reconcile) ─────────────────

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
    [data, selectedItemId, onDetailContent, setData, setSelectedItemId, setBulkSelectedIds, fetchPRDData, fetchTaskUsage, showToast],
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

  return {
    deleteTarget,
    setDeleteTarget,
    deletingItemId,
    handleRemoveItemFromTree,
    handleConfirmDelete,
    handleRemoveFromDetail,
  };
}
