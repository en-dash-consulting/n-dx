/**
 * Workspaces Overview — every worktree of this repository, on one board.
 *
 * A machine strip of four stat tiles sits above a grid of worktree cards.
 * Each card carries the worktree's branch, its live hench run (or the last
 * one), how many files are uncommitted, how far its PRD has drifted from the
 * anchor's, and the three actions that matter: open it, start working in it,
 * stop what is running in it.
 *
 * ## Why this view fetches per workspace
 *
 * Almost every dashboard endpoint answers for *one* workspace — the one the
 * request addressed. This view is the exception: it is about all of them. So
 * it addresses each worktree explicitly with the `X-Ndx-Workspace` header
 * (see {@link workspaceFetch}) rather than the `/w/<key>/` URL slot, because
 * the slot is already spent on whichever workspace the viewer itself is
 * mounted under and the header wins over it server-side.
 *
 * Three endpoints answer for every worktree at once and are fetched plainly:
 * `/api/workspaces` (the registry's keys), `/api/worktrees` (git state and
 * run counts) and `/api/hench/memory` (the machine's memory, not a
 * worktree's). The per-workspace fetches are the execution status, the
 * concurrency count, and the PRD delta.
 *
 * ## Why this view does not filter WebSocket frames
 *
 * Every other consumer calls `acceptsFrame` to drop frames about other
 * worktrees. This one wants exactly those frames: a run progressing in
 * worktree B is what makes B's card move while the viewer sits on A. So it
 * reads the `workspace` tag and routes the frame to the matching card
 * ({@link frameWorkspace}); an untagged frame means the anchor, which is what
 * a server predating tags meant.
 *
 * @module web/viewer/views/workspaces
 */

import { h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ViewId } from "../types.js";
import { detectBasePath } from "../external.js";
import { getWebSocketUrl, getWorkspaceKey } from "../base-path.js";
import { ElapsedTime, StartTaskButton, GlossaryLine } from "../components/index.js";
import { formatSince } from "../utils/format.js";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** One entry of `GET /api/workspaces`. */
export interface WorkspaceSummary {
  key: string;
  path: string;
  branch: string | null;
  isAnchor: boolean;
  active: boolean;
}

/** One entry of `GET /api/worktrees`. */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
  dirty: boolean | null;
  dirtyFiles: number | null;
  runs: { total: number; running: number; lastFinishedAt: string | null };
  server: { pidFile: boolean; pid: number | null; port: number | null };
}

/** The counts half of `GET /api/workspaces/:key/prd-delta`. */
export interface PrdDeltaCounts {
  onlyHere: number;
  onlyAnchor: number;
  changed: number;
  completedHere: number;
}

/** One entry of `GET /api/hench/execute/status`. */
export interface ExecutionStatus {
  taskId: string;
  taskTitle: string;
  runId: string;
  status: "starting" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  lastOutput?: string;
  tokensPerSecond?: number;
  error?: string;
}

/** The subset of `GET /api/hench/memory` the machine strip reads. */
export interface MemoryStatus {
  system: { totalBytes: number; usedBytes: number; usedPercent: number };
}

