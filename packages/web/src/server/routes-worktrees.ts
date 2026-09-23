/**
 * Worktree awareness API route — read-only.
 *
 * GET /api/worktrees — every git worktree of the served repository, each with
 * its branch and HEAD, whether the working tree is dirty, a summary of the
 * hench runs recorded under it (including the one run worth showing — what it
 * is doing now, else what it did last), and whether an n-dx web server is (or
 * was) serving it.
 *
 * The list comes from `git worktree list` via llm-client's `listWorktrees`, so
 * it is the repository's own registry — a checkout that was `git worktree
 * add`ed from anywhere shows up, and a stray copy of the repo does not. The
 * served directory is not special-cased: it is simply the entry whose path is
 * the served worktree's root (`isServed`).
 *
 * Everything per worktree is best-effort. A worktree whose `git status` fails
 * or times out reports `dirty: null`; one with no `.hench/runs/` reports zero
 * runs; one with no pid/port file reports no server. Outside a git repository
 * the route returns `[]` with 200 — the dashboard renders an empty panel
 * rather than an error.
 *
 * The whole answer is cached for {@link WORKTREES_CACHE_TTL_MS} per served
 * project: it shells out once per worktree, and the Sessions panel polls.
 *
 * @module web/server/routes-worktrees
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { exec, getWorktreeRoot, listWorktrees } from "@n-dx/llm-client";
import type { GitWorktree } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse } from "./response-utils.js";
import { ensureWorktreeRunWatcher } from "./routes-hench.js";
import type { WebSocketBroadcaster } from "./websocket.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The one run a worktree is represented by in the Sessions panel: what it is
 * doing now, or what it did last.
 *
 * Enough to render a row and link to the run — the Runs view fetches the rest
 * with `GET /api/hench/runs/:id?scope=repo`, which searches every worktree, so
 * the id is resolvable from a dashboard serving a different checkout.
 */
export interface WorktreeLatestRun {
  id: string;
  /** Run status verbatim (`running`, `completed`, `failed`, …). */
  status: string;
  /** Task title, or null when the run file has none. */
  taskTitle: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /**
   * Worktree root that took this run's task over while it was still running,
   * or null. Present only on records written by a hench that records it.
   */
  claimLostTo: string | null;
}

/** Hench run history recorded under one worktree's `.hench/runs/`. */
export interface WorktreeRunsSummary {
  /** Run files that parsed. */
  total: number;
  /** Runs whose status is still `running`. */
  running: number;
  /** Latest `finishedAt` across finished runs, or null when none has finished. */
  lastFinishedAt: string | null;
  /**
   * The running run that started most recently, or — when none is running —
   * the run that finished (or failing that, started) most recently. Null when
   * the worktree has no parseable run.
   */
  latest: WorktreeLatestRun | null;
}

/** Whether an n-dx web server is serving this worktree, per its marker files. */
export interface WorktreeServerPresence {
  /** `.n-dx-web.pid` exists — a server was started here and has not cleaned up. */
  pidFile: boolean;
  /** Process id from the pid file, or null. Liveness is not probed. */
  pid: number | null;
  /** Port from `.n-dx-web.port`, falling back to the pid file's port, or null. */
  port: number | null;
}

export interface WorktreeEntry {
  /** Realpath-resolved absolute path of the worktree root. */
  path: string;
  /** Checked-out branch, or null when detached or bare. */
  branch: string | null;
  /** HEAD commit hash, or null for a bare repository. */
  head: string | null;
  /** The main worktree — the one holding the shared `.git`. */
  isAnchor: boolean;
  /** The worktree this server is serving. */
  isServed: boolean;
  detached: boolean;
  bare: boolean;
  /** Whether `git status --porcelain` reported anything; null when it could not be asked. */
  dirty: boolean | null;
  /** Number of porcelain status lines; null when unknown. */
  dirtyFiles: number | null;
  runs: WorktreeRunsSummary;
  server: WorktreeServerPresence;
}

// ---------------------------------------------------------------------------
// Constants & cache
// ---------------------------------------------------------------------------

/** Whole-answer cache. The Sessions panel polls; git should not be asked each time. */
export const WORKTREES_CACHE_TTL_MS = 5_000;

/** `git status` per worktree — a metadata read; anything slower is a stuck git. */
const GIT_STATUS_TIMEOUT_MS = 5_000;

const PID_FILE = ".n-dx-web.pid";
const PORT_FILE = ".n-dx-web.port";

interface WorktreesCache {
  projectDir: string;
  timestamp: number;
  entries: WorktreeEntry[];
}

let worktreesCache: WorktreesCache | null = null;

