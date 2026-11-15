/**
 * Live-refresh hook for views that read the PRD through their own route.
 *
 * Calls `refresh` once per coalesced burst of `rex:prd-changed` frames, the
 * same signal the Tasks tree reconciles on (use-prd-websocket.ts). The
 * pipeline's throttle and coalescer keep a bulk write to one refetch.
 *
 * `refresh` should be a stable callback (e.g. wrapped in useCallback).
 */

import { getWorkspaceKey } from "../base-path.js";
import { useEffect } from "preact/hooks";
import { createWSPipeline } from "./use-gateway.js";
import { openFrameSocket } from "../live-feed-socket.js";

export function usePrdChangedRefresh(refresh: () => void): void {
  useEffect(() => {
    let live = true;

    const pipeline = createWSPipeline({
      workspace: getWorkspaceKey(),
      onMessage: () => {},
      onFlush: (batch) => {
        if (live && batch.types.has("rex:prd-changed")) refresh();
      },
      delays: { "rex:prd-changed": 300 },
      throttledTypes: ["rex:prd-changed"],
    });

    // WebSocket not available — the view keeps what it last loaded
    const closeSocket = openFrameSocket((frame) => pipeline.push(frame));

    return () => {
      live = false;
      pipeline.dispose();
      closeSocket();
    };
  }, [refresh]);
}
