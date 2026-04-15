/**
 * Hook for project-wide status polling + WebSocket instant updates.
 *
 * Fetches `/api/status` with dedup + visibility-aware polling, and listens
 * for WebSocket events (hench:run-changed, rex:prd-changed) to refresh
 * immediately when backend state changes.
 *
 * Polling is automatically suspended when memory pressure disables the
 * `autoRefresh` feature (elevated tier and above). The last-known status
 * is preserved and displayed without updates until pressure subsides.
 *
 * Follows the same hook-over-infrastructure pattern as use-prd-websocket,
 * use-memory-monitor, etc. — all infrastructure coupling (WebSocket,
 * ws-pipeline, graceful-degradation) lives here rather than in a
 * presentation component.
 */

import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { usePolling } from "./use-polling.js";
import {
  createWSPipeline,
  isFeatureDisabled,
  onDegradationChange,
} from "./use-gateway.js";

// ---------------------------------------------------------------------------
// Types (mirror server-side ProjectStatus shape)
// ---------------------------------------------------------------------------

type AnalysisFreshness = "fresh" | "stale" | "unavailable";

export interface SourceVisionStatus {
  freshness: AnalysisFreshness;
  analyzedAt: string | null;
  minutesAgo: number | null;
  modulesComplete: number;
  modulesTotal: number;
}

export interface TreeStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  deferred: number;
  blocked: number;
}

export interface RexStatus {
  exists: boolean;
  percentComplete: number;
  stats: TreeStats | null;
  hasInProgress: boolean;
  hasPending: boolean;
  nextTaskTitle: string | null;
}

export interface HenchStatus {
  configured: boolean;
  totalRuns: number;
  activeRuns: number;
  staleRuns: number;
}

export interface ProjectStatus {
  sv: SourceVisionStatus;
  rex: RexStatus;
  hench: HenchStatus;
}

// ---------------------------------------------------------------------------
// Status fetcher with dedup + polling
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;

let cachedStatus: ProjectStatus | null = null;
let fetchPromise: Promise<ProjectStatus | null> | null = null;

async function fetchStatus(): Promise<ProjectStatus | null> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) return null;
      const data: ProjectStatus = await res.json();
      cachedStatus = data;
      return data;
    } catch {
      return null;
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

/** Hook that returns project status, polling at a regular interval.
 *  Also listens for WebSocket events (hench:run-changed, rex:prd-changed)
 *  to refresh immediately when runs or PRD data change on disk.
 *
 *  Polling is automatically suspended when memory pressure disables the
 *  `autoRefresh` feature (elevated tier and above). The last-known status
 *  is preserved and displayed without updates until pressure subsides. */
export function useProjectStatus(): ProjectStatus | null {
  const [status, setStatus] = useState<ProjectStatus | null>(cachedStatus);
  const mountedRef = useRef(true);

  // Track memory-pressure state reactively so usePolling's `enabled`
  // parameter updates when the degradation tier changes.
  const [autoRefreshDisabled, setAutoRefreshDisabled] = useState(
    () => isFeatureDisabled("autoRefresh")
  );

  useEffect(() => {
    const unsubscribe = onDegradationChange((state) => {
      setAutoRefreshDisabled(state.disabledFeatures.has("autoRefresh"));
    });
    return unsubscribe;
  }, []);

  const refresh = useCallback(async () => {
    const data = await fetchStatus();
    if (mountedRef.current) setStatus(data);
  }, []);

  // Initial fetch + WebSocket for instant updates
  useEffect(() => {
    mountedRef.current = true;

    refresh();

    // Connect to WebSocket for instant status updates when runs/PRD change.
    // Composed throttle → coalescer pipeline debounces high-frequency
    // message types independently before batching into a single refresh.
    let ws: WebSocket | null = null;

    const pipeline = createWSPipeline({
      onFlush: (batch) => {
        if (!mountedRef.current) return;
        const needsRefresh =
          batch.types.has("hench:run-changed") ||
          batch.types.has("hench:task-execution-progress") ||
          batch.types.has("rex:prd-changed");
        if (needsRefresh) {
          refresh();
        }
      },
      defaultDelayMs: 250,
      delays: {
        "rex:prd-changed": 300,
        "hench:task-execution-progress": 200,
      },
      throttledTypes: ["rex:prd-changed", "hench:task-execution-progress"],
      maxPendingPerType: 20,
    });

    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}`);
      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          pipeline.push(msg);
        } catch {
          // ignore malformed messages
        }
      };
    } catch {
      // WebSocket not available — polling still works as fallback
    }

    return () => {
      mountedRef.current = false;
      pipeline.dispose();
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, [refresh]);

  // Visibility-aware polling via polling manager.
  // Disabled during memory pressure (autoRefresh feature disabled).
  usePolling("status-indicators", refresh, POLL_INTERVAL_MS, !autoRefreshDisabled);

  return status;
}
