/**
 * Worktree awareness API route — read-only.
 *
 * GET /api/worktrees — every git worktree of the served repository, each with
 * its branch and HEAD, whether the working tree is dirty, a summary of the
 * hench runs recorded under it, and whether an n-dx web server is (or was)
 * serving it.
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Hench run history recorded under one worktree's `.hench/runs/`. */
export interface WorktreeRunsSummary {
  /** Run files that parsed. */
  total: number;
  /** Runs whose status is still `running`. */
  running: number;
  /** Latest `finishedAt` across finished runs, or null when none has finished. */
  lastFinishedAt: string | null;
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
  status: string | null;
  finishedAt: string | null;
}

const runDigestCache = new Map<string, RunFileDigest>();

/** Clear caches (exposed for testing). */
export function clearWorktreesCache(): void {
  worktreesCache = null;
  runDigestCache.clear();
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

  let digest: RunFileDigest;
  try {
    const run = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    digest = {
      mtimeMs,
      size,
      status: typeof run.status === "string" ? run.status : null,
      finishedAt: typeof run.finishedAt === "string" ? run.finishedAt : null,
    };
  } catch {
    // Unparseable (mid-write, corrupt): remember that so it is not re-read on
    // every poll, but count it as no run.
    digest = { mtimeMs, size, status: null, finishedAt: null };
  }
  runDigestCache.set(path, digest);
  return digest;
}

/** Summarise `<worktree>/.hench/runs/*.json`. Missing directory is zero runs. */
function summariseRuns(worktreePath: string): WorktreeRunsSummary {
  const runsDir = join(worktreePath, ".hench", "runs");
  let files: string[];
  try {
    files = readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return { total: 0, running: 0, lastFinishedAt: null };
  }

  let total = 0;
  let running = 0;
  let lastFinishedAt: string | null = null;
  for (const file of files) {
    const digest = digestRunFile(join(runsDir, file));
    if (!digest || digest.status === null) continue;
    total++;
    if (digest.status === "running") running++;
    if (digest.finishedAt && (lastFinishedAt === null || digest.finishedAt > lastFinishedAt)) {
      lastFinishedAt = digest.finishedAt;
    }
  }
  return { total, running, lastFinishedAt };
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

/** Handle GET /api/worktrees. Returns true if the request was handled. */
export async function handleWorktreesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = (req.url || "/").split("?")[0];
  if (url !== WORKTREES_PATH || (req.method || "GET") !== "GET") return false;

  const now = Date.now();
  if (
    worktreesCache &&
    worktreesCache.projectDir === ctx.projectDir &&
    now - worktreesCache.timestamp < WORKTREES_CACHE_TTL_MS
  ) {
    jsonResponse(res, 200, worktreesCache.entries);
    return true;
  }

  const entries = await collectWorktrees(ctx.projectDir);
  worktreesCache = { projectDir: ctx.projectDir, timestamp: now, entries };
  jsonResponse(res, 200, entries);
  return true;
}
