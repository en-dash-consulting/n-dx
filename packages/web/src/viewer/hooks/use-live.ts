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

import { useState, useEffect } from "preact/hooks";
import { getWebSocketUrl, getWorkspaceKey } from "../base-path.js";
import { registerPoller } from "../polling/index.js";
import { createWSPipeline } from "./use-gateway.js";

// ---------------------------------------------------------------------------
// Shape — the slice of server/routes-live.ts's LiveSnapshot the tab reads
// ---------------------------------------------------------------------------

/** Mirrors LiveWorktree in server/routes-live.ts. */
export interface LiveWorktreeRef {
  key: string;
  isAnchor: boolean;
}

/** Whether a run's process is actually executing — mirrors RunLiveness in server/run-liveness.ts. */
export type RunLiveness = "live" | "foreign" | "unknown" | "orphaned";

/** Mirrors the fields of LiveRun in server/routes-live.ts that the peek shows. */
export interface LiveRunSummary {
  runId: string;
  taskId: string | null;
  taskTitle: string | null;
  branch: string | null;
  worktree: LiveWorktreeRef;
  startedAt: string | null;
  stale: boolean;
  /** False when the recorded pid no longer exists; null/absent when unknown. Does not affect `stale`. */
  pidAlive?: boolean | null;
  lastProgress: string | null;
  /** The server's verdict on whether a process is running it; absent from older servers, null once finished. */
  liveness?: RunLiveness | null;
  /** Why the verdict is what it is — shown next to the badge. */
  livenessReason?: string | null;
  /** Whether the run may be ended from the dashboard (never true for a foreign run). */
  canEnd?: boolean | null;
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

/** Mirrors LiveWorktree in server/routes-live.ts. */
export interface LiveWorktreeFull extends LiveWorktreeRef {
  name: string;
  path: string;
  branch: string | null;
  isServed: boolean;
}

export interface LiveChainLink {
  id: string;
  title: string;
  level: string;
}

/** Mirrors LiveRun in server/routes-live.ts. */
export interface LiveRunFull extends LiveRunSummary {
  epicChain: LiveChainLink[];
  status: string;
  worktree: LiveWorktreeFull;
  finishedAt: string | null;
  turns: number | null;
  tokens: { input: number; output: number; cacheCreationInput: number; cacheReadInput: number; total: number };
  model: string | null;
  vendor: string | null;
  criteriaTotal: number | null;
  /** Milliseconds since the last heartbeat, or null when none was recorded. */
  heartbeatAgeMs: number | null;
}

/** The slice of the server's AnalyzeProgressReport the Live overview reads. */
export interface LiveAnalyzeProgressFull extends LiveAnalyzeProgress {
  pass: { number: number; label: string } | null;
}

/** Mirrors LiveJob in server/routes-live.ts. */
export interface LiveJobFull extends LiveJobSummary {
  worktree: LiveWorktreeFull | null;
  progress: LiveAnalyzeProgressFull | null;
}

export interface LiveNextTask {
  id: string;
  title: string;
  priority: string | null;
  epicChain: LiveChainLink[];
}

/** Mirrors LiveSnapshot in server/routes-live.ts — what `GET /api/live` answers. */
export interface LiveSnapshot extends LiveSummary {
  generatedAt: string;
  runs: LiveRunFull[];
  jobs: LiveJobFull[];
  queue: {
    next: LiveNextTask[];
    starting: Array<{ taskId: string; taskTitle: string; startedAt: string; worktree: LiveWorktreeFull }>;
  };
  machine: {
    /** `machine`: the hub's admission gate; `repository`: live runs in every worktree. */
    slots: { scope: "machine" | "repository"; inUse: number; max: number; available: number; queued: number };
    /** `freeBytes` is the shared available-memory reading; null when the machine could not be read. */
    memory: { freeBytes: number | null; totalBytes: number; floorBytes: number | null; belowFloor: boolean };
    llm: { vendor: string | null; model: string | null };
    worktrees: { total: number; withLiveRun: number };
    spend: { todayUsd: number; todayTokens: number; inFlightUsd: number; inFlightTokens: number };
  };
  recent: LiveRunFull[];
}

/** A sourcevision analysis, by either of the two kinds that run one. */
export function isAnalysisJob(job: Pick<LiveJobSummary, "kind">): boolean {
  return job.kind === "analyze" || job.kind === "sv-analyze";
}

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

export type LiveTabState = "idle" | "running" | "attention";

/** No process is executing the run, though its record still says running. */
export function isDeadRun(run: Pick<LiveRunSummary, "liveness">): boolean {
  return run.liveness === "orphaned";
}

/**
 * Whether a run counts as executing: not abandoned (`orphaned`) and not another
 * machine's (`foreign`). `unknown` counts — the process may still be running.
 * Mirrors the server's `withLiveRun` rule so the two never disagree.
 */
export function countsAsLive(run: Pick<LiveRunSummary, "liveness">): boolean {
  return run.liveness !== "orphaned" && run.liveness !== "foreign";
}

/** Runs executing now (no analyses), by verdict rather than by the record's status. */
export function liveRunCount(live: LiveSummary | null): number {
  return live ? live.runs.filter(countsAsLive).length : 0;
}

/** Stuck, dead, or impossible to verify: something an operator should look at. */
export function needsAttention(run: Pick<LiveRunSummary, "stale" | "liveness">): boolean {
  return run.stale || run.liveness === "orphaned" || run.liveness === "unknown";
}

/** The verdict as a badge, or null for a run that is simply live (or has no verdict). */
export function livenessBadge(liveness: RunLiveness | null | undefined): { label: string; mod: RunLiveness } | null {
  switch (liveness) {
    case "orphaned": return { label: "Not running", mod: "orphaned" };
    case "unknown": return { label: "Unverified", mod: "unknown" };
    case "foreign": return { label: "Other machine", mod: "foreign" };
    default: return null;
  }
}

/** The short flag for a run needing attention: the verdict when there is one, else "stuck". */
export function attentionFlag(run: Pick<LiveRunSummary, "stale" | "liveness">): string | null {
  if (run.liveness === "orphaned") return "not running";
  if (run.liveness === "unknown") return "unverified";
  return run.stale ? "stuck" : null;
}

/**
 * Runs and jobs both count: the tab's number is everything in flight. A run no
 * process here is executing (orphaned, or recorded on another host) is not in
 * flight, whatever its record says — so runs are counted by verdict, never as
 * `counts.running`, which includes those records.
 */
export function liveRunningCount(live: LiveSummary | null): number {
  if (!live) return 0;
  return liveRunCount(live) + live.counts.jobs;
}

/** Stuck runs, plus dead or unverifiable ones the stale count does not already include. */
export function liveStuckCount(live: LiveSummary | null): number {
  if (!live) return 0;
  return live.counts.stale + live.runs.filter((r) => !r.stale && needsAttention(r)).length;
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

/** The answer as the full snapshot, or null when it lacks the overview's fields. */
export function asLiveSnapshot(live: LiveSummary | null): LiveSnapshot | null {
  const d = live as Partial<LiveSnapshot> | null;
  if (!d || typeof d.generatedAt !== "string" || !d.machine || !d.queue || !Array.isArray(d.recent)) return null;
  return live as LiveSnapshot;
}

/** How the feed is staying current: over the socket, over the poll alone, or not at all. */
export type LiveConnection = "live" | "polling" | "offline";

export interface LiveFeed {
  live: LiveSummary | null;
  connection: LiveConnection;
  /** Fetch now, ahead of the socket and the poll — after an action that changes what is running. */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// The shared feed
//
// The tab, the bottom bar, the running-now bar and the overview all read the
// same answer, often at once. One module-level feed serves them all: the first
// subscriber opens one socket, one poller and makes the first fetch; the last
// one to leave closes them. Per-component feeds shared the poller key "live",
// so the first to unmount stopped the poll for the rest.
// ---------------------------------------------------------------------------

/** The socket's reconnect delay doubles from the first to the cap, and resets once it opens. */
const RECONNECT_FIRST_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface FeedState {
  live: LiveSummary | null;
  reachable: boolean;
  socketOpen: boolean;
}

const IDLE_FEED: FeedState = { live: null, reachable: true, socketOpen: false };

let feed: FeedState = IDLE_FEED;
const subscribers = new Set<(state: FeedState) => void>();
let stopFeed: (() => void) | null = null;
let lastFetchAt = 0;
/** Bumped on every stop, so an answer that lands after the last subscriber left is dropped. */
let feedGeneration = 0;

function setFeed(next: Partial<FeedState>): void {
  feed = { ...feed, ...next };
  for (const notify of subscribers) notify(feed);
}

/** Fetch now. Does nothing while no component reads the feed. */
async function fetchLive(): Promise<void> {
  if (!stopFeed) return;
  const generation = feedGeneration;
  lastFetchAt = Date.now();
  let next: Partial<FeedState>;
  try {
    const res = await fetch("/api/live");
    if (res.ok) {
      const json: unknown = await res.json();
      next = { live: isLiveSummary(json) ? json : null, reachable: true };
    } else {
      next = { live: null, reachable: false };
    }
  } catch {
    // Unreachable server: the tab reads as idle until the next tick.
    next = { live: null, reachable: false };
  }
  if (generation === feedGeneration) setFeed(next);
}

/** Open the socket, the pipeline and the poll; returns what closes them. */
function startFeed(): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = RECONNECT_FIRST_MS;

  const pipeline = createWSPipeline({
    workspace: getWorkspaceKey(),
    onFlush: (batch) => {
      if (stopped || !batch.types.has("live:changed")) return;
      if (Date.now() - lastFetchAt < MIN_REFETCH_INTERVAL_MS) return;
      void fetchLive();
    },
    defaultDelayMs: 250,
  });

  const connect = (isReconnect: boolean): void => {
    if (typeof WebSocket === "undefined") return; // no socket at all: the poll carries it
    try {
      ws = new WebSocket(getWebSocketUrl());
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      reconnectDelay = RECONNECT_FIRST_MS;
      setFeed({ socketOpen: true });
      // Frames sent while the socket was down are gone: catch up now.
      if (isReconnect) void fetchLive();
    };
    ws.onclose = () => {
      ws = null;
      if (stopped) return;
      setFeed({ socketOpen: false });
      scheduleReconnect();
    };
    ws.onmessage = (event) => {
      try {
        pipeline.push(JSON.parse(event.data));
      } catch {
        // Malformed frame — the poll still catches up.
      }
    };
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer !== null) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(true);
    }, delay);
  };

  connect(false);
  const unregisterPoll = registerPoller("live", () => { void fetchLive(); }, POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    unregisterPoll();
    pipeline.dispose();
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  };
}

