/**
 * The Live overview — one read of everything running across the repository.
 *
 * GET /api/live — running hench runs from every worktree, running long jobs,
 * what is queued next, a machine strip, runs finished in the last hour, and
 * the counts the bottom bar and the worktrees pill show.
 *
 * The Live tab's badge, hover peek, overview and running-now switcher all
 * read this one answer, so it is built from sources other surfaces already
 * keep warm rather than derived again:
 *
 * - **Worktrees** — the workspace registry's list (refreshed by the registry
 *   on its own timer; no `git` per request).
 * - **Runs** — `readRunDigests`, the mtime/size-keyed digest cache behind
 *   `GET /api/worktrees`. The pill's running count and this one are the same
 *   sum over the same digests.
 * - **Staleness** — `isRunStale`, the rule `GET /api/status` counts stuck
 *   runs with.
 * - **Liveness** — `judgeRunLiveness` (hench's rules, mirrored in
 *   `run-liveness.ts`) against each worktree's own lock files.
 * - **Jobs** — the dashboard job slots (`commandJobsOf`, `rexAnalyzeJobStatus`)
 *   plus each worktree's `analyze-progress.json`, which is how an analysis
 *   started from a terminal shows up at all.
 * - **Machine** — hench slots (runs judged `live` across every worktree, or
 *   the hub's admission state when proxied through it) and `readSystemMemory`;
 *   the memory floor is the hub's admission floor from the per-user config.
 *
 * The whole answer is cached for {@link LIVE_CACHE_TTL_MS} per served
 * workspace. {@link startLiveMonitor} rebuilds it on a timer and broadcasts a
 * `live:changed` frame when a run or job starts, finishes, or goes stale; the
 * frame announces, the client refetches.
 *
 * Not here yet: hench records no loop position for `--loop` runs, and the
 * execute requests queued by the hub's admission gate are only counted
 * (`machine.slots.queued`), not listed (the viewer polls `/api/hub/queue`).
 *
 * @module web/server/routes-live
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { resolveLayout } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse } from "./response-utils.js";
import type { WebSocketBroadcaster } from "./websocket.js";
import { workspaceKeyOf } from "./workspace-scoped.js";
import { readRunDigests, type RunDigest, type RunDigestTokens } from "./routes-worktrees.js";
import { heartbeatAgeMs, isPidAlive, isRunStale } from "./run-staleness.js";
import {
  collectLiveLocks,
  judgeRunLiveness,
  livenessInputOf,
  locksDirOf,
  summarizeLiveness,
  type LiveLock,
  type LivenessSummary,
  type RunLiveness,
} from "./run-liveness.js";
import {
  concurrencyLevelOf,
  dashboardExecutionsFor,
  getEffectiveMaxConcurrent,
  readSystemMemory,
  type ConcurrencyLevel,
  type MemoryHealthLevel,
  type TaskExecutionStatus,
} from "./routes-hench.js";
import { commandJobsOf, type CommandJobKind } from "./routes-commands.js";
import { rexAnalyzeJobStatus } from "./routes-rex-analysis.js";
import { lastActiveAgentModel, resolveActiveAgentModel } from "./routes-llm.js";
import { analyzeProgressPath, readAnalyzeProgress, type AnalyzeProgressReport, type ProcessCommandLine } from "./domain-gateway.js";
import { collectCompletedIds, estimateCostFromTotals, findNextTask, walkTree } from "./rex-gateway.js";
import type { PRDDocument } from "./rex-gateway.js";
import { loadPRDSync, PRD_CACHE_DIR, PRD_CACHE_JSON } from "./prd-io.js";
import { readLastEvent, resolveRunEventsFile } from "./run-tail.js";
import { hubConfigPath, readHubConfig, resolveHubHome } from "../hub/index.js";
import { HUB_ADMISSION_HEADER, parseHubAdmissionHeader, type HubAdmissionHeader } from "../shared/index.js";

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/** A worktree as the Live overview names it. */
export interface LiveWorktree {
  /** Workspace key — what `/w/<key>/` and `X-Ndx-Workspace` address. */
  key: string;
  /** Directory basename, for a chip. */
  name: string;
  path: string;
  branch: string | null;
  isAnchor: boolean;
  /** The worktree this request was served for. */
  isServed: boolean;
}

/** One ancestor of a task, root (the epic) first. */
export interface LiveChainLink {
  id: string;
  title: string;
  level: string;
}

