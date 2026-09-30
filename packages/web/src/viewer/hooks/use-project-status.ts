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

import { getWebSocketUrl, getWorkspaceKey } from "../base-path.js";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { usePolling } from "../views/use-polling.js";
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
  /**
   * Whether this project has ever produced real SourceVision analysis or a
   * Rex PRD — see the server-side doc comment on `ProjectStatus` in
   * `routes-status.ts`. Lets the Home next-step panel tell "not initialised"
   * apart from "initialised but not analysed", which `sv`/`rex` alone cannot.
   */
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// Status fetcher with dedup + polling
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;

let cachedStatus: ProjectStatus | null = null;
let fetchPromise: Promise<ProjectStatus | null> | null = null;

/**
 * Shape check for the `/api/status` body, run once here rather than left to
 * an unchecked `const data: ProjectStatus = await res.json()` cast.
 *
 * A body with a missing section (e.g. only `hench` arrived) or a malformed
 * one (e.g. `rex.stats = {}` — neither `null` nor a real `TreeStats`) is
 * treated the same as a failed fetch: the whole body is unavailable, not
 * partially trusted. That is what lets the Home next-step panel compute one
 * of its four states from `status` without also having to guard against a
 * half-populated object — every caller of `useProjectStatus` sees either a
 * complete `ProjectStatus` or `null`.
 */
function isValidProjectStatus(data: unknown): data is ProjectStatus {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<ProjectStatus>;
  if (!d.sv || typeof d.sv.freshness !== "string") return false;
  if (!d.rex || typeof d.rex.exists !== "boolean") return false;
  if (d.rex.stats !== null && d.rex.stats !== undefined) {
    if (typeof d.rex.stats !== "object" || typeof d.rex.stats.total !== "number") return false;
  }
  if (!d.hench || typeof d.hench.configured !== "boolean") return false;
  if (typeof d.initialized !== "boolean") return false;
  return true;
}

async function fetchStatus(): Promise<ProjectStatus | null> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) return null;
      const data: unknown = await res.json();
      if (!isValidProjectStatus(data)) return null;
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
      workspace: getWorkspaceKey(),
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
      ws = new WebSocket(getWebSocketUrl());
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
