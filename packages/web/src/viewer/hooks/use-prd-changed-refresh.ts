/**
 * Live-refresh hook for views that read the PRD through their own route.
 *
 * Calls `refresh` once per coalesced burst of `rex:prd-changed` frames, the
 * same signal the Tasks tree reconciles on (use-prd-websocket.ts). The
 * pipeline's throttle and coalescer keep a bulk write to one refetch.
 *
 * `refresh` should be a stable callback (e.g. wrapped in useCallback).
 */

import { getWebSocketUrl, getWorkspaceKey } from "../base-path.js";
import { useEffect } from "preact/hooks";
import { createWSPipeline } from "./use-gateway.js";

export function usePrdChangedRefresh(refresh: () => void): void {
  useEffect(() => {
    let live = true;
    let ws: WebSocket | null = null;

    const pipeline = createWSPipeline({
      workspace: getWorkspaceKey(),
      onMessage: () => {},
      onFlush: (batch) => {
        if (live && batch.types.has("rex:prd-changed")) refresh();
      },
      defaultDelayMs: 250,
      delays: { "rex:prd-changed": 300 },
      throttledTypes: ["rex:prd-changed"],
      maxPendingPerType: 20,
    });

    try {
      ws = new WebSocket(getWebSocketUrl());
      ws.onmessage = (event) => {
        try {
          pipeline.push(JSON.parse(event.data));
        } catch {
          // ignore malformed messages
        }
      };
    } catch {
      // WebSocket not available — the view keeps what it last loaded
    }

    return () => {
      live = false;
      pipeline.dispose();
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, [refresh]);
}