/**
 * Per-run-file cache keyed by path. Run files are append-heavy (transcripts,
 * tool calls) and only their `status` / `finishedAt` matter here, so a file
 * whose mtime and size have not moved is not parsed again.
 */
interface RunFileDigest {
  mtimeMs: number;
  size: number;
  id: string | null;
  status: string | null;
  taskTitle: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  claimLostTo: string | null;
}

const runDigestCache = new Map<string, RunFileDigest>();

/** Clear caches (exposed for testing). */
export function clearWorktreesCache(): void {
  worktreesCache = null;
  runDigestCache.clear();
}

/**
 * Drop the whole-answer cache so the next request re-reads every worktree.
 *
 * Called when a runs directory changes: the `hench:run-changed` broadcast
 * makes the Sessions tray refetch at once, and without this it would be
 * served an answer up to {@link WORKTREES_CACHE_TTL_MS} old — the change it
 * was told about not yet in it. The per-file digest cache stays: it is keyed
 * on mtime and size, so a changed run file is re-read regardless.
 */
export function invalidateWorktreesAnswer(): void {
  worktreesCache = null;
}

// ---------------------------------------------------------------------------
// Per-worktree probes
// ---------------------------------------------------------------------------

/**
 * Count `git status --porcelain` lines. Null when git failed, timed out, or
 * the worktree has no working files to report on (bare).
 */
async function countDirtyFiles(worktree: GitWorktree): Promise<number | null> {
  if (worktree.bare) return null;
  const result = await exec("git", ["status", "--porcelain"], {
    cwd: worktree.path,
    timeout: GIT_STATUS_TIMEOUT_MS,
  });
  if (!result.launched || result.error || result.exitCode !== 0) return null;
  return result.stdout.split("\n").filter((line) => line.length > 0).length;
}

/** Read just the two fields this route needs from one run file, via the digest cache. */
/**
 * The worktree named by a run record's `claimLost`, or null.
 *
 * Tolerant by design: this reads run files written by other worktrees, which
 * may be on a different hench version, so a missing or malformed entry is
 * simply no takeover rather than a parse failure that costs the whole digest.
 */
function claimLostHolder(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const holder = (value as Record<string, unknown>).holderWorktree;
  return typeof holder === "string" && holder.length > 0 ? holder : null;
}

function digestRunFile(path: string): RunFileDigest | null {
  let mtimeMs: number;
  let size: number;
  try {
    const s = statSync(path);
    mtimeMs = s.mtimeMs;
    size = s.size;
  } catch {
    return null;
  }

  const cached = runDigestCache.get(path);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached;

  const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

  let digest: RunFileDigest;
  try {
    const run = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    digest = {
      mtimeMs,
      size,
      id: str(run.id),
      status: str(run.status),
      taskTitle: str(run.taskTitle),
      startedAt: str(run.startedAt),
      finishedAt: str(run.finishedAt),
      claimLostTo: claimLostHolder(run.claimLost),
    };
  } catch {
    // Unparseable (mid-write, corrupt): remember that so it is not re-read on
    // every poll, but count it as no run.
    digest = { mtimeMs, size, id: null, status: null, taskTitle: null, startedAt: null, finishedAt: null, claimLostTo: null };
  }
  runDigestCache.set(path, digest);
  return digest;
}

/**
 * How recent a run is, for picking the one the Sessions panel shows.
 *
 * A running run outranks every finished one regardless of timestamps — the
 * panel's job is to say what a worktree is doing now — and within each group
 * the most recent wins. ISO-8601 UTC timestamps compare correctly as strings,
 * which is how `lastFinishedAt` has always been computed here.
 */
function latestRank(digest: RunFileDigest): [number, string] {
  const running = digest.status === "running";
  return [running ? 1 : 0, (running ? digest.startedAt : digest.finishedAt) ?? digest.startedAt ?? ""];
}

/** Summarise `<worktree>/.hench/runs/*.json`. Missing directory is zero runs. */
function summariseRuns(worktreePath: string): WorktreeRunsSummary {
  const runsDir = join(worktreePath, ".hench", "runs");
  let files: string[];
  try {
    files = readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return { total: 0, running: 0, lastFinishedAt: null, latest: null };
  }

  let total = 0;
  let running = 0;
  let lastFinishedAt: string | null = null;
  let best: RunFileDigest | null = null;
  for (const file of files) {
    const digest = digestRunFile(join(runsDir, file));
    if (!digest || digest.status === null) continue;
    total++;
    if (digest.status === "running") running++;
    if (digest.finishedAt && (lastFinishedAt === null || digest.finishedAt > lastFinishedAt)) {
      lastFinishedAt = digest.finishedAt;
    }
    // A run with no id cannot be linked to, so it is never the shown run.
    if (digest.id === null) continue;
    if (best === null) { best = digest; continue; }
    const [rank, key] = latestRank(digest);
    const [bestRank, bestKey] = latestRank(best);
    if (rank > bestRank || (rank === bestRank && key > bestKey)) best = digest;
  }

  const latest: WorktreeLatestRun | null = best === null || best.status === null
    ? null
    : {
        id: best.id as string,
        status: best.status,
        taskTitle: best.taskTitle,
        startedAt: best.startedAt,
        finishedAt: best.finishedAt,
        claimLostTo: best.claimLostTo,
      };
  return { total, running, lastFinishedAt, latest };
}

