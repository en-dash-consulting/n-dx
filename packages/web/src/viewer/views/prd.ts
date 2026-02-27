/**
 * PRD view — displays Rex PRD hierarchy with interactive tree.
 *
 * Loads PRD data from /data/prd.json (served by the unified web server)
 * or accepts it via props. Manages task selection, detail panel content,
 * add item form, bulk actions, and merge preview.
 */

import { h, Fragment } from "preact";
import type { VNode } from "preact";
import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks";
import { PRDTree } from "../components/prd-tree/index.js";
import { TaskDetail } from "../components/prd-tree/task-detail.js";
import { AddItemForm } from "../components/prd-tree/add-item-form.js";
import { BulkActions } from "../components/prd-tree/bulk-actions.js";
import { MergePreview } from "../components/prd-tree/merge-preview.js";
import { PruneConfirmation } from "../components/prd-tree/prune-confirmation.js";
import { DeleteConfirmation } from "../components/prd-tree/delete-confirmation.js";
import { BrandedHeader } from "../components/prd-tree/shared-imports.js";
import type { PRDDocumentData, PRDItemData, AddItemInput } from "../components/prd-tree/index.js";
import type { TaskUsageSummary, WeeklyBudgetResolution, WeeklyBudgetSource } from "../components/prd-tree/types.js";
import type { InlineAddInput } from "../components/prd-tree/inline-add-form.js";
import { findItemById, getAncestorIds, collectSubtreeIds, removeItemById } from "../components/prd-tree/tree-utils.js";
import { resolveTaskUtilization } from "../components/prd-tree/task-utilization.js";
import { diffDocument, applyItemUpdate } from "../components/prd-tree/tree-differ.js";
import type { DetailItem, NavigateTo } from "../components/prd-tree/shared-imports.js";
import { usePolling } from "../hooks/use-polling.js";
import { createMessageCoalescer } from "../message-coalescer.js";
import { createMessageThrottle } from "../message-throttle.js";
import { createRequestDedup } from "../request-dedup.js";
import { createCallRateLimiter } from "../call-rate-limiter.js";
import { createUpdateBatcher } from "../update-batcher.js";
import { createDomUpdateGate } from "../dom-update-gate.js";
import { createResponseBufferGate } from "../response-buffer-gate.js";

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

/** Active tab in the command bar. */
type CommandTab = null | "add" | "merge" | "prune";

/** Shape returned by the incremental /api/hench/task-usage endpoint. */
interface ServerTaskUsage {
  totalTokens: number;
  runCount: number;
}

function normalizeWeeklyBudgetResolution(value: unknown): WeeklyBudgetResolution {
  const source = (value as { source?: WeeklyBudgetSource } | null | undefined)?.source;
  const budget = (value as { budget?: number | null } | null | undefined)?.budget;
  return {
    budget: typeof budget === "number" && Number.isFinite(budget) ? budget : null,
    source: source ?? "missing_budget",
  };
}

/**
 * Convert server-side incremental task usage into client-side summaries
 * with utilization metadata applied.
 */
function applyUtilizationToTaskUsage(
  serverUsage: Record<string, ServerTaskUsage>,
  weeklyBudget: WeeklyBudgetResolution | null,
): Record<string, TaskUsageSummary> {
  const byTask: Record<string, TaskUsageSummary> = {};
  for (const [taskId, usage] of Object.entries(serverUsage)) {
    byTask[taskId] = {
      totalTokens: usage.totalTokens,
      runCount: usage.runCount,
      utilization: resolveTaskUtilization(usage.totalTokens, weeklyBudget),
    };
  }
  return byTask;
}

function applyWeeklyBudget(
  taskUsageById: Record<string, TaskUsageSummary>,
  weeklyBudget: WeeklyBudgetResolution | null,
): Record<string, TaskUsageSummary> {
  const next: Record<string, TaskUsageSummary> = {};
  for (const [taskId, summary] of Object.entries(taskUsageById)) {
    next[taskId] = {
      ...summary,
      utilization: resolveTaskUtilization(summary.totalTokens, weeklyBudget),
    };
  }
  return next;
}