export interface LiveRun {
  runId: string;
  taskId: string | null;
  taskTitle: string | null;
  /** The task's ancestors in its worktree's PRD, epic first; empty when the PRD does not know it. */
  epicChain: LiveChainLink[];
  status: string;
  /** Branch recorded at run start, else the worktree's current branch. */
  branch: string | null;
  worktree: LiveWorktree;
  startedAt: string | null;
  finishedAt: string | null;
  turns: number | null;
  tokens: RunDigestTokens & { total: number };
  model: string | null;
  vendor: string | null;
  /**
   * Whether this server's dashboard spawned the run. Null once it has
   * finished: the dashboard forgets its executions when they end.
   */
  startedFrom: "dashboard" | "terminal" | null;
  /** Hench process pid; meaningful only while running. */
  pid: number | null;
  /**
   * Whether `pid` still exists on this machine. Null when not running or no pid
   * was recorded (unknown, not dead). Informational: `stale` stays on the
   * shared heartbeat threshold so counts agree with the bottom bar.
   */
  pidAlive: boolean | null;
  lastActivityAt: string | null;
  /** Milliseconds since the last heartbeat, or null when none was recorded. */
  heartbeatAgeMs: number | null;
  /** Running with no heartbeat for the stuck-run threshold (`isRunStale`). Always false once finished. */
  stale: boolean;
  /** Whether the run is actually executing (`run-liveness.ts`); null once finished. */
  liveness: RunLiveness | null;
  /** Why, in words; null once finished. */
  livenessReason: string | null;
  /** Whether ending it is safe without asking (only `orphaned`); null once finished. */
  canEnd: boolean | null;
  /**
   * How many acceptance criteria the task lists in its worktree's PRD, or null
   * when it lists none or the PRD does not know it. How many are met is not
   * recorded while the run is going, so it is not reported.
   */
  criteriaTotal: number | null;
  /** Newest progress event summary, else the dashboard's last stdout line. */
  lastProgress: string | null;
}

export type LiveJobKind = CommandJobKind | "analyze";

export interface LiveJob {
  /** `${kind}:${worktree key}`, or `analyze:server` for the process-wide Project Scan. */
  id: string;
  kind: LiveJobKind;
  /** Null for Project Scan, which is one per server rather than per worktree. */
  worktree: LiveWorktree | null;
  startedAt: string | null;
  /** `terminal` only for an analysis this server did not start, seen through its progress file. */
  startedFrom: "dashboard" | "terminal";
  /** Last output line, or a phase description for an analysis. */
  detail: string | null;
  /** Structured progress — sourcevision analyze only. */
  progress: AnalyzeProgressReport | null;
}

export interface LiveNextTask {
  id: string;
  title: string;
  priority: string | null;
  epicChain: LiveChainLink[];
}

export interface LiveStartingExecution {
  taskId: string;
  taskTitle: string;
  startedAt: string;
  worktree: LiveWorktree;
}

/**
 * Hench slots in use against a cap, and what the count covers.
 *
 * - `machine` — served through the hub: its admission gate's dashboard
 *   sessions across every registered project, against `maxSessions`.
 * - `repository` — standalone: runs judged `live` in any worktree of the
 *   repository, however they were started, against hench's configured limit.
 */
export interface LiveSlots {
  scope: "machine" | "repository";
  inUse: number;
  max: number;
  available: number;
  level: ConcurrencyLevel;
  /** Execute requests the hub has queued; always 0 standalone. */
  queued: number;
}

function liveSlots(scope: LiveSlots["scope"], inUse: number, max: number, queued = 0): LiveSlots {
  return { scope, inUse, max, available: Math.max(0, max - inUse), level: concurrencyLevelOf(inUse, max), queued };
}

/**
 * The slots tile behind the hub: the gate's cap and queue, with in-use never
 * below the repository's live run list. The gate counts only dashboard-started
 * sessions, so a terminal-started run would otherwise be listed but not counted.
 */
function hubSlots(admission: HubAdmissionHeader, repositoryInUse: number): LiveSlots {
  return liveSlots("machine", Math.max(admission.running, repositoryInUse), admission.maxSessions, admission.queued);
}

