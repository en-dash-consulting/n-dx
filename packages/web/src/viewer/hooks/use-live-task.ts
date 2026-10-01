/**
 * The running-task page's data: the task snapshot (`GET /api/live/task/:id`)
 * and the selected run's progress events, followed as they are written.
 *
 * Events are tailed from a seq cursor through `GET /api/hench/runs/:id/events`.
 * Each tail of a running run renews the server's watch lease on it, and while
 * the lease is held the server announces appends with a `hench:run-appended`
 * frame, so a new event is fetched within a fraction of a second of being
 * written. Without a socket the tail polls every second instead; with one it
 * still re-tails every {@link SOCKET_RETAIL_MS} so the lease never lapses
 * through a quiet stretch.
 *
 * The snapshot — tokens, turns, heartbeat, log tail — is refetched on run
 * frames (no faster than once a second) and on a slower poll as the backstop.
 * Both requests are relative, so under `/w/<key>/` they address that worktree.
 */

import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { getWebSocketUrl, getWorkspaceKey } from "../base-path.js";
import { createWSPipeline } from "./use-gateway.js";

// ---------------------------------------------------------------------------
// Shape — mirrors server/routes-live-task.ts and hench's store/run-events.ts
// ---------------------------------------------------------------------------

export interface LiveTaskChainLink {
  id: string;
  title: string;
  level: string;
}

export interface LiveTaskItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  acceptanceCriteria: string[];
  epicChain: LiveTaskChainLink[];
}

export interface LiveTaskReview {
  failed: string | null;
  detail: string | null;
  findings: number | null;
  unresolved: number | null;
}

export interface LiveTaskReviewPlan {
  model: string | null;
  modelSource: string | null;
  optional: boolean;
}

export interface LiveTaskReviewSpend {
  turns: number;
  tokens: number;
  costUsd: number;
}

/** Severity, verdict, action and disposition are plain text: values this build does not know arrive as written. */
export interface LiveReviewFinding {
  title: string | null;
  location: string | null;
  severity: string | null;
  verdict: string | null;
  scenario: string | null;
  action: string | null;
  itemId: string | null;
  note: string | null;
  disposition: string | null;
  reason: string | null;
}

export interface LiveReviewReport {
  taskId: string | null;
  findings: LiveReviewFinding[];
  fixesApplied: boolean | null;
  summary: string | null;
}

export interface LiveTaskRun {
  runId: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  heartbeatAgeMs: number | null;
  stale: boolean;
  turns: number | null;
  tokens: { input: number; output: number; cacheCreationInput: number; cacheReadInput: number; total: number };
  costUsd: number;
  tokensPerSecond: number | null;
  model: string | null;
  vendor: string | null;
  weight: string | null;
  worktreeRoot: string | null;
  branch: string | null;
  startHead: string | null;
  pid: number | null;
  startedFrom: "dashboard" | "terminal" | null;
  outcome: string | null;
  review: LiveTaskReview | null;
  reviewPlan: LiveTaskReviewPlan | null;
  reviewSpend: LiveTaskReviewSpend | null;
  reviewReport: LiveReviewReport | null;
  logTail: string[];
}

export interface LiveTaskSnapshot {
  generatedAt: string;
  taskId: string;
  task: LiveTaskItem | null;
  runs: LiveTaskRun[];
  maxTurns: number | null;
}