function subscribe(notify: (state: FeedState) => void): () => void {
  subscribers.add(notify);
  if (!stopFeed) {
    stopFeed = startFeed();
    void fetchLive();
  }
  notify(feed);
  return () => {
    subscribers.delete(notify);
    if (subscribers.size > 0 || !stopFeed) return;
    const stop = stopFeed;
    stopFeed = null;
    feedGeneration++;
    feed = IDLE_FEED;
    stop();
  };
}

/**
 * The live snapshot, or null until the first answer (and after a failed one —
 * a tab that cannot reach the endpoint reads as idle rather than stale).
 * `enabled: false` makes no request at all, for a static export with no server.
 */
export function useLive(enabled = true): LiveSummary | null {
  return useLiveFeed(enabled).live;
}

/** {@link useLive} plus how the answer is being kept current. */
export function useLiveFeed(enabled = true): LiveFeed {
  const [state, setState] = useState<FeedState>(() => (enabled ? feed : IDLE_FEED));

  useEffect(() => {
    if (!enabled) {
      setState(IDLE_FEED);
      return;
    }
    return subscribe(setState);
  }, [enabled]);

  const connection: LiveConnection = !state.reachable ? "offline" : state.socketOpen ? "live" : "polling";
  return { live: state.live, connection, refresh: fetchLive };
}