export interface LiveSnapshot {
  generatedAt: string;
  runs: LiveRun[];
  jobs: LiveJob[];
  queue: {
    /** What `ndx work` would pick next in the served worktree, excluding tasks running anywhere. */
    next: LiveNextTask[];
    /** Dashboard executions spawned but not yet writing a run record. */
    starting: LiveStartingExecution[];
  };
  machine: {
    /** Hench slots, over the scope the run list beside it covers or wider. */
    slots: LiveSlots;
    memory: {
      freeBytes: number;
      totalBytes: number;
      usedPercent: number;
      health: MemoryHealthLevel;
      /** The hub's admission floor: below it, dashboard runs are queued rather than started. */
      floorBytes: number | null;
      belowFloor: boolean;
    };
    llm: { vendor: string | null; model: string | null };
    worktrees: { total: number; withLiveRun: number };
    /** Hench run spend across every worktree, priced with the same table as `ndx usage`. */
    spend: { todayUsd: number; todayTokens: number; inFlightUsd: number; inFlightTokens: number };
  };
  /** Runs that finished in the last {@link RECENT_WINDOW_MS}, newest first. */
  recent: LiveRun[];
  counts: {
    /** Running run files across every worktree — the worktrees pill's number. */
    running: number;
    /** Stale runs among `runs`. */
    stale: number;
    /** Running runs in the served worktree — `GET /api/status` `hench.activeRuns`. */
    servedRunning: number;
    /** Stale runs in the served worktree — the bottom bar's stuck-run number. */
    servedStale: number;
    /** Running jobs. */
    jobs: number;
    /** Liveness verdicts among `runs`. */
    liveness: LivenessSummary;
  };
}

// ---------------------------------------------------------------------------
// Constants & caches
// ---------------------------------------------------------------------------

/** Whole-answer cache: several viewer surfaces read this at once. */
export const LIVE_CACHE_TTL_MS = 1_000;
/** How far back `recent` reaches. */
export const RECENT_WINDOW_MS = 60 * 60 * 1000;
/** How many next tasks `queue.next` lists. */
const NEXT_TASK_LIMIT = 5;
/** How often {@link startLiveMonitor} looks for changes. */
export const LIVE_MONITOR_INTERVAL_MS = 2_000;

/** Where the answer's sources come from; injected by start.ts. */
export interface LiveSources {
  /** Every known worktree, anchor first — the workspace registry's `list()`. */
  listWorkspaces: () => ReadonlyArray<{ key: string; path: string; branch: string | null; isAnchor: boolean }>;
  /** The hub's memory floor in bytes, or null when unknown. Defaults to the per-user hub config. */
  memoryFloorBytes?: () => number | null;
  /** A pid's command line, or null when unknown — tells a reused pid from a live analysis. Defaults to sourcevision's `ps` reader. */
  processCommandLine?: ProcessCommandLine;
}

interface PrdIndex {
  /** The cache file's `mtimeMs:size` when parsed; "absent" when there was none. */
  signature: string;
  chains: Map<string, LiveChainLink[]>;
  /** Acceptance criteria per item, for items that list any. */
  criteria: Map<string, number>;
  doc: PRDDocument | null;
  completedIds: Set<string>;
}

const prdIndexes = new Map<string, PrdIndex>();
const liveCaches = new Map<string, { at: number; snapshot: LiveSnapshot }>();
const analyzeProgressCache = new Map<string, { mtimeMs: number; report: AnalyzeProgressReport | null }>();

/** Clear every cache (tests). */
export function clearLiveCaches(): void {
  prdIndexes.clear();
  liveCaches.clear();
  analyzeProgressCache.clear();
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function defaultMemoryFloor(): number | null {
  try {
    return readHubConfig(hubConfigPath(resolveHubHome())).config.memoryFloorBytes;
  } catch {
    return null;
  }
}

/**
 * One worktree's PRD and its task chains. Parsed again only when
 * `.rex/.cache/prd.json` changes mtime or size, never on a timer.
 *
 * That cache file is the only source read, deliberately: it is what the
 * workspace's watcher keeps in step with `prd_tree/`, and `loadPRDSync` would
 * otherwise fall back to a legacy `prd.md`/`prd.json` that may be long stale.
 * A worktree with no cache file (no live workspace context) has no chains and
 * no next tasks; titles still come from the run records.
 */
function prdIndexFor(rexDir: string): PrdIndex {
  let signature = "absent";
  try {
    const st = statSync(join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON));
    signature = `${st.mtimeMs}:${st.size}`;
  } catch {
    // No cache file — empty index below.
  }
  const cached = prdIndexes.get(rexDir);
  if (cached && cached.signature === signature) return cached;
  const doc = signature === "absent" ? null : loadPRDSync(rexDir);
  const index: PrdIndex = { signature, chains: new Map(), criteria: new Map(), doc, completedIds: doc ? collectCompletedIds(doc.items) : new Set() };
  if (doc) {
    for (const { item, parents } of walkTree(doc.items)) {
      index.chains.set(item.id, parents.map((p) => ({ id: p.id, title: p.title, level: p.level })));
      const criteria = item.acceptanceCriteria?.length ?? 0;
      if (criteria > 0) index.criteria.set(item.id, criteria);
    }
  }
  prdIndexes.set(rexDir, index);
  return index;
}

