/**
 * The Live analysis page's data: one read of `GET /api/live/analyze`, kept
 * current while the analysis runs.
 *
 * The analyzing process writes `analyze-progress.json` whoever started it, and
 * the server announces each change as an `sv:analyze-progress` frame within
 * about a second. The frame only announces; this refetches. While a run is
 * going the page also polls every {@link LIVE_ANALYZE_POLL_RUNNING_MS} — the socket
 * can be down, and a terminal-started run has no other signal — so a phase,
 * pass or batch change is on screen within two seconds either way. Idle, the
 * poll slows to {@link LIVE_ANALYZE_POLL_IDLE_MS}. The request is relative, so under `/w/<key>/`
 * it addresses that worktree.
 */

import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { getWebSocketUrl, getWorkspaceKey } from "../base-path.js";
import { createWSPipeline } from "./use-gateway.js";

// ---------------------------------------------------------------------------
// Shape — mirrors server/routes-live-analyze.ts and sourcevision's analyze-progress.ts
// ---------------------------------------------------------------------------

export interface AnalyzePhaseRecord {
  index: number;
  name: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  outcome?: "ok" | "failed";
}

export interface AnalyzeClassUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  vendor: string;
  model: string;
}

export type AnalyzeMode = "fast" | "generative" | "narrate" | "cascade" | "narration";

/** The progress file as the server judges it (`AnalyzeProgressReport`). */
export interface AnalyzeProgressFile {
  pid: number;
  status: "running" | "complete" | "failed" | "interrupted";
  mode: AnalyzeMode;
  scope: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  command?: string;
  error?: string;
  phase: { index: number; name: string; total: number } | null;
  phases: AnalyzePhaseRecord[];
  pass: { number: number; label: string } | null;
  batch: { label: string; done: number; total: number } | null;
  judgmentCache: { hits: number; misses: number };
  llm: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    byTaskClass: Record<string, AnalyzeClassUsage>;
  };
  running: boolean;
  stale: boolean;
  previous: { at: string; durationMs: number; phases: Record<string, number> } | null;
}

export interface LiveAnalyzeSnapshot {
  generatedAt: string;
  worktree: { key: string; name: string; path: string; branch: string | null; isAnchor: boolean; isServed: boolean };
  progress: AnalyzeProgressFile | null;
  startedFrom: "dashboard" | "terminal" | null;
  output: { available: boolean; lines: string[] };
  llm: { vendor: string | null; model: string | null };
  costUsd: number;
  modules: Array<{ name: string; status: string; startedAt: string | null; completedAt: string | null; error: string | null }>;
  results: Record<string, string>;
  enrichmentPass: number | null;
  narration: { status: string; zones: number; reason: string | null } | null;
  recent: Array<{ at: string; mode: string; durationMs: number; calls: number; costUsd: number | null }>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const LIVE_ANALYZE_POLL_RUNNING_MS = 1_500;
export const LIVE_ANALYZE_POLL_IDLE_MS = 15_000;
/** Frames can arrive several times a second; the fetch need not follow each. */
const MIN_REFETCH_MS = 500;

export interface LiveAnalyzeData {
  snapshot: LiveAnalyzeSnapshot | null;
  /** The request failed (server down, or the route refused). */
  error: string | null;
  refresh: () => Promise<void>;
}

function isSnapshot(data: unknown): data is LiveAnalyzeSnapshot {
  const d = data as Partial<LiveAnalyzeSnapshot> | null;
  return !!d && typeof d.generatedAt === "string" && !!d.worktree && !!d.output && Array.isArray(d.modules);
}

/** Frame types that mean the analysis, or the set of running jobs, moved. */
const WATCHED_FRAMES = ["sv:analyze-progress", "live:changed", "commands:sv-analyze-started", "sv:data-changed"];

export function useLiveAnalyze(): LiveAnalyzeData {
  const [snapshot, setSnapshot] = useState<LiveAnalyzeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const lastFetchRef = useRef(0);
  const running = snapshot?.progress?.running === true;

  const fetchSnapshot = useCallback(async () => {
    lastFetchRef.current = Date.now();
    try {
      const res = await fetch("/api/live/analyze");
      const json: unknown = await res.json().catch(() => null);
      if (!mountedRef.current) return;
      if (res.ok && isSnapshot(json)) {
        setSnapshot(json);
        setError(null);
      } else {
        setError((json as { error?: string } | null)?.error ?? `Could not load the analysis (HTTP ${res.status})`);
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Could not load the analysis");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchSnapshot();

    let ws: WebSocket | null = null;
    const pipeline = createWSPipeline({
      workspace: getWorkspaceKey(),
      onFlush: (batch) => {
        if (!mountedRef.current || !WATCHED_FRAMES.some((type) => batch.types.has(type))) return;
        if (Date.now() - lastFetchRef.current >= MIN_REFETCH_MS) void fetchSnapshot();
      },
      // Progress frames go straight to the coalescer: a short window is the only delay.
      coalescerWindowMs: 100,
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
  }, [fetchSnapshot]);

  // A raw timer, not the visibility-aware poller: a page left in a background
  // tab should be current when it is looked at again.
  useEffect(() => {
    const id = setInterval(() => { void fetchSnapshot(); }, running ? LIVE_ANALYZE_POLL_RUNNING_MS : LIVE_ANALYZE_POLL_IDLE_MS);
    return () => clearInterval(id);
  }, [running, fetchSnapshot]);

  return { snapshot, error, refresh: fetchSnapshot };
}
