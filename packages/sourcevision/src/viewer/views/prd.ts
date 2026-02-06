/**
 * PRD view — displays Rex PRD hierarchy with interactive tree.
 *
 * Loads PRD data from /data/prd.json (served by the unified web server)
 * or accepts it via props. Manages task selection and detail panel content.
 */

import { h } from "preact";
import type { VNode } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { PRDTree } from "../components/prd-tree/index.js";
import { TaskDetail } from "../components/prd-tree/task-detail.js";
import type { PRDDocumentData, PRDItemData } from "../components/prd-tree/index.js";
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

  // Fetch PRD data
  useEffect(() => {
    if (prdData) {
      setData(prdData);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchPRD() {
      try {
        const res = await fetch("/data/prd.json");
        if (!res.ok) {
          if (res.status === 404) {
            setError("No PRD data found. Run 'rex init' then 'rex analyze' to create one.");
          } else {
            setError(`Failed to load PRD data (${res.status})`);
          }
          setLoading(false);
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (_err) {
        if (!cancelled) {
          setError("Could not fetch PRD data. Is the server running?");
          setLoading(false);
        }
      }
    }

    fetchPRD();
    return () => { cancelled = true; };
  }, [prdData]);

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
        const prdRes = await fetch("/data/prd.json");
        if (prdRes.ok) {
          const newData = await prdRes.json();
          setData(newData);
        }
      } catch (err) {
        console.error("Failed to update item:", err);
      }
    },
    [],
  );

  // Handle item selection — opens detail panel
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

  return h(PRDTree, {
    document: data,
    defaultExpandDepth: 2,
    onSelectItem: handleSelectItem,
    selectedItemId,
  });
}