/**
 * The tasks `ndx work` would pick next, in its order, skipping `excluded`
 * (tasks already running somewhere). Rex's own selection, asked repeatedly
 * with the previous answers excluded, rather than a second ranking.
 */
function nextTasks(index: PrdIndex, excluded: ReadonlySet<string>): LiveNextTask[] {
  if (!index.doc) return [];
  const excludeIds = new Set(excluded);
  const next: LiveNextTask[] = [];
  while (next.length < NEXT_TASK_LIMIT) {
    const entry = findNextTask(index.doc.items, index.completedIds, { excludeIds });
    if (!entry) break;
    excludeIds.add(entry.item.id);
    next.push({
      id: entry.item.id,
      title: entry.item.title,
      priority: entry.item.priority ?? null,
      epicChain: entry.parents.map((p) => ({ id: p.id, title: p.title, level: p.level })),
    });
  }
  return next;
}

/**
 * The worktree's analyze progress. Re-read when the file changes, and always
 * while it claims to be running — its liveness depends on the pid, not on
 * the file. A finished report never changes until the file does.
 */
function analyzeProgressFor(svDir: string, processCommandLine?: ProcessCommandLine): AnalyzeProgressReport | null {
  const cached = analyzeProgressCache.get(svDir);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(analyzeProgressPath(svDir)).mtimeMs;
  } catch {
    analyzeProgressCache.delete(svDir);
    return null;
  }
  if (cached && cached.mtimeMs === mtimeMs && cached.report?.running !== true) return cached.report;
  const report = readAnalyzeProgress(svDir, { processCommandLine });
  analyzeProgressCache.set(svDir, { mtimeMs, report });
  return report;
}