export function PRDView({ prdData, onSelectItem, onDetailContent, initialTaskId, navigateTo }: PRDViewProps) {
  const [data, setData] = useState<PRDDocumentData | null>(prdData ?? null);
  const [loading, setLoading] = useState(!prdData);
  const [error, setError] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CommandTab>(null);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  /** When set, applies an error variant style to the toast. */
  const [toastType, setToastType] = useState<"success" | "error">("success");
  /** Item pending deletion confirmation via modal dialog. */
  const [deleteTarget, setDeleteTarget] = useState<PRDItemData | null>(null);
  /** ID of item currently being deleted (API in-flight). Used for tree loading state. */
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  // Deep-link state
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);
  const [taskUsageById, setTaskUsageById] = useState<Record<string, TaskUsageSummary>>({});
  const [weeklyBudget, setWeeklyBudget] = useState<WeeklyBudgetResolution | null>(null);
  /** Task ID currently highlighted by the deep-link animation. */
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  /** IDs to force-expand in the tree (ancestors of the deep-linked task). */
  const [deepLinkExpandIds, setDeepLinkExpandIds] = useState<Set<string> | null>(null);
  /** Whether the initial deep-link has been consumed. */
  const deepLinkConsumedRef = useRef(false);

  /** Mutable ref so the dedup-wrapped fetchTaskUsage always reads the latest budget. */
  const weeklyBudgetRef = useRef(weeklyBudget);
  weeklyBudgetRef.current = weeklyBudget;

  // Toast helpers — success (green) and error (red) variants
  const showToast = useCallback((message: string, type: "success" | "error" = "success", duration = 3000) => {
    setToast(message);
    setToastType(type);
    setTimeout(() => setToast(null), duration);
  }, []);

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

  // Fetch PRD data with structural sharing — unchanged items keep their
  // reference identity so memoized tree nodes skip re-rendering.
  //
  // Wrapped with request deduplication: concurrent callers (e.g. WebSocket
  // flush arriving during a polling fetch) share a single in-flight request
  // instead of triggering duplicate API calls.
  const prdDedup = useRef(
    createRequestDedup(async () => {
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
      setData((prev) => diffDocument(prev, json));
      setError(null);
    }),
  );

  // Rate limiter sits in front of the dedup: controls *when* calls fire
  // (max 2/sec by default), while the dedup handles concurrent in-flight sharing.
  const prdRateLimiter = useRef(
    createCallRateLimiter(
      async () => {
        try {
          await prdDedup.current.execute();
        } catch (_err) {
          setError("Could not fetch PRD data. Is the server running?");
        }
      },
      { minIntervalMs: 500 },
    ),
  );

  const fetchPRDData = useCallback(async () => {
    await prdRateLimiter.current.execute();
  }, []);

  // Task usage fetch with request deduplication: concurrent callers (e.g.
  // WebSocket flush arriving during a polling fetch) share a single in-flight
  // request instead of triggering duplicate API calls.
  //
  // Uses weeklyBudgetRef (mutable ref) to read the latest budget without
  // recreating the wrapper, keeping the callback reference stable.
  const usageDedup = useRef(
    createRequestDedup(async () => {
      const [taskUsageResult, utilizationResult] = await Promise.allSettled([
        fetch("/api/hench/task-usage"),
        fetch("/api/token/utilization"),
      ]);

      let resolvedWeeklyBudget = weeklyBudgetRef.current;
      if (utilizationResult.status === "fulfilled" && utilizationResult.value.ok) {
        try {
          const json = await utilizationResult.value.json() as { weeklyBudget?: WeeklyBudgetResolution };
          resolvedWeeklyBudget = normalizeWeeklyBudgetResolution(json.weeklyBudget);
          setWeeklyBudget(resolvedWeeklyBudget);
          setTaskUsageById((prev) => applyWeeklyBudget(prev, resolvedWeeklyBudget));
        } catch {
          // Keep prior budget state on parse errors.
        }
      }

      if (taskUsageResult.status === "fulfilled" && taskUsageResult.value.ok) {
        try {
          const json = await taskUsageResult.value.json() as { taskUsage?: Record<string, ServerTaskUsage> };
          setTaskUsageById(applyUtilizationToTaskUsage(json.taskUsage ?? {}, resolvedWeeklyBudget));
        } catch {
          // Keep existing values on parse errors.
        }
      }
    }),
  );

  // Rate limiter for task usage — same pattern as PRD data.
  const usageRateLimiter = useRef(
    createCallRateLimiter(
      async () => {
        try {
          await usageDedup.current.execute();
        } catch {
          // Usage fetch failures are non-critical — keep existing state.
        }
      },
      { minIntervalMs: 500 },
    ),
  );

  const fetchTaskUsage = useCallback(async () => {
    await usageRateLimiter.current.execute();
  }, []);

  useEffect(() => {
    if (prdData) {
      setData(prdData);
      setLoading(false);
      fetchTaskUsage();
      return;
    }

    fetchPRDData().then(() => setLoading(false));
    fetchTaskUsage();
  }, [prdData, fetchPRDData, fetchTaskUsage]);

  // Visibility-aware polling via polling manager
  usePolling("prd:task-usage", fetchTaskUsage, 10_000);

  // WebSocket listener for real-time PRD updates with per-type throttling,
  // message coalescing, RAF-based update batching, DOM update gating, and
  // buffer gating.
  //
  // Five-layer pipeline:
  //
  //   raw WS → buffer gate → throttle (per-type debounce) → coalescer (batch + flush)
  //                                                            ↓ onMessage
  //                                                    domUpdateGate → batcher → RAF → render
  //
  // 0. The response buffer gate checks tab visibility. When the tab is
  //    hidden, messages are silently dropped and downstream buffers are
  //    flushed to free memory. On resume (tab visible again), a single
  //    reconciliation fetch restores data integrity.
  //
  // 1. The throttle debounces high-frequency message types independently:
  //    - rex:prd-changed, rex:item-updated, rex:item-deleted each get
  //      their own trailing-edge timer (configurable per type, default 250ms).
  //    - Other message types pass through immediately.
  //    - maxPendingPerType caps memory during sustained bursts.
  //
  // 2. The coalescer batches throttled output into a single flush per
  //    window, triggering one reconciliation (fetchPRDData + fetchTaskUsage)
  //    instead of N calls.
  //
  // 3. The DOM update gate prevents state updates and re-renders when the
  //    tab is hidden. Instead of scheduling RAF callbacks in background
  //    tabs, it queues updaters per-setter and replays them in a single
  //    batch when the tab becomes visible again.
  //
  // 4. The update batcher collects optimistic setData() calls and applies
  //    them in a single RAF callback. Multiple updates within one frame
  //    are composed in order, so the setter is called exactly once per
  //    frame with the final state. This prevents intermediate renders
  //    during rapid message bursts.
  useEffect(() => {
    let ws: WebSocket | null = null;

    // RAF-based update batcher: ensures at most one setData call per
    // animation frame during rapid WebSocket message bursts. Multiple
    // optimistic updates are composed and applied together.
    const batcher = createUpdateBatcher();

    // DOM update gate: wraps the batcher to prevent state updates and
    // re-renders when the tab is hidden. Instead of scheduling RAF
    // callbacks in background tabs (wasting CPU), the gate queues all
    // pending updaters per-setter and replays them in a single batch
    // when the tab becomes visible again.
    const updateGate = createDomUpdateGate({ batcher });

    const coalescer = createMessageCoalescer({
      // Immediate per-message handler — optimistic UI updates are gated
      // by tab visibility and batched into the next animation frame via
      // the update batcher when visible, or queued for replay on resume.
      onMessage: (msg) => {
        if (msg.type === "rex:item-updated" && msg.itemId && msg.updates) {
          // Targeted update — only the changed node and its ancestors
          // get new object references. Memoized NodeRow components for
          // all other nodes skip their render cycle entirely.
          updateGate.schedule(setData, (prev: PRDDocumentData | null) => {
            if (!prev) return prev;
            const newItems = applyItemUpdate(
              prev.items,
              msg.itemId as string,
              msg.updates as Partial<PRDItemData>,
            );
            return newItems === prev.items ? prev : { ...prev, items: newItems };
          });
          return;
        }

        if (msg.type === "rex:item-deleted" && msg.itemId) {
          // Optimistic local removal — gated for background tab suspension
          updateGate.schedule(setData, (prev: PRDDocumentData | null) => {
            if (!prev) return prev;
            const newItems = removeItemById(prev.items, msg.itemId as string);
            return newItems === prev.items ? prev : { ...prev, items: newItems };
          });
        }
      },

      // Coalesced flush — fires once per debounce window for reconciliation.
      // Flush the gate first so any pending optimistic updates land before
      // the reconciliation fetch overwrites state.
      onFlush: (batch) => {
        updateGate.flush();

        const needsReconciliation =
          batch.types.has("rex:item-updated") ||
          batch.types.has("rex:item-deleted") ||
          batch.types.has("rex:prd-changed");

        if (needsReconciliation) {
          fetchPRDData();
          fetchTaskUsage();
        }
      },
    });

    // Per-type throttle sits in front of the coalescer.
    // Debounces the three high-frequency rex message types independently,
    // letting other types pass through to the coalescer immediately.
    const throttle = createMessageThrottle({
      onMessage: (msg) => coalescer.push(msg),
      defaultDelayMs: 250,
      delays: {
        "rex:prd-changed": 300,     // heavier — full tree reconciliation
        "rex:item-updated": 200,    // lighter — targeted node patch
        "rex:item-deleted": 200,    // lighter — targeted node removal
      },
      throttledTypes: ["rex:prd-changed", "rex:item-updated", "rex:item-deleted"],
      maxPendingPerType: 20,
    });

    // Response buffer gate: prevents memory buildup from WebSocket messages
    // accumulating in the throttle/coalescer/batcher while the tab is hidden.
    // When the tab goes to background, downstream buffers are flushed and
    // incoming messages are dropped. On resume, one reconciliation fetch
    // restores the UI to the latest server state.
    const bufferGate = createResponseBufferGate({
      flushDownstream: [
        () => throttle.flush(),
        () => coalescer.flush(),
        () => updateGate.flush(),
      ],
      onResume: () => {
        fetchPRDData();
        fetchTaskUsage();
      },
    });

    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}`);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!bufferGate.accept()) return; // Tab hidden — drop message
          throttle.push(msg);
        } catch {
          // Ignore malformed messages
        }
      };
    } catch {
      // WebSocket not available — polling still works as fallback
    }

    return () => {
      bufferGate.dispose();
      throttle.dispose();
      coalescer.dispose();
      updateGate.dispose();
      batcher.dispose();
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, [fetchPRDData, fetchTaskUsage]);

  // Dispose rate limiters on unmount to clear pending timers.
  useEffect(() => {
    const prdLimiter = prdRateLimiter.current;
    const usageLimiter = usageRateLimiter.current;
    return () => {
      prdLimiter.dispose();
      usageLimiter.dispose();
    };
  }, []);

  // Handle item update via API — applies update optimistically for instant
  // UI feedback, then reconciles with the server via structural sharing.
  const handleItemUpdate = useCallback(
    async (id: string, updates: Partial<PRDItemData>) => {
      // Optimistic local update — only the changed node path gets new refs
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
          // Revert optimistic update by reconciling with server
          await fetchPRDData();
          return;
        }
        // Reconcile with server (structural sharing avoids unnecessary re-renders)
        await fetchPRDData();
        await fetchTaskUsage();
      } catch (err) {
        console.error("Failed to update item:", err);
        // Revert optimistic update
        await fetchPRDData();
      }
    },
    [fetchPRDData, fetchTaskUsage],
  );

  // Handle item selection — opens detail panel (single click)
  const handleSelectItem = useCallback(
    (item: PRDItemData) => {
      setSelectedItemId(item.id);
      // Update URL to include task ID for shareability
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

  // Deep-link: auto-select the target task once data is loaded
  useEffect(() => {
    if (deepLinkConsumedRef.current || !initialTaskId || loading || !data) return;
    deepLinkConsumedRef.current = true;

    const item = findItemById(data.items, initialTaskId);
    if (!item) {
      setDeepLinkError(`Task "${initialTaskId}" not found`);
      // Clean URL back to /prd
      history.replaceState(
        { view: "prd", file: null, zone: null, runId: null, taskId: null },
        "",
        "/prd",
      );
      return;
    }

    // Expand ancestor nodes so the target is visible
    const ancestors = getAncestorIds(data.items, initialTaskId);
    if (ancestors.length > 0) {
      setDeepLinkExpandIds(new Set(ancestors));
    }

    // Select and highlight the item
    setSelectedItemId(initialTaskId);
    setHighlightedTaskId(initialTaskId);
    handleSelectItem(item);

    // Clear highlight after animation completes
    const timer = setTimeout(() => setHighlightedTaskId(null), 3000);
    return () => clearTimeout(timer);
  }, [initialTaskId, loading, data, handleSelectItem]);

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

  // Handle adding a child item from the detail panel
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

      // Show toast
      showToast(`Created ${result.level}: ${result.title}`);

      // Refresh tree data
      await fetchPRDData();
      await fetchTaskUsage();
    },
    [fetchPRDData, fetchTaskUsage, showToast],
  );

  // Handle task execution trigger
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

  // Handle item removal/deletion with optimistic UI update.
  // Immediately removes the item from local state, then reconciles with the server.
  // On failure, restores state by re-fetching from server.
  const handleRemoveItem = useCallback(
    async (id: string) => {
      // Resolve the item before removal so we can collect descendant IDs
      const targetItem = data ? findItemById(data.items, id) : null;
      const affectedIds = targetItem ? collectSubtreeIds(targetItem) : new Set([id]);

      // Show loading state on the tree node
      setDeletingItemId(id);

      // Optimistic removal — immediately update local state
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, items: removeItemById(prev.items, id) };
      });

      // Clean up bulk selection for the deleted item and its descendants
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

      // Deselect if the selected item is the deleted item or any of its descendants
      if (selectedItemId && affectedIds.has(selectedItemId)) {
        setSelectedItemId(null);
        if (onDetailContent) onDetailContent(null);
        // Clean URL back to /prd
        history.replaceState(
          { view: "prd", file: null, zone: null, runId: null, taskId: null },
          "",
          "/prd",
        );
      }

      try {
        const res = await fetch(`/api/rex/items/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: "Delete failed" }));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }
        const result = await res.json();
        showToast(`Deleted ${result.level}: ${result.title}`);

        // Reconcile with authoritative server state
        await fetchPRDData();
        await fetchTaskUsage();
      } catch (err) {
        // Restore tree from server on failure (undo optimistic removal)
        await fetchPRDData();
        // Re-throw so callers (modal, detail panel) can handle their own UI state
        throw err;
      } finally {
        setDeletingItemId(null);
      }
    },
    [data, selectedItemId, onDetailContent, fetchPRDData, fetchTaskUsage, showToast],
  );

  // Handle item removal from tree node (triggered by inline button or context menu)
  // Opens the modal confirmation dialog instead of window.confirm().
  const handleRemoveItemFromTree = useCallback(
    (item: PRDItemData) => {
      setDeleteTarget(item);
    },
    [],
  );

  // Callback for the delete confirmation modal.
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

  // Wrapper for detail panel deletion — adds error toast since the detail
  // panel's inline confirmation has no access to the toast system.
  const handleRemoveFromDetail = useCallback(
    async (id: string) => {
      try {
        await handleRemoveItem(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delete failed";
        showToast(`Failed to delete item: ${msg}`, "error", 4000);
        throw err; // Re-throw so TaskDetail can reset its removing/confirming state
      }
    },
    [handleRemoveItem, showToast],
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
        taskUsage: taskUsageById[item.id],
        weeklyBudget,
        allItems,
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
  }, [data, selectedItemId, taskUsageById, onDetailContent, handleItemUpdate, handleNavigateToItem, handleExecuteTask, fetchPRDData, fetchTaskUsage, handleAddChild, handleRemoveFromDetail]);

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
      showToast(`Created ${result.level}: ${result.title}`);

      // Close form and refresh
      setActiveTab(null);
      setAddParentId(null);
      await fetchPRDData();
      await fetchTaskUsage();
    },
    [fetchPRDData, fetchTaskUsage, showToast],
  );

  // Handle inline add item submission (from tree node inline form)
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

      // Show toast
      showToast(`Created ${result.level}: ${result.title}`);

      // Refresh tree data
      await fetchPRDData();
      await fetchTaskUsage();
    },
    [fetchPRDData, fetchTaskUsage, showToast],
  );

  // Handle merge completion
  const handleMergeComplete = useCallback(() => {
    setActiveTab(null);
    setBulkSelectedIds(new Set());
    showToast("Items merged successfully");
    fetchPRDData();
    fetchTaskUsage();
  }, [fetchPRDData, fetchTaskUsage, showToast]);

  // Handle prune completion
  const handlePruneComplete = useCallback(() => {
    setActiveTab(null);
    showToast("Completed items pruned and archived");
    fetchPRDData();
    fetchTaskUsage();
  }, [fetchPRDData, fetchTaskUsage, showToast]);

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
        class: `rex-command-btn${activeTab === "add" ? " active" : ""}`,
        onClick: () => {
          setActiveTab(activeTab === "add" ? null : "add");
          setAddParentId(null);
        },
        title: "Add a new item to the PRD",
      }, "+ Add Item"),
      h("button", {
        class: `rex-command-btn${activeTab === "prune" ? " active" : ""}`,
        onClick: () => {
          setActiveTab(activeTab === "prune" ? null : "prune");
        },
        title: "Remove completed subtrees from the PRD",
      }, "\u2702 Prune"),
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

    // Prune confirmation panel
    activeTab === "prune"
      ? h(PruneConfirmation, {
          onPruneComplete: handlePruneComplete,
          onCancel: () => setActiveTab(null),
        })
      : null,

    // PRD tree
    h(PRDTree, {
      document: data,
      taskUsageById,
      weeklyBudget,
      defaultExpandDepth: 2,
      onSelectItem: handleSelectItem,
      selectedItemId,
      bulkSelectedIds,
      onToggleBulkSelect: handleToggleBulkSelect,
      onInlineAddSubmit: handleInlineAddItem,
      highlightedItemId: highlightedTaskId,
      deepLinkExpandIds,
      onRemoveItem: handleRemoveItemFromTree,
      deletingItemId,
    }),

    // Bulk actions bar (floating at bottom)
    h(BulkActions, {
      selectedIds: bulkSelectedIds,
      onClearSelection: () => { setBulkSelectedIds(new Set()); setActiveTab(null); },
      onActionComplete: fetchPRDData,
      onMerge: handleOpenMerge,
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
    deleteTarget
      ? h(DeleteConfirmation, {
          item: deleteTarget,
          onConfirm: handleConfirmDelete,
          onCancel: () => setDeleteTarget(null),
        })
      : null,
  );
}
