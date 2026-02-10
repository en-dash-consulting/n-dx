/**
 * PRD view — displays Rex PRD hierarchy with interactive tree.
 *
 * Loads PRD data from /data/prd.json (served by the unified web server)
 * or accepts it via props. Manages task selection, detail panel content,
 * add item form, bulk actions, and merge preview.
 */

import { h, Fragment } from "preact";
import type { VNode } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import { PRDTree } from "../components/prd-tree/index.js";
import { TaskDetail } from "../components/prd-tree/task-detail.js";
import { AddItemForm } from "../components/prd-tree/add-item-form.js";
import { BulkActions } from "../components/prd-tree/bulk-actions.js";
import { MergePreview } from "../components/prd-tree/merge-preview.js";
import { BrandedHeader } from "../components/logos.js";
import type { PRDDocumentData, PRDItemData, AddItemInput } from "../components/prd-tree/index.js";
import type { DetailItem } from "../types.js";

export interface PRDViewProps {
  /** Pre-loaded PRD data. If not provided, fetches from /data/prd.json. */
  prdData?: PRDDocumentData | null;
  /** Called when a PRD item is selected, to open the detail panel. */
  onSelectItem?: (detail: DetailItem | null) => void;
  /** Called with rendered TaskDetail content for the detail panel. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDetailContent?: (content: VNode<any> | null) => void;
}

/** Active tab in the command bar. */
type CommandTab = null | "add" | "merge";

/** Walk the tree to find an item by ID. */
function findItemById(items: PRDItemData[], id: string): PRDItemData | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findItemById(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function PRDView({ prdData, onSelectItem, onDetailContent }: PRDViewProps) {
  const [data, setData] = useState<PRDDocumentData | null>(prdData ?? null);
  const [loading, setLoading] = useState(!prdData);
  const [error, setError] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CommandTab>(null);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

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

  // Fetch PRD data
  const fetchPRDData = useCallback(async () => {
    try {
      const res = await fetch("/data/prd.json");
      if (!res.ok) {
        if (res.status === 404) {
          setError("No PRD data found. Run 'rex init' then 'rex analyze' to create one.");
        } else {
          setError(`Failed to load PRD data (${res.status})`);
        }
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (_err) {
      setError("Could not fetch PRD data. Is the server running?");
    }
  }, []);

  useEffect(() => {
    if (prdData) {
      setData(prdData);
      setLoading(false);
      return;
    }

    fetchPRDData().then(() => setLoading(false));
  }, [prdData, fetchPRDData]);

  // Handle item update via API
  const handleItemUpdate = useCallback(
    async (id: string, updates: Partial<PRDItemData>) => {
      try {
        const res = await fetch(`/api/rex/items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          console.error("Failed to update item:", await res.text());
          return;
        }
        // Refresh PRD data
        await fetchPRDData();
      } catch (err) {
        console.error("Failed to update item:", err);
      }
    },
    [fetchPRDData],
  );

  // Handle item selection — opens detail panel (single click)
  const handleSelectItem = useCallback(
    (item: PRDItemData) => {
      setSelectedItemId(item.id);
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

  // Handle checkbox toggle for bulk selection
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

  // Navigate to a different item (from dependencies/children in the detail panel)
  const handleNavigateToItem = useCallback(
    (id: string) => {
      if (!data) return;
      const item = findItemById(data.items, id);
      if (item) handleSelectItem(item);
    },
    [data, handleSelectItem],
  );

  // Update detail content when selection or data changes
  useEffect(() => {
    if (!data || !selectedItemId || !onDetailContent) {
      if (onDetailContent) onDetailContent(null);
      return;
    }

    const item = findItemById(data.items, selectedItemId);
    if (!item) {
      onDetailContent(null);
      return;
    }

    const allItems = data.items;
    onDetailContent(
      h(TaskDetail, {
        item,
        allItems,
        onUpdate: handleItemUpdate,
        onNavigateToItem: handleNavigateToItem,
      }),
    );
  }, [data, selectedItemId, onDetailContent, handleItemUpdate, handleNavigateToItem]);

  // Handle add item submission
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

      // Show toast
      setToast(`Created ${result.level}: ${result.title}`);
      setTimeout(() => setToast(null), 3000);

      // Close form and refresh
      setActiveTab(null);
      setAddParentId(null);
      await fetchPRDData();
    },
    [fetchPRDData],
  );

  // Handle merge completion
  const handleMergeComplete = useCallback(() => {
    setActiveTab(null);
    setBulkSelectedIds(new Set());
    setToast("Items merged successfully");
    setTimeout(() => setToast(null), 3000);
    fetchPRDData();
  }, [fetchPRDData]);

  // Open merge preview
  const handleOpenMerge = useCallback(() => {
    setActiveTab("merge");
  }, []);

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

    // Command bar — action buttons
    h("div", { class: "rex-command-bar" },
      h("button", {
        class: `rex-command-btn${activeTab === "add" ? " active" : ""}`,
        onClick: () => {
          setActiveTab(activeTab === "add" ? null : "add");
          setAddParentId(null);
        },
        title: "Add a new item to the PRD",
      }, "+ Add Item"),
    ),

    // Active panel
    activeTab === "add"
      ? h(AddItemForm, {
          allItems: data.items,
          onSubmit: handleAddItem,
          onCancel: () => { setActiveTab(null); setAddParentId(null); },
          defaultParentId: addParentId,
        })
      : null,

    // Merge preview panel
    activeTab === "merge" && selectedItems.length >= 2
      ? h(MergePreview, {
          selectedItems,
          onMergeComplete: handleMergeComplete,
          onCancel: () => setActiveTab(null),
        })
      : null,

    // PRD tree
    h(PRDTree, {
      document: data,
      defaultExpandDepth: 2,
      onSelectItem: handleSelectItem,
      selectedItemId,
      bulkSelectedIds,
      onToggleBulkSelect: handleToggleBulkSelect,
    }),

    // Bulk actions bar (floating at bottom)
    h(BulkActions, {
      selectedIds: bulkSelectedIds,
      onClearSelection: () => { setBulkSelectedIds(new Set()); setActiveTab(null); },
      onActionComplete: fetchPRDData,
      onMerge: handleOpenMerge,
    }),

    // Toast notification
    toast
      ? h("div", { class: "rex-toast", role: "status", "aria-live": "polite" }, toast)
      : null,
  );
}