function analyzeDetail(progress: AnalyzeProgressReport): string | null {
  const parts: string[] = [];
  if (progress.phase) parts.push(`phase ${progress.phase.index}/${progress.phase.total} ${progress.phase.name}`);
  if (progress.pass) parts.push(`pass ${progress.pass.number} ${progress.pass.label}`);
  if (progress.batch) parts.push(`${progress.batch.label} ${progress.batch.done}/${progress.batch.total}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function totalTokens(tokens: RunDigestTokens): number {
  return tokens.input + tokens.output + tokens.cacheCreationInput + tokens.cacheReadInput;
}

/** USD for a set of runs, priced per model by rex's table. */
function priceRuns(runs: readonly RunDigest[]): number {
  const byModel: Record<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }> = {};
  const totals = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  for (const run of runs) {
    const bucket = (byModel[run.model ?? "unknown"] ??= { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
    for (const target of [bucket, totals]) {
      target.inputTokens += run.tokens.input;
      target.outputTokens += run.tokens.output;
      target.cacheCreationTokens += run.tokens.cacheCreationInput;
      target.cacheReadTokens += run.tokens.cacheReadInput;
    }
  }
  return runs.length === 0 ? 0 : estimateCostFromTotals(totals, byModel).totalRaw;
}

function startOfLocalDay(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * The run's newest progress line. Its events file is resolved and confined
 * exactly as the events tail route does, so this reads nothing that route
 * would refuse to serve.
 */
function lastProgressOf(
  digest: RunDigest,
  worktreeRoot: string,
  roots: readonly string[],
  execution: TaskExecutionStatus | undefined,
): string | null {
  const run = digest.eventsPath !== null ? { id: digest.id, eventsPath: digest.eventsPath } : { id: digest.id };
  const runsDir = join(resolveLayout(worktreeRoot).henchDir, "runs");
  const events = resolveRunEventsFile({ run, runsDir, worktreeRoot }, roots);
  if (events.kind === "file") {
    const summary = readLastEvent(events.path)?.summary;
    if (typeof summary === "string" && summary.length > 0) return summary;
  }
  return execution?.lastOutput ?? null;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/** Build the answer for one served workspace. Exported for tests and the monitor. */
export function buildLiveSnapshot(ctx: ServerContext, sources: LiveSources, now = Date.now()): LiveSnapshot {
  const servedPath = canonical(ctx.projectDir);
  const listed = sources.listWorkspaces();
  const workspaces = listed.some((w) => canonical(w.path) === servedPath)
    ? listed
    : [{ key: workspaceKeyOf(ctx), path: ctx.projectDir, branch: null, isAnchor: listed.length === 0 }, ...listed];
  const roots = workspaces.map((w) => w.path);

  const runs: LiveRun[] = [];
  const recent: LiveRun[] = [];
  const starting: LiveStartingExecution[] = [];
  const jobs: LiveJob[] = [];
  const runningTaskIds = new Set<string>();
  const runningDigests: RunDigest[] = [];
  const todayDigests: RunDigest[] = [];
  const dayStart = startOfLocalDay(now);
  let runningCount = 0;
  let servedRunning = 0;
  let servedStale = 0;
  let withLiveRun = 0;
  let liveRuns = 0;

  for (const ws of workspaces) {
    const isServed = canonical(ws.path) === servedPath;
    const worktree: LiveWorktree = { key: ws.key, name: basename(ws.path), path: ws.path, branch: ws.branch, isAnchor: ws.isAnchor, isServed };
    const executions = new Map(dashboardExecutionsFor(ws.path).map((e) => [e.taskId, e]));
    const layout = resolveLayout(ws.path);
    const chains = (taskId: string | null): LiveChainLink[] =>
      taskId ? prdIndexFor(layout.rexDir).chains.get(taskId) ?? [] : [];
    const runningTasksHere = new Set<string>();
    let liveHere = false;
    // Read only when a running run here has no pid of its own to judge by.
    let liveLocks: LiveLock[] | null = null;
    const livenessCtx = {
      get liveLocks(): LiveLock[] {
        return (liveLocks ??= collectLiveLocks(locksDirOf(layout.henchDir)));
      },
      now,
    };

    for (const digest of readRunDigests(ws.path)) {
      const running = digest.status === "running";
      const execution = digest.taskId ? executions.get(digest.taskId) : undefined;
      const verdict = running
        ? judgeRunLiveness(livenessInputOf(digest), livenessCtx, execution ? [execution] : [])
        : null;
      if (running) {
        runningCount++;
        // An abandoned record (`orphaned`) or another machine's run (`foreign`)
        // is not executing here; `unknown` might still be.
        if (verdict?.liveness === "live" || verdict?.liveness === "unknown") liveHere = true;
        if (verdict?.liveness === "live") liveRuns++;
      }
      if (digest.startedAt && Date.parse(digest.startedAt) >= dayStart) todayDigests.push(digest);
      // A run with no id cannot be linked to, so it is counted but not listed.
      if (digest.id === null || digest.status === null) continue;

      const stale = running && isRunStale(digest.lastActivityAt, now);
      if (running && isServed && digest.startedAt) {
        servedRunning++;
        if (stale) servedStale++;
      }

      const finishedMs = digest.finishedAt ? Date.parse(digest.finishedAt) : NaN;
      const isRecent = !running && Number.isFinite(finishedMs) && now - finishedMs <= RECENT_WINDOW_MS;
      if (!running && !isRecent) continue;

      const entry: LiveRun = {
        runId: digest.id,
        taskId: digest.taskId,
        taskTitle: digest.taskTitle,
        epicChain: chains(digest.taskId),
        status: digest.status,
        branch: digest.branch ?? ws.branch,
        worktree,
        startedAt: digest.startedAt,
        finishedAt: digest.finishedAt,
        turns: digest.turns,
        tokens: { ...digest.tokens, total: totalTokens(digest.tokens) },
        model: digest.model,
        vendor: digest.vendor,
        startedFrom: running ? (execution ? "dashboard" : "terminal") : null,
        pid: running ? digest.pid : null,
        pidAlive: running && digest.pid !== null ? isPidAlive(digest.pid) : null,
        lastActivityAt: digest.lastActivityAt,
        heartbeatAgeMs: running ? heartbeatAgeMs(digest.lastActivityAt, now) : null,
        stale,
        liveness: verdict?.liveness ?? null,
        livenessReason: verdict?.reason ?? null,
        canEnd: verdict?.canEnd ?? null,
        criteriaTotal: digest.taskId ? prdIndexFor(layout.rexDir).criteria.get(digest.taskId) ?? null : null,
        lastProgress: running ? lastProgressOf(digest, ws.path, roots, execution) : null,
      };
      if (running) {
        runs.push(entry);
        runningDigests.push(digest);
        if (digest.taskId) {
          runningTaskIds.add(digest.taskId);
          runningTasksHere.add(digest.taskId);
        }
      } else {
        recent.push(entry);
      }
    }

    for (const execution of executions.values()) {
      if (execution.status !== "starting" && execution.status !== "running") continue;
      if (runningTasksHere.has(execution.taskId)) continue;
      starting.push({ taskId: execution.taskId, taskTitle: execution.taskTitle, startedAt: execution.startedAt, worktree });
      runningTaskIds.add(execution.taskId);
    }
    if (liveHere) withLiveRun++;

    // Jobs: the dashboard's slots for this workspace, and an analysis seen
    // only through its progress file (started from a terminal).
    const progress = analyzeProgressFor(layout.sourcevisionDir, sources.processCommandLine);
    let analysisListed = false;
    for (const job of commandJobsOf(ws.key)) {
      if (!job.running) continue;
      const isAnalysis = job.kind === "sv-analyze";
      if (isAnalysis) analysisListed = true;
      const jobProgress = isAnalysis && progress?.running ? progress : null;
      jobs.push({
        id: `${job.kind}:${ws.key}`,
        kind: job.kind,
        worktree,
        startedAt: job.startedAt,
        startedFrom: "dashboard",
        detail: (jobProgress && analyzeDetail(jobProgress)) ?? job.detail,
        progress: jobProgress,
      });
    }
    if (!analysisListed && progress?.running) {
      jobs.push({
        id: `sv-analyze:${ws.key}`,
        kind: "sv-analyze",
        worktree,
        startedAt: progress.startedAt,
        startedFrom: "terminal",
        detail: analyzeDetail(progress),
        progress,
      });
    }
  }

  const scan = rexAnalyzeJobStatus();
  if (scan.running) {
    const lines = scan.output.trim().split("\n").filter(Boolean);
    jobs.push({
      id: "analyze:server",
      kind: "analyze",
      worktree: null,
      startedAt: scan.startedAt,
      startedFrom: "dashboard",
      detail: lines.at(-1) ?? null,
      progress: null,
    });
  }

  const next = nextTasks(prdIndexFor(ctx.rexDir), runningTaskIds);

  const memory = readSystemMemory();
  const floorBytes = (sources.memoryFloorBytes ?? defaultMemoryFloor)();

  runs.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  recent.sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
  jobs.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

  return {
    generatedAt: new Date(now).toISOString(),
    runs,
    jobs,
    queue: { next, starting },
    machine: {
      // Standalone; handleLiveRoute replaces it with the hub's when served through one.
      slots: liveSlots("repository", liveRuns, getEffectiveMaxConcurrent(ctx.projectDir)),
      memory: {
        freeBytes: memory.freeBytes,
        totalBytes: memory.totalBytes,
        usedPercent: memory.usedPercent,
        health: memory.health,
        floorBytes,
        belowFloor: floorBytes !== null && memory.freeBytes <= floorBytes,
      },
      llm: lastActiveAgentModel(ctx.projectDir),
      worktrees: { total: workspaces.length, withLiveRun },
      spend: {
        todayUsd: priceRuns(todayDigests),
        todayTokens: todayDigests.reduce((n, d) => n + totalTokens(d.tokens), 0),
        inFlightUsd: priceRuns(runningDigests),
        inFlightTokens: runningDigests.reduce((n, d) => n + totalTokens(d.tokens), 0),
      },
    },
    recent,
    counts: {
      running: runningCount,
      stale: runs.filter((r) => r.stale).length,
      servedRunning,
      servedStale,
      jobs: jobs.length,
      liveness: summarizeLiveness(runs.flatMap((r) => (r.liveness ? [{ liveness: r.liveness }] : []))),
    },
  };
}

/** The cached answer for a workspace, rebuilt when older than {@link LIVE_CACHE_TTL_MS}. */
export function getLiveSnapshot(ctx: ServerContext, sources: LiveSources, now = Date.now()): LiveSnapshot {
  const key = workspaceKeyOf(ctx);
  const cached = liveCaches.get(key);
  if (cached && now - cached.at < LIVE_CACHE_TTL_MS) return cached.snapshot;
  const snapshot = buildLiveSnapshot(ctx, sources, now);
  liveCaches.set(key, { at: now, snapshot });
  return snapshot;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const LIVE_PATH = "/api/live";

/**
 * Handle GET /api/live. Resolves true if the request was handled.
 *
 * The agent's vendor and model are resolved per request and laid over the
 * cached snapshot, so a config change shows on the next read rather than
 * after the cache turns over. So are the hench slots when the request came
 * through the hub, whose proxy states its admission gate's numbers in
 * {@link HUB_ADMISSION_HEADER}: one snapshot can be read both ways.
 */
export async function handleLiveRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  sources: LiveSources,
): Promise<boolean> {
  const url = (req.url || "/").split("?")[0];
  if (url !== LIVE_PATH || (req.method || "GET") !== "GET") return false;
  const llm = await resolveActiveAgentModel(ctx.projectDir);
  const snapshot = getLiveSnapshot(ctx, sources);
  const admission = parseHubAdmissionHeader(req.headers[HUB_ADMISSION_HEADER]);
  const slots = admission ? hubSlots(admission, snapshot.machine.slots.inUse) : snapshot.machine.slots;
  jsonResponse(res, 200, { ...snapshot, machine: { ...snapshot.machine, llm, slots } });
  return true;
}

// ---------------------------------------------------------------------------
// Change frames
// ---------------------------------------------------------------------------

/** What changed between two snapshots, by run id and job id. */
export interface LiveChanges {
  started: string[];
  finished: string[];
  stale: string[];
}

/** Frame broadcast when the set of running runs or jobs, or their staleness, changes. */
export interface LiveChangedFrame extends LiveChanges {
  type: "live:changed";
  counts: LiveSnapshot["counts"];
  timestamp: string;
}

function liveIds(snapshot: LiveSnapshot): { running: Set<string>; stale: Set<string> } {
  const running = new Set<string>([
    ...snapshot.runs.map((r) => `run:${r.runId}`),
    ...snapshot.queue.starting.map((s) => `starting:${s.worktree.key}:${s.taskId}`),
    ...snapshot.jobs.map((j) => `job:${j.id}`),
  ]);
  const stale = new Set(snapshot.runs.filter((r) => r.stale).map((r) => `run:${r.runId}`));
  return { running, stale };
}

/** Starts, finishes and newly stale entries between `before` and `after`. */
export function diffLiveSnapshots(before: LiveSnapshot, after: LiveSnapshot): LiveChanges {
  const a = liveIds(before);
  const b = liveIds(after);
  return {
    started: [...b.running].filter((id) => !a.running.has(id)),
    finished: [...a.running].filter((id) => !b.running.has(id)),
    stale: [...b.stale].filter((id) => !a.stale.has(id)),
  };
}

/**
 * Rebuild the anchor's snapshot every {@link LIVE_MONITOR_INTERVAL_MS} and
 * broadcast `live:changed` when a run or job started, finished or went
 * stale. The answer it builds is the cached one, so the timer also keeps
 * `GET /api/live` warm. Returns the interval for shutdown.
 */
export function startLiveMonitor(
  ctx: ServerContext,
  sources: LiveSources,
  broadcast: WebSocketBroadcaster,
  intervalMs = LIVE_MONITOR_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  let previous: LiveSnapshot | null = null;
  const tick = (): void => {
    let current: LiveSnapshot;
    try {
      current = getLiveSnapshot(ctx, sources);
    } catch (err) {
      console.error(`[live] snapshot failed: ${(err as Error).message}`);
      return;
    }
    if (previous) {
      const changes = diffLiveSnapshots(previous, current);
      if (changes.started.length + changes.finished.length + changes.stale.length > 0) {
        const frame: LiveChangedFrame = { type: "live:changed", ...changes, counts: current.counts, timestamp: current.generatedAt };
        broadcast(frame);
      }
    }
    previous = current;
  };
  tick();
  const interval = setInterval(tick, intervalMs);
  interval.unref();
  return interval;
}