/** The subset of `GET /api/rex/next`'s task the Start working action needs. */
export interface NextTask {
  id: string;
  title: string;
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

/** One worktree, as the board renders it. */
export interface WorkspaceCard {
  key: string;
  path: string;
  branch: string | null;
  isAnchor: boolean;
  /** The workspace this viewer is itself mounted under. */
  isCurrent: boolean;
  dirtyFiles: number | null;
  runs: { total: number; running: number; lastFinishedAt: string | null };
  /** Null for the anchor (there is nothing to compare it against) and until the delta loads. */
  delta: PrdDeltaCounts | null;
  /** The execution to show live, or null when nothing is running here. */
  live: ExecutionStatus | null;
  /** That workspace's next actionable task — what "Start working" would pick up. */
  nextTask: NextTask | null;
}

/** The four tiles of the machine strip. */
export interface MachineStats {
  agentsRunning: number;
  memory: MemoryStatus["system"] | null;
  uncommittedTrees: number;
  prdOnlyOnBranches: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Which workspace a WebSocket frame is about.
 *
 * `"*"` is a process-wide frame (machine memory, socket health) and belongs
 * to no single card; an untagged frame is the anchor's, which is what a
 * server predating workspace tags meant by it.
 */
export function frameWorkspace(frame: Readonly<Record<string, unknown>>, anchorKey: string): string | null {
  const tag = frame["workspace"];
  if (tag === undefined || tag === null) return anchorKey;
  if (tag === "*") return null;
  return typeof tag === "string" ? tag : null;
}

/** The execution a card should show: a live one, else nothing. Newest start wins. */
export function pickLiveExecution(executions: readonly ExecutionStatus[]): ExecutionStatus | null {
  const live = executions.filter((e) => e.status === "running" || e.status === "starting");
  if (live.length === 0) return null;
  return live.reduce((newest, e) => (Date.parse(e.startedAt) > Date.parse(newest.startedAt) ? e : newest));
}

/**
 * Join the registry's workspaces with git state, PRD deltas and live runs.
 *
 * Worktrees are matched to registry entries **by path**, not by key: the
 * registry derives keys from basenames and two worktrees can share one.
 * Ordering is anchor first, then by key, so a card does not move when a run
 * starts.
 */
export function buildWorkspaceCards(
  workspaces: readonly WorkspaceSummary[],
  worktrees: readonly WorktreeEntry[],
  deltas: ReadonlyMap<string, PrdDeltaCounts>,
  executions: ReadonlyMap<string, readonly ExecutionStatus[]>,
  nextTasks: ReadonlyMap<string, NextTask>,
  currentKey: string | null,
): WorkspaceCard[] {
  const byPath = new Map(worktrees.map((w) => [w.path, w]));
  const cards = workspaces.map((ws): WorkspaceCard => {
    const wt = byPath.get(ws.path);
    return {
      key: ws.key,
      path: ws.path,
      branch: wt?.branch ?? ws.branch,
      isAnchor: ws.isAnchor,
      isCurrent: currentKey === null ? ws.isAnchor : ws.key === currentKey,
      dirtyFiles: wt?.dirtyFiles ?? null,
      runs: wt?.runs ?? { total: 0, running: 0, lastFinishedAt: null },
      delta: ws.isAnchor ? null : deltas.get(ws.key) ?? null,
      live: pickLiveExecution(executions.get(ws.key) ?? []),
      nextTask: nextTasks.get(ws.key) ?? null,
    };
  });
  return cards.sort((a, b) => {
    if (a.isAnchor !== b.isAnchor) return a.isAnchor ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Roll the cards up into the machine strip.
 *
 * `agentsRunning` prefers each workspace's concurrency count (which reads
 * cross-process lock files, so it sees agents this dashboard did not start)
 * and falls back to the run count `/api/worktrees` derived from disk when
 * concurrency could not be asked for that workspace.
 *
 * Whichever source answers, the count is never below the number of live
 * executions the cards are showing: a strip reading "0 agents running" next
 * to a card with a spinning run is worse than a slightly high number, and
 * the two sources are read at different moments.
 */
export function machineStats(
  cards: readonly WorkspaceCard[],
  concurrency: ReadonlyMap<string, number>,
  memory: MemoryStatus | null,
): MachineStats {
  let agentsRunning = 0;
  let uncommittedTrees = 0;
  let prdOnlyOnBranches = 0;
  for (const card of cards) {
    const counted = concurrency.get(card.key) ?? card.runs.running;
    agentsRunning += Math.max(counted, card.live ? 1 : 0);
    if ((card.dirtyFiles ?? 0) > 0) uncommittedTrees++;
    prdOnlyOnBranches += card.delta?.onlyHere ?? 0;
  }
  return { agentsRunning, memory: memory?.system ?? null, uncommittedTrees, prdOnlyOnBranches };
}

/** `location.pathname`, or `/` where there is no document (tests, SSR). */
function currentPathname(): string {
  return typeof location === "undefined" ? "/" : location.pathname;
}

/** Where a workspace's dashboard lives: the hub's project prefix, then `/w/<key>` off the anchor. */
export function workspaceViewUrl(card: Pick<WorkspaceCard, "key" | "isAnchor">, view: ViewId, pathname: string): string {
  const project = detectBasePath(pathname);
  const slot = card.isAnchor ? "" : `/w/${encodeURIComponent(card.key)}`;
  return `${project}${slot}/${view}`;
}

/** "1.2 GB", "840 MB" — byte counts for the memory tile. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** "4m 12s" — elapsed since an ISO timestamp, for the live run block. */
export function formatElapsed(startedAt: string): string {
  const ms = Date.now() - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The card's one-word state, and the tone class that colours it. */
export function cardStatus(card: WorkspaceCard): { label: string; tone: "running" | "idle" } {
  const running = card.live !== null || card.runs.running > 0;
  return running ? { label: "Running", tone: "running" } : { label: "Idle", tone: "idle" };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

type Fetcher = typeof fetch;

/** Frame types that can move a card or a tile. Anything else is ignored. */
const LIVE_FRAME_TYPES = new Set([
  "hench:task-execution-progress",
  "hench:run-changed",
  "hench:memory-status",
]);

/** How long a burst of frames is collapsed before the board reloads. */
const LIVE_REFRESH_DEBOUNCE_MS = 400;

/** The per-workspace answers held between loads. */
interface WorkspaceSlices {
  deltas: Map<string, PrdDeltaCounts>;
  executions: Map<string, readonly ExecutionStatus[]>;
  concurrency: Map<string, number>;
  nextTasks: Map<string, NextTask>;
  /** Keys whose slice has been fetched at least once. */
  loaded: Set<string>;
}

function emptySlices(): WorkspaceSlices {
  return {
    deltas: new Map(), executions: new Map(), concurrency: new Map(),
    nextTasks: new Map(), loaded: new Set(),
  };
}

/** Drop entries for worktrees that no longer exist, in place. */
function pruneSlices(slices: WorkspaceSlices, known: ReadonlySet<string>): WorkspaceSlices {
  for (const key of slices.loaded) {
    if (known.has(key)) continue;
    slices.deltas.delete(key);
    slices.executions.delete(key);
    slices.concurrency.delete(key);
    slices.nextTasks.delete(key);
    slices.loaded.delete(key);
  }
  return slices;
}

/**
 * Address one workspace explicitly.
 *
 * The header is used rather than a `/w/<key>/` path because the viewer's own
 * base path may already carry a slot, and the server reads the header first.
 */
function workspaceFetch(doFetch: Fetcher, key: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Ndx-Workspace", key);
  return doFetch(path, { ...init, headers });
}

async function readJson<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Fetch one workspace's four answers into `into`. Absent answers leave the previous value. */
async function loadSlice(doFetch: Fetcher, ws: WorkspaceSummary, into: WorkspaceSlices): Promise<void> {
  const [execRes, concRes, nextRes] = await Promise.all([
    workspaceFetch(doFetch, ws.key, "/api/hench/execute/status"),
    workspaceFetch(doFetch, ws.key, "/api/hench/concurrency"),
    workspaceFetch(doFetch, ws.key, "/api/rex/next"),
  ]);
  const exec = await readJson<{ executions: ExecutionStatus[] }>(execRes);
  if (exec) into.executions.set(ws.key, exec.executions);
  const conc = await readJson<{ totalRunning: number }>(concRes);
  if (conc && typeof conc.totalRunning === "number") into.concurrency.set(ws.key, conc.totalRunning);
  const next = await readJson<{ task: NextTask | null }>(nextRes);
  if (next) {
    if (next.task) into.nextTasks.set(ws.key, next.task);
    else into.nextTasks.delete(ws.key);
  }
  // The anchor is what every delta is measured against, so it has none.
  if (!ws.isAnchor) {
    const delta = await readJson<{ counts: PrdDeltaCounts }>(
      await doFetch(`/api/workspaces/${encodeURIComponent(ws.key)}/prd-delta`),
    );
    if (delta) into.deltas.set(ws.key, delta.counts);
  }
  into.loaded.add(ws.key);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatTile({ value, label, title }: { value: string; label: string; title?: string }) {
  return h("div", { class: "stat-card", title },
    h("div", { class: "value" }, value),
    h("div", { class: "label" }, label),
  );
}

function MachineStrip({ stats }: { stats: MachineStats }) {
  const memory = stats.memory;
  return h("div", { class: "stat-grid workspaces-machine-strip", role: "group", "aria-label": "Machine totals" },
    h(StatTile, {
      value: String(stats.agentsRunning),
      label: stats.agentsRunning === 1 ? "agent running" : "agents running",
    }),
    h(StatTile, {
      value: memory ? `${Math.round(memory.usedPercent)}%` : "—",
      label: memory ? `memory in use · ${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)}` : "memory in use",
      title: memory ? `${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)}` : undefined,
    }),
    h(StatTile, {
      value: String(stats.uncommittedTrees),
      label: stats.uncommittedTrees === 1 ? "uncommitted tree" : "uncommitted trees",
    }),
    h(StatTile, {
      value: String(stats.prdOnlyOnBranches),
      label: "PRD items only on branches",
      title: "Items present in a branch worktree's PRD but not in the anchor's",
    }),
  );
}

function LiveRun({ card, live, onStop, stopping }: {
  card: WorkspaceCard;
  live: ExecutionStatus;
  onStop: () => void;
  stopping: boolean;
}) {
  return h("div", { class: "workspace-card-run" },
    h("div", { class: "workspace-card-run-title-row" },
      h("span", { class: "active-task-pulse-wrapper", "aria-hidden": "true" },
        h("span", { class: `active-task-pulse${live.status === "starting" ? " active-task-pulse-starting" : ""}` }),
      ),
      // A deep link into *that* workspace's PRD, not this viewer's: the task
      // is in the other worktree's tree, so an in-app navigate would open the
      // wrong one (or nothing).
      h("a", {
        class: "workspace-card-run-title workspace-card-run-link",
        href: `${workspaceViewUrl(card, "prd", currentPathname())}/${encodeURIComponent(live.taskId)}`,
        title: live.taskTitle,
      }, live.taskTitle),
    ),
    h("div", { class: "active-task-meta workspace-card-run-meta" },
      h(ElapsedTime, {
        startedAt: live.startedAt,
        formatter: formatElapsed,
        class: "active-task-elapsed",
        title: `Started ${live.startedAt}`,
      }),
      h("span", { class: "active-task-model" }, live.status === "starting" ? "starting" : "running"),
      live.tokensPerSecond !== undefined
        ? h("span", { class: "active-task-toks" }, `⚡ ${live.tokensPerSecond.toFixed(1)} tok/s`)
        : null,
      h("button", {
        type: "button",
        class: "workspace-card-stop",
        disabled: stopping,
        onClick: onStop,
        "aria-label": `Stop the run in ${card.key}`,
      }, stopping ? "Stopping…" : "Stop"),
    ),
    live.lastOutput
      ? h("div", { class: "workspace-card-output" },
          h("code", { class: "workspace-card-output-text" }, live.lastOutput),
        )
      : null,
  );
}

function WorkspaceCardView({ card, doFetch, onChanged }: {
  card: WorkspaceCard;
  doFetch: Fetcher;
  onChanged: () => void;
}) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = cardStatus(card);
  const headingId = `workspace-card-${card.key}`;
  const since = formatSince(card.runs.lastFinishedAt);

  const stop = useCallback(async () => {
    if (!card.live) return;
    setStopping(true);
    setError(null);
    try {
      const res = await workspaceFetch(doFetch, card.key, `/api/hench/execute/${card.live.taskId}/terminate`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Failed (${res.status})`);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop the run");
    } finally {
      setStopping(false);
    }
  }, [card.key, card.live, doFetch, onChanged]);

  return h("section", { class: `workspace-card${card.isCurrent ? " workspace-card-current" : ""}`, "aria-labelledby": headingId },
    h("header", { class: "workspace-card-header" },
      h("h3", { class: "workspace-card-name", id: headingId },
        card.isAnchor
          ? h("span", { class: "workspace-card-anchor", title: "Anchor worktree" }, "★ ")
          : null,
        card.key,
      ),
      h("span", { class: `workspace-card-status workspace-card-status-${status.tone}` }, status.label),
    ),

    h("div", { class: "workspace-card-branch-row" },
      h("code", { class: "workspace-card-branch", title: card.path }, card.branch ?? "detached"),
      card.isCurrent ? h("span", { class: "workspace-card-viewing" }, "you are here") : null,
    ),

    card.live
      ? h(LiveRun, { card, live: card.live, onStop: stop, stopping })
      : h("p", { class: "workspace-card-last-run" },
          since ? `Last run · ${since}` : "No runs recorded here yet",
        ),

    error ? h("p", { class: "workspace-card-error", role: "alert" }, error) : null,

    h("div", { class: "workspace-card-chips" },
      card.dirtyFiles === null
        ? null
        : card.dirtyFiles > 0
          ? h("span", { class: "workspace-card-chip workspace-card-chip-dirty" },
              `${card.dirtyFiles} uncommitted`)
          : h("span", { class: "workspace-card-chip workspace-card-chip-clean" }, "clean"),
      card.delta
        ? h("span", {
            class: "workspace-card-chip workspace-card-chip-prd",
            title: `${card.delta.onlyHere} item(s) only in this worktree's PRD, ${card.delta.changed} changed versus the anchor`,
          }, `PRD · ${card.delta.onlyHere} only here / ${card.delta.changed} changed here`)
        : null,
    ),

    h("div", { class: "workspace-card-actions" },
      h("a", {
        class: "workspace-card-open",
        href: workspaceViewUrl(card, "prd", currentPathname()),
      }, "Open workspace"),
      card.live || !card.nextTask
        ? null
        : h(StartTaskButton, {
            taskId: card.nextTask.id,
            workspace: card.key,
            label: "Start working",
            ariaLabel: `Start working in ${card.key} on ${card.nextTask.title}`,
            onStarted: onChanged,
          }),
    ),
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export interface WorkspacesViewProps {
  /** Injected for tests; defaults to `fetch`. */
  fetcher?: Fetcher;
  /** Injected for tests; defaults to a live WebSocket. */
  socketFactory?: (url: string) => WebSocket;
}

/** Board of worktree cards under a machine strip. */
export function WorkspacesView({ fetcher, socketFactory }: WorkspacesViewProps) {
  const [cards, setCards] = useState<WorkspaceCard[]>([]);
  const [stats, setStats] = useState<MachineStats>({
    agentsRunning: 0, memory: null, uncommittedTrees: 0, prdOnlyOnBranches: 0,
  });
  const [anchorKey, setAnchorKey] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Memoised, not computed inline: `load` depends on it and the load effect
  // depends on `load`, so a fresh closure per render would re-run the whole
  // fetch cascade on every render it caused — an unbounded loop.
  const doFetch = useMemo<Fetcher>(
    () => fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)),
    [fetcher],
  );
  const currentKey = getWorkspaceKey();
  /**
   * Per-workspace state carried between loads, so a frame about one worktree
   * can refresh that worktree's four endpoints and leave the others' answers
   * standing rather than re-asking every workspace on every frame.
   */
  const slices = useRef<WorkspaceSlices>(emptySlices());
  // `load` is re-created whenever `doFetch` identity changes; the socket
  // effect must not resubscribe for that, so it reads the latest through a ref.
  const loadRef = useRef<(only?: string) => void>(() => {});

  /**
   * Reload the board. With `only` set, only that workspace's per-workspace
   * endpoints are re-asked; the repository-wide three (registry, worktrees,
   * machine memory) are always re-read because they are one cheap request
   * each and the machine strip sums across every worktree.
   */
  const load = useCallback(async (only?: string) => {
    try {
      const [wsRes, wtRes, memRes] = await Promise.all([
        doFetch("/api/workspaces"),
        doFetch("/api/worktrees"),
        doFetch("/api/hench/memory"),
      ]);
      const registry = await readJson<{ anchor: string; workspaces: WorkspaceSummary[] }>(wsRes);
      if (!registry) {
        setError("This server does not expose workspaces.");
        setLoading(false);
        return;
      }
      const worktrees = (await readJson<WorktreeEntry[]>(wtRes)) ?? [];
      const memory = await readJson<MemoryStatus>(memRes);
      const known = new Set(registry.workspaces.map((ws) => ws.key));
      const held = pruneSlices(slices.current, known);
      const stale = registry.workspaces.filter(
        (ws) => only === undefined || ws.key === only || !held.loaded.has(ws.key),
      );
      await Promise.all(stale.map((ws) => loadSlice(doFetch, ws, held)));
      slices.current = held;

      const built = buildWorkspaceCards(
        registry.workspaces, worktrees, held.deltas, held.executions, held.nextTasks, currentKey,
      );
      setAnchorKey(registry.anchor);
      setCards(built);
      setStats(machineStats(built, held.concurrency, memory));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }, [doFetch, currentKey]);

  useEffect(() => {
    loadRef.current = (only?: string) => void load(only);
    void load();
  }, [load]);

  // Live updates. Unlike every other socket consumer this one keeps frames
  // about *other* workspaces — they are the point of the board.
  useEffect(() => {
    if (!anchorKey) return;
    let socket: WebSocket;
    try {
      socket = socketFactory ? socketFactory(getWebSocketUrl()) : new WebSocket(getWebSocketUrl());
    } catch {
      return; // No socket (static export, jsdom): the board stays as loaded.
    }
    // Frames arrive in bursts (a run turn emits several); collapse a burst
    // into one reload, and widen it to a full reload as soon as two different
    // workspaces are in the same burst.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: string | null | undefined;
    const refresh = (target: string | null) => {
      pending = pending === undefined ? target : pending === target ? pending : null;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const only = pending;
        pending = undefined;
        loadRef.current(only ?? undefined);
      }, LIVE_REFRESH_DEBOUNCE_MS);
    };
    socket.onmessage = (event: MessageEvent) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!LIVE_FRAME_TYPES.has(String(frame["type"]))) return;
      // `null` means machine-wide (`"*"`) and reloads the whole board. A key
      // naming a worktree no load has fetched yet still gets its slice: `load`
      // always includes workspaces absent from `slices.loaded`, which is how a
      // newly added worktree picks up a card.
      refresh(frameWorkspace(frame, anchorKey));
    };
    return () => {
      if (timer) clearTimeout(timer);
      socket.onmessage = null;
      try { socket.close(); } catch { /* already closing */ }
    };
  }, [anchorKey, socketFactory]);

  const body = useMemo(() => {
    if (loading) return h("p", { class: "workspaces-empty" }, "Loading workspaces…");
    if (error) return h("p", { class: "workspaces-empty", role: "alert" }, error);
    if (cards.length === 0) return h("p", { class: "workspaces-empty" }, "No git worktrees found for this repository.");
    return h("div", { class: "workspaces-grid" },
      cards.map((card) => h(WorkspaceCardView, {
        key: card.key,
        card,
        doFetch,
        onChanged: () => void load(card.key),
      })),
    );
  }, [loading, error, cards, doFetch, load]);

  return h("div", { class: "workspaces-container" },
    h("header", { class: "workspaces-header" },
      h("h2", null, "Workspaces"),
      h("p", { class: "workspaces-subtitle" },
        "Every git worktree of this repository, with what each one is running and how its PRD differs from the anchor's.",
      ),
      h(GlossaryLine, { term: "worktree anchor" }),
    ),
    h(MachineStrip, { stats }),
    body,
  );
}
