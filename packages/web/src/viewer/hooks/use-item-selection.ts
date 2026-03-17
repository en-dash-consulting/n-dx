/**
 * Item selection hooks — single select, bulk multi-select, and navigation.
 *
 * Extracted from usePRDActions to isolate selection state management
 * from mutation logic. Handles plain click, ctrl+click toggle, and
 * shift+click range selection.
 *
 * @see ./use-prd-actions.ts — parent hook that composes this
 */

import { useState, useCallback, useMemo, useRef } from "preact/hooks";
import type { PRDDocumentData, PRDItemData } from "../components/prd-tree/types.js";
import type { DetailItem } from "../types.js";
import { findItemById } from "../components/prd-tree/tree-utils.js";

export interface ItemSelectionDeps {
  /** Current PRD document data. */
  data: PRDDocumentData | null;
  /** External callback for item selection (parent layout). */
  onSelectItem?: (detail: DetailItem | null) => void;
}

export interface ItemSelectionState {
  /** Currently selected item ID. */
  selectedItemId: string | null;
  /** Set the selected item ID directly (e.g. for clearing on delete). */
  setSelectedItemId: (id: string | null) => void;
  /** Set of item IDs selected for bulk operations. */
  bulkSelectedIds: Set<string>;
  /** Setter for bulk selection (for clearing from external code). */
  setBulkSelectedIds: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  /** Items resolved from bulk selection (for merge preview). */
  selectedItems: PRDItemData[];
  /** Select an item (opens detail panel). */
  handleSelectItem: (item: PRDItemData) => void;
  /**
   * Multi-select handler for bulk operations.
   * Ctrl/Cmd+click toggles individual items, Shift+click selects a
   * contiguous range from the anchor, plain click selects only that item.
   * `visibleIds` provides the flat ordering of currently visible nodes.
   */
  handleBulkSelect: (item: PRDItemData, modifiers: { ctrlKey: boolean; shiftKey: boolean }, visibleIds: string[]) => void;
  /** Clear all bulk-selected items. */
  clearBulkSelection: () => void;
  /** Navigate to an item by ID (from detail panel links). */
  handleNavigateToItem: (id: string) => void;
}

/**
 * Hook for item selection state — single select, bulk multi-select, and navigation.
 */
export function useItemSelection({ data, onSelectItem }: ItemSelectionDeps): ItemSelectionState {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());

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

  // ── Bulk selection (ctrl/shift multi-select) ─────────────────────

  /** Anchor item ID for shift-click range selection. */
  const bulkAnchorRef = useRef<string | null>(null);

  const handleBulkSelect = useCallback(
    (item: PRDItemData, modifiers: { ctrlKey: boolean; shiftKey: boolean }, visibleIds: string[]) => {
      setBulkSelectedIds((prev) => {
        if (modifiers.shiftKey && bulkAnchorRef.current) {
          // Shift+click: select contiguous range from anchor to clicked item
          const anchorIdx = visibleIds.indexOf(bulkAnchorRef.current);
          const targetIdx = visibleIds.indexOf(item.id);
          if (anchorIdx >= 0 && targetIdx >= 0) {
            const start = Math.min(anchorIdx, targetIdx);
            const end = Math.max(anchorIdx, targetIdx);
            const rangeIds = visibleIds.slice(start, end + 1);
            // Combine with existing selection when ctrl is also held
            const next = modifiers.ctrlKey ? new Set(prev) : new Set<string>();
            for (const id of rangeIds) next.add(id);
            return next;
          }
          // Anchor not visible — fall through to single select
        }

        if (modifiers.ctrlKey) {
          // Ctrl/Cmd+click: toggle individual item
          const next = new Set(prev);
          if (next.has(item.id)) {
            next.delete(item.id);
          } else {
            next.add(item.id);
          }
          bulkAnchorRef.current = item.id;
          return next;
        }

        // Plain click: select only this item, deselect all others
        bulkAnchorRef.current = item.id;
        // If already the sole selection, deselect (toggle off)
        if (prev.size === 1 && prev.has(item.id)) {
          return new Set<string>();
        }
        return new Set([item.id]);
      });
    },
    [],
  );

  const clearBulkSelection = useCallback(() => {
    setBulkSelectedIds(new Set());
    bulkAnchorRef.current = null;
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

  return {
    selectedItemId,
    setSelectedItemId,
    bulkSelectedIds,
    setBulkSelectedIds,
    selectedItems,
    handleSelectItem,
    handleBulkSelect,
    clearBulkSelection,
    handleNavigateToItem,
  };
}