/** One progress event as the tail route returns it (hench `RunEvent` plus its line number). */
export interface RunEventLine {
  seq: number;
  kind: string;
  at: string;
  summary: string;
  turn?: number;
  detail?: string;
  counts?: Record<string, number>;
  ok?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Event tail cadence without a socket — the "within a second" bound. */
const EVENTS_POLL_MS = 1_000;
/** Re-tail cadence with a socket: well inside the server's 60 s watch lease. */
const SOCKET_RETAIL_MS = 20_000;
/** Snapshot backstop poll while the run is going, and once it has finished. */
const SNAPSHOT_POLL_RUNNING_MS = 5_000;
const SNAPSHOT_POLL_IDLE_MS = 30_000;
/** Frames can arrive several times a second; the snapshot need not follow each. */
const MIN_SNAPSHOT_REFETCH_MS = 1_000;
/** Pages of events read in one go before yielding (each page is up to 1000). */
const MAX_EVENT_PAGES = 20;

export interface LiveTaskData {
  snapshot: LiveTaskSnapshot | null;
  /** The run `pick` chose, as of the latest snapshot. */
  run: LiveTaskRun | null;
  /** The snapshot request failed (server down, or the task route refused). */
  error: string | null;
  /** Events of `runId` in order, or empty before the first answer. */
  events: RunEventLine[];
  /** False when the run has no event stream (recorded before it existed); null until known. */
  eventsAvailable: boolean | null;
  socketOpen: boolean;
  refresh: () => Promise<void>;
}

function isSnapshot(data: unknown): data is LiveTaskSnapshot {
  const d = data as Partial<LiveTaskSnapshot> | null;
  return !!d && typeof d.taskId === "string" && Array.isArray(d.runs);
}

/**
 * @param taskId The task whose page this is.
 * @param pick Which of the task's runs to follow, given the latest snapshot.
 *   Called on every render, so a change of choice takes effect at once.
 */
export function useLiveTask(taskId: string, pick: (snapshot: LiveTaskSnapshot) => LiveTaskRun | null): LiveTaskData {
  const [snapshot, setSnapshot] = useState<LiveTaskSnapshot | null>(null);
  const run = snapshot ? pick(snapshot) : null;
  const runId = run?.runId ?? null;
  // A finished run is read to the end once; only a running one is followed.
  const running = run?.status === "running";
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEventLine[]>([]);
  const [eventsAvailable, setEventsAvailable] = useState<boolean | null>(null);
  const [socketOpen, setSocketOpen] = useState(false);

  const mountedRef = useRef(true);
  const lastSnapshotRef = useRef(0);
  // The events cursor belongs to one run; a request for an earlier run that
  // lands after a switch must not write into the new run's list.
  const tailRef = useRef<{ runId: string | null; cursor: number; inFlight: boolean; again: boolean }>(
    { runId: null, cursor: 0, inFlight: false, again: false },
  );
  const runIdRef = useRef(runId);
  runIdRef.current = runId;

  const fetchSnapshot = useCallback(async () => {
    lastSnapshotRef.current = Date.now();
    try {
      const res = await fetch(`/api/live/task/${encodeURIComponent(taskId)}`);
      const json: unknown = await res.json().catch(() => null);
      if (!mountedRef.current) return;
      if (res.ok && isSnapshot(json)) {
        setSnapshot(json);
        setError(null);
      } else {
        setError((json as { error?: string } | null)?.error ?? `Could not load the task (HTTP ${res.status})`);
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Could not load the task");
    }
  }, [taskId]);

  const fetchEvents = useCallback(async () => {
    const tail = tailRef.current;
    const id = runIdRef.current;
    if (!id || tail.runId !== id) return;
    if (tail.inFlight) { tail.again = true; return; }
    tail.inFlight = true;
    try {
      for (let page = 0; page < MAX_EVENT_PAGES; page++) {
        const res = await fetch(`/api/hench/runs/${encodeURIComponent(id)}/events?after=${tail.cursor}`);
        if (!mountedRef.current || tailRef.current !== tail || tail.runId !== id) return;
        if (!res.ok) {
          // 404: no record, or a refused path — either way there is no stream to show.
          setEventsAvailable(false);
          return;
        }
        const body = await res.json() as { available?: boolean; events?: RunEventLine[]; next?: number; more?: boolean };
        if (!mountedRef.current || tailRef.current !== tail || tail.runId !== id) return;
        setEventsAvailable(body.available !== false);
        const fresh = Array.isArray(body.events) ? body.events : [];
        if (typeof body.next === "number") tail.cursor = body.next;
        if (fresh.length > 0) setEvents((prev) => [...prev, ...fresh]);
        if (!body.more) break;
      }
    } catch {
      // Unreachable for now: the next frame or poll tries again from the same cursor.
    } finally {
      tail.inFlight = false;
      if (tail.again && mountedRef.current && tailRef.current === tail) {
        tail.again = false;
        void fetchEvents();
      }
    }
  }, []);

  // A new run starts a new list from the top.
  useEffect(() => {
    tailRef.current = { runId, cursor: 0, inFlight: false, again: false };
    setEvents([]);
    setEventsAvailable(null);
    if (runId) void fetchEvents();
  }, [runId, fetchEvents]);

  // A run that just finished: read once more for its last events.
  useEffect(() => {
    if (!running && runIdRef.current) void fetchEvents();
  }, [running, fetchEvents]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchSnapshot();

    let ws: WebSocket | null = null;
    const pipeline = createWSPipeline({
      workspace: getWorkspaceKey(),
      onFlush: (batch) => {
        if (!mountedRef.current) return;
        const current = runIdRef.current;
        let snapshotDue = batch.types.has("live:changed") || batch.types.has("hench:run-changed");
        for (const msg of batch.messages) {
          if (msg.type !== "hench:run-appended" || msg.runId !== current) continue;
          if (msg.stream === "events") void fetchEvents();
          else snapshotDue = true; // the log grew: the tail under the steps moves
        }
        if (snapshotDue && Date.now() - lastSnapshotRef.current >= MIN_SNAPSHOT_REFETCH_MS) void fetchSnapshot();
      },
      // No throttled types: frames go straight to the coalescer, whose short
      // window is the only delay between an append and its fetch.
      coalescerWindowMs: 100,
    });
    try {
      ws = new WebSocket(getWebSocketUrl());
      ws.onopen = () => { if (mountedRef.current) setSocketOpen(true); };
      ws.onclose = () => { if (mountedRef.current) setSocketOpen(false); };
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
  }, [fetchSnapshot, fetchEvents]);

  // Polls go through raw timers rather than the visibility-aware poller: a
  // page left open in a background tab must keep its watch lease, or it comes
  // back to a stream that stopped announcing.
  useEffect(() => {
    if (!running || !runId) return;
    const id = setInterval(() => { void fetchEvents(); }, socketOpen ? SOCKET_RETAIL_MS : EVENTS_POLL_MS);
    return () => clearInterval(id);
  }, [running, runId, socketOpen, fetchEvents]);

  useEffect(() => {
    const id = setInterval(() => { void fetchSnapshot(); }, running ? SNAPSHOT_POLL_RUNNING_MS : SNAPSHOT_POLL_IDLE_MS);
    return () => clearInterval(id);
  }, [running, fetchSnapshot]);

  return { snapshot, run, error, events, eventsAvailable, socketOpen, refresh: fetchSnapshot };
}