/** Read the server marker files `ndx start` leaves in a served directory. */
function readServerPresence(worktreePath: string): WorktreeServerPresence {
  let pidFile = false;
  let pid: number | null = null;
  let port: number | null = null;

  try {
    const raw = JSON.parse(readFileSync(join(worktreePath, PID_FILE), "utf-8")) as Record<string, unknown>;
    pidFile = true;
    if (typeof raw.pid === "number") pid = raw.pid;
    if (typeof raw.port === "number") port = raw.port;
  } catch {
    // Absent or unreadable — no server was started here (or it cleaned up).
  }

  try {
    const parsed = parseInt(readFileSync(join(worktreePath, PORT_FILE), "utf-8").trim(), 10);
    if (!Number.isNaN(parsed)) port = parsed;
  } catch {
    // Port file is written by the server itself; absence means not listening.
  }

  return { pidFile, pid, port };
}

async function describeWorktree(worktree: GitWorktree, servedRoot: string | null): Promise<WorktreeEntry> {
  const dirtyFiles = await countDirtyFiles(worktree);
  return {
    path: worktree.path,
    branch: worktree.branch,
    head: worktree.head,
    isAnchor: worktree.isMain,
    isServed: servedRoot !== null && worktree.path === servedRoot,
    detached: worktree.detached,
    bare: worktree.bare,
    dirty: dirtyFiles === null ? null : dirtyFiles > 0,
    dirtyFiles,
    runs: summariseRuns(worktree.path),
    server: readServerPresence(worktree.path),
  };
}

/** Build the full answer for one served project. Exported for tests. */
export async function collectWorktrees(projectDir: string): Promise<WorktreeEntry[]> {
  const worktrees = await listWorktrees(projectDir);
  if (worktrees.length === 0) return [];
  const servedRoot = getWorktreeRoot(projectDir);
  return Promise.all(worktrees.map((wt) => describeWorktree(wt, servedRoot)));
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const WORKTREES_PATH = "/api/worktrees";

export interface WorktreesRouteOptions {
  /** Where a change to another worktree's runs is announced as `hench:run-changed`. */
  broadcast?: WebSocketBroadcaster;
  /** Caches to drop when any runs directory changes — see `ensureWorktreeRunWatcher`. */
  onStatusInvalidate?: () => void;
}

/**
 * Watch every non-served worktree's `.hench/runs/`, so a run file saved there
 * — a claim takeover stamped mid-run, a run starting or finishing — reaches
 * the Sessions tray as a push rather than on its next poll. The served
 * worktree is already watched by start.ts. Re-checked on every request, cached
 * answer or not, so a worktree whose runs directory appears later is picked up.
 */
function watchOtherWorktreeRuns(entries: WorktreeEntry[], options: WorktreesRouteOptions): void {
  // Nothing to announce to — and registering anyway would claim the
  // directory's one watcher slot with a silent watcher.
  if (!options.broadcast) return;
  for (const entry of entries) {
    if (entry.isServed || entry.bare) continue;
    ensureWorktreeRunWatcher(join(entry.path, ".hench", "runs"), options.broadcast, options.onStatusInvalidate);
  }
}

/** Handle GET /api/worktrees. Returns true if the request was handled. */
export async function handleWorktreesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  options: WorktreesRouteOptions = {},
): Promise<boolean> {
  const url = (req.url || "/").split("?")[0];
  if (url !== WORKTREES_PATH || (req.method || "GET") !== "GET") return false;

  const now = Date.now();
  if (
    worktreesCache &&
    worktreesCache.projectDir === ctx.projectDir &&
    now - worktreesCache.timestamp < WORKTREES_CACHE_TTL_MS
  ) {
    watchOtherWorktreeRuns(worktreesCache.entries, options);
    jsonResponse(res, 200, worktreesCache.entries);
    return true;
  }

  const entries = await collectWorktrees(ctx.projectDir);
  worktreesCache = { projectDir: ctx.projectDir, timestamp: now, entries };
  watchOtherWorktreeRuns(entries, options);
  jsonResponse(res, 200, entries);
  return true;
}
