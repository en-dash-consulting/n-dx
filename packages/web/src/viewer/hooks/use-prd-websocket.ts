/**
 * PRD WebSocket real-time update hook.
 *
 * Sets up a five-layer message processing pipeline for real-time PRD
 * updates via WebSocket:
 *
 *   raw WS → buffer gate → throttle → coalescer → DOM gate → batcher → RAF → render
 *
 * Each layer has a specific role:
 *
 * 0. **Response buffer gate** — drops messages when tab is hidden, flushes
 *    downstream buffers to free memory, reconciles on resume.
 * 1. **Throttle** — per-type trailing-edge debounce for high-frequency
 *    rex message types (prd-changed, item-updated, item-deleted).
 * 2. **Coalescer** — batches throttled output into a single reconciliation
 *    flush instead of N separate fetches.
 * 3. **DOM update gate** — queues state updates when tab is hidden,
 *    replays them in a single batch when visible again.
 * 4. **Update batcher** — collects setData calls into a single RAF
 *    callback per animation frame.
 *
 * Extracted from PRDView to isolate WebSocket side effects from the
 * component's render logic.
 *
 * @see ../messaging/message-coalescer.ts
 * @see ../messaging/message-throttle.ts
 * @see ../performance/dom-update-gate.ts
 * @see ../performance/update-batcher.ts
 * @see ../performance/response-buffer-gate.ts
 */

import { useEffect } from "preact/hooks";
import type { PRDDocumentData, PRDItemData } from "../components/prd-tree/types.js";
import { applyItemUpdate } from "../components/prd-tree/tree-differ.js";
import { removeItemById } from "../components/prd-tree/tree-utils.js";
import { createWSPipeline } from "../messaging/index.js";
import { createUpdateBatcher, createDomUpdateGate, createResponseBufferGate } from "../performance/index.js";

export interface PRDWebSocketDeps {
  /** Setter for PRD document state (supports functional updates). */
  setData: (updater: PRDDocumentData | null | ((prev: PRDDocumentData | null) => PRDDocumentData | null)) => void;
  /** Fetch/reconcile PRD data from server. */
  fetchPRDData: () => Promise<void>;
  /** Fetch/reconcile task usage data from server. */
  fetchTaskUsage: () => Promise<void>;
}

/**
 * Hook that manages the WebSocket connection and message processing
 * pipeline for real-time PRD updates.
 *
 * All parameters are expected to be stable references (wrapped in
 * useCallback or similar). The effect re-runs when any dependency changes.
 */
export function usePRDWebSocket({ setData, fetchPRDData, fetchTaskUsage }: PRDWebSocketDeps): void {
  useEffect(() => {
    let ws: WebSocket | null = null;

    // RAF-based update batcher: ensures at most one setData call per
    // animation frame during rapid WebSocket message bursts.
    const batcher = createUpdateBatcher();

    // DOM update gate: wraps the batcher to prevent state updates and
    // re-renders when the tab is hidden.
    const updateGate = createDomUpdateGate({ batcher });

    // Composed throttle → coalescer pipeline for WebSocket messages.
    const pipeline = createWSPipeline({
      // Immediate per-message handler — optimistic UI updates are gated
      // by tab visibility and batched into the next animation frame.
      onMessage: (msg) => {
        if (msg.type === "rex:item-updated" && msg.itemId && msg.updates) {
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
          updateGate.schedule(setData, (prev: PRDDocumentData | null) => {
            if (!prev) return prev;
            const newItems = removeItemById(prev.items, msg.itemId as string);
            return newItems === prev.items ? prev : { ...prev, items: newItems };
          });
        }
      },

      // Coalesced flush — fires once per debounce window for reconciliation.
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
      defaultDelayMs: 250,
      delays: {
        "rex:prd-changed": 300,     // heavier — full tree reconciliation
        "rex:item-updated": 200,    // lighter — targeted node patch
        "rex:item-deleted": 200,    // lighter — targeted node removal
      },
      throttledTypes: ["rex:prd-changed", "rex:item-updated", "rex:item-deleted"],
      maxPendingPerType: 20,
    });

    // Response buffer gate: drops messages while tab is hidden,
    // reconciles on resume.
    const bufferGate = createResponseBufferGate({
      flushDownstream: [
        () => pipeline.flush(),
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
          pipeline.push(msg);
        } catch {
          // Ignore malformed messages
        }
      };
    } catch {
      // WebSocket not available — polling still works as fallback
    }

    return () => {
      bufferGate.dispose();
      pipeline.dispose();
      updateGate.dispose();
      batcher.dispose();
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, [setData, fetchPRDData, fetchTaskUsage]);
}
