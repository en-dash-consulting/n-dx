/**
 * The Live tab's data: one read of `GET /api/live`, kept fresh without a reload.
 *
 * The server answers for the whole repository — every worktree's running runs
 * and jobs — so, like `useWorktrees`, this fetch is deliberately not scoped to
 * a workspace. It refetches on the server's `live:changed` frame (tagged `"*"`,
 * so the pipeline's workspace filter lets it through whichever worktree this
 * viewer addresses) and on a visibility-aware poll as the fallback for a
 * socket that is down. Refetches are floored at the route's own cache TTL: a
 * faster request can only return the cached answer.
 *
 * {@link liveTabState} and {@link liveTabLabel} are the tab's whole reading of
 * the answer, kept pure so the states the acceptance criteria name are
 * testable without a DOM.
 */

import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { getWebSocketUrl, getWorkspaceKey } from "../base-path.js";
import { usePolling } from "../views/use-polling.js";
import { createWSPipeline } from "./use-gateway.js";

// ---------------------------------------------------------------------------
// Shape — the slice of server/routes-live.ts's LiveSnapshot the tab reads
// ---------------------------------------------------------------------------

/** Mirrors LiveWorktree in server/routes-live.ts. */
export interface LiveWorktreeRef {
  key: string;
  isAnchor: boolean;
}

/** Mirrors the fields of LiveRun in server/routes-live.ts that the peek shows. */
export interface LiveRunSummary {
  runId: string;
  taskId: string | null;
  taskTitle: string | null;
  branch: string | null;
  worktree: LiveWorktreeRef;
  startedAt: string | null;
  stale: boolean;
  lastProgress: string | null;
}

/** The slice of the server's AnalyzeProgressReport the progress bar needs. */
export interface LiveAnalyzeProgress {
  phase: { index: number; name: string; total: number } | null;
  batch: { label: string; done: number; total: number } | null;
}

/** Mirrors the fields of LiveJob in server/routes-live.ts that the peek shows. */
export interface LiveJobSummary {
  id: string;
  kind: string;
  worktree: LiveWorktreeRef | null;
  startedAt: string | null;
  detail: string | null;
  progress: LiveAnalyzeProgress | null;
}

export interface LiveSummary {
  runs: LiveRunSummary[];
  jobs: LiveJobSummary[];
  counts: { running: number; stale: number; jobs: number };
}

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

export type LiveTabState = "idle" | "running" | "attention";

/** Runs and jobs both count: the tab's number is everything in flight. */
export function liveRunningCount(live: LiveSummary | null): number {
  return live ? live.counts.running + live.counts.jobs : 0;
}

export function liveStuckCount(live: LiveSummary | null): number {
  return live?.counts.stale ?? 0;
}

/** Stuck beats running beats idle. */
export function liveTabState(live: LiveSummary | null): LiveTabState {
  if (liveStuckCount(live) > 0) return "attention";
  return liveRunningCount(live) > 0 ? "running" : "idle";
}

/** What a screen reader hears for the tab: "Live, 3 running, 1 stuck" / "Live, nothing running". */
export function liveTabLabel(live: LiveSummary | null): string {
  const running = liveRunningCount(live);
  const stuck = liveStuckCount(live);
  if (running === 0 && stuck === 0) return "Live, nothing running";
  const parts = ["Live", `${running} running`];
  if (stuck > 0) parts.push(`${stuck} stuck`);
  return parts.join(", ");
}

/**
 * How far through a sourcevision analysis it is, 0–1, or null before the first
 * phase starts. Phases are equal slices of the bar; the batch in progress fills
 * the current one.
 */
export function analyzeFraction(progress: LiveAnalyzeProgress | null): number | null {
  const phase = progress?.phase;
  if (!progress || !phase || phase.total <= 0) return null;
  const batch = progress.batch;
  const within = batch && batch.total > 0 ? Math.min(batch.done / batch.total, 1) : 0;
  return Math.min(((phase.index - 1) + within) / phase.total, 1);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** The route caches its answer for 1s; the socket carries the changes, the poll is the backstop. */
const POLL_INTERVAL_MS = 10_000;
const MIN_REFETCH_INTERVAL_MS = 1_000;

function isLiveSummary(data: unknown): data is LiveSummary {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<LiveSummary>;
  return Array.isArray(d.runs) && Array.isArray(d.jobs)
    && !!d.counts && typeof d.counts.running === "number"
    && typeof d.counts.stale === "number" && typeof d.counts.jobs === "number";
}

/**
 * The live snapshot, or null until the first answer (and after a failed one —
 * a tab that cannot reach the endpoint reads as idle rather than stale).
 * `enabled: false` makes no request at all, for a static export with no server.
 */
export function useLive(enabled = true): LiveSummary | null {
  const [live, setLive] = useState<LiveSummary | null>(null);
  const lastFetchRef = useRef(0);
  const mountedRef = useRef(true);

  const fetchLive = useCallback(async () => {
    lastFetchRef.current = Date.now();
    try {
      const res = await fetch("/api/live");
      if (!res.ok) {
        if (mountedRef.current) setLive(null);
        return;
      }
      const json: unknown = await res.json();
      if (mountedRef.current) setLive(isLiveSummary(json) ? json : null);
    } catch {
      // Unreachable server: the tab falls back to idle until the next tick.
      if (mountedRef.current) setLive(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return () => { mountedRef.current = false; };
    void fetchLive();

    let ws: WebSocket | null = null;
    const pipeline = createWSPipeline({
      workspace: getWorkspaceKey(),
      onFlush: (batch) => {
        if (!mountedRef.current || !batch.types.has("live:changed")) return;
        if (Date.now() - lastFetchRef.current < MIN_REFETCH_INTERVAL_MS) return;
        void fetchLive();
      },
      defaultDelayMs: 250,
    });
    try {
      ws = new WebSocket(getWebSocketUrl());
      ws.onmessage = (event) => {
        try {
          pipeline.push(JSON.parse(event.data));
        } catch {
          // Malformed frame — the poll still catches up.
        }
      };
    } catch {
      // No WebSocket — polling still works.
    }

    return () => {
      mountedRef.current = false;
      pipeline.dispose();
      ws?.close();
    };
  }, [enabled, fetchLive]);

  usePolling("live", fetchLive, POLL_INTERVAL_MS, enabled);

  return live;
}
