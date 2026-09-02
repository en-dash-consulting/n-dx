/**
 * Live-refresh hook for the Hench Runs view.
 *
 * Listens for WebSocket events (hench:run-changed, hench:task-execution-progress)
 * and invokes `refresh` immediately when a run is created, updated, or its
 * execution status changes, instead of waiting for the next poll tick.
 *
 * Without this, starting a task from the empty-state "Start Working" button
 * appears to do nothing: the POST to /api/hench/execute returns as soon as
 * the agent process is spawned, well before it reaches its first `saveRun`
 * call, so the immediate post-start `fetchRuns()` call still sees an empty
 * list — the run only becomes visible on the next 10s poll tick (or later,
 * since the file watcher itself debounces). This hook closes that gap by
 * reacting to the same `hench:run-changed` broadcast the server emits when
 * `.hench/runs/*.json` changes on disk.
 *
 * It also surfaces `hench:task-execution-progress` directly via
 * `onExecutionProgress`, independent of whether a run file exists yet — if
 * the agent process fails before its first `saveRun` (e.g. an unreachable
 * LLM vendor, an auth error), no run file is ever written, so `refresh`
 * alone would leave the view stuck showing "No runs yet" forever with no
 * indication anything was attempted. The empty-state view uses this to show
 * starting/running/failed feedback even with zero persisted runs.
 *
 * Mirrors the WebSocket setup in use-project-status.ts, scoped to just the
 * events this view cares about.
 */

import { useEffect, useRef } from "preact/hooks";
import { createWSPipeline } from "./use-gateway.js";

/** Mirrors the server's TaskExecutionStatus (routes-hench.ts). */
export interface HenchExecutionProgress {
  taskId: string;
  taskTitle: string;
  runId: string;
  status: "starting" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  lastOutput?: string;
  tokensPerSecond?: number;
  error?: string;
  exitCode?: number | null;
}

/**
 * Subscribe to hench run-change events and call `refresh` when they occur.
 * Also invokes `onExecutionProgress` immediately (unthrottled) for every
 * `hench:task-execution-progress` message, so callers can show live status
 * before any run file exists on disk.
 *
 * `refresh` and `onExecutionProgress` should be stable callbacks (e.g.
 * wrapped in useCallback).
 */
export function useHenchRunsLiveRefresh(
  refresh: () => void,
  onExecutionProgress?: (state: HenchExecutionProgress) => void,
): void {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let ws: WebSocket | null = null;

    const pipeline = createWSPipeline({
      onMessage: (msg) => {
        if (!mountedRef.current) return;
        if (msg.type === "hench:task-execution-progress" && msg.state && onExecutionProgress) {
          onExecutionProgress(msg.state as HenchExecutionProgress);
        }
      },
      onFlush: (batch) => {
        if (!mountedRef.current) return;
        const needsRefresh =
          batch.types.has("hench:run-changed") ||
          batch.types.has("hench:task-execution-progress");
        if (needsRefresh) refresh();
      },
      defaultDelayMs: 250,
      delays: {
        "hench:task-execution-progress": 200,
      },
      throttledTypes: ["hench:task-execution-progress"],
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
  }, [refresh, onExecutionProgress]);
}
