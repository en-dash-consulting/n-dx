/**
 * What the Prepare task modal and the Ready to run list read.
 *
 * GET  /api/hench/prep/:taskId          — `ndx work --task=<id> --resolve`'s JSON (hench's
 *                                         defaults and where each came from, refusals, the
 *                                         equivalent command) plus the vendor's model catalog,
 *                                         the hub's admission state, the worktree's state, the
 *                                         run's directory (`dir`), the item's header fields
 *                                         (`detail`), and `recommendation: null` (reserved for
 *                                         a later phase)
 * POST /api/hench/prep/:taskId/preview  — body `{options}`; `ndx work --task=<id> --dry-run
 *                                         <flags>`'s output as `{brief}`
 * GET  /api/hench/ready?limit=N         — the next N tasks in the order `ndx work --auto` would
 *                                         pick them (default 10, max 50)
 *
 * Every route answers for the request's workspace: `ctx` is already the worktree the
 * `/w/<key>/` slot or `X-Ndx-Workspace` named, and the spawned `ndx` runs in
 * `ctx.projectDir`. The dashboard never re-derives hench's defaults — the resolve
 * mode is the single source — and nothing here writes: `--resolve` and `--dry-run`
 * observe claims read-only, which is what lets the GET spawn a process and the
 * preview be called repeatedly.
 *
 * @module web/server/routes-hench-prep
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { exec, getWorktreeRoot, listWorktrees, resolveLayout } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { errorResponse, jsonResponse, readBody } from "./response-utils.js";
import { resolveNdxBin } from "./routes-commands.js";
import { isForeignSiteRequest, refuseForeignSite } from "./request-security.js";
import { buildLlmCatalog } from "./routes-llm.js";
import { collectHeldRuns, loadHenchConfig } from "./routes-hench.js";
import { loadStuckTaskIds, maxFailedAttemptsOf } from "./stuck-tasks.js";
import { validateRunOptions, writeContextNotesFile } from "./run-options.js";
import { loadPRDSync } from "./prd-io.js";
import {
  collectCompletedIds,
  findItem,
  findActionableTasks,
  openClaimsStore,
  resolveClaimHolder,
} from "./rex-gateway.js";
import {
  HUB_ADMISSION_HEADER,
  parseHubAdmissionHeader,
  resetsDeferred,
  runOptionArgs,
} from "../shared/index.js";
import type { HubMemoryPressure } from "../shared/index.js";

/** `ndx work --resolve` reads the PRD and config: it answers in well under this. */
export const PREP_RESOLVE_TIMEOUT_MS = 15_000;
/** A dry run assembles the whole brief, so it gets longer. */
export const PREP_PREVIEW_TIMEOUT_MS = 30_000;

/**
 * `ndx` spawns the prep routes may have running at once. Each is a full CLI start
 * (up to {@link PREP_RESOLVE_TIMEOUT_MS} / {@link PREP_PREVIEW_TIMEOUT_MS}), so an
 * unbounded loop of requests would stack processes. Past the cap a request that
 * cannot join an in-flight resolve is answered 429.
 */
export const PREP_MAX_IN_FLIGHT = 4;

export const READY_DEFAULT_LIMIT = 10;
export const READY_MAX_LIMIT = 50;

/** Bytes of stderr kept in a 502: the end of it, where the failure is. */
const STDERR_TAIL_BYTES = 1000;

const PREP_ROUTE = /^\/api\/hench\/prep\/([^/?]+)(\/preview)?$/;
const READY_PATH = "/api/hench/ready";

/** The hub's admission gate as the modal shows it; null when not served through the hub. */
export interface PrepAdmission {
  running: number;
  max: number;
  queued: number;
  availableBytes: number | null;
  pressure: HubMemoryPressure;
  memoryPaused: boolean;
}

/** The worktree the request addressed, as the modal's header states it. */
export interface PrepWorkspace {
  key: string | null;
  root: string;
  branch: string | null;
  isAnchor: boolean;
  dirty: boolean;
  /** A run recorded in this worktree is live or cannot be confirmed dead. */
  liveRun: boolean;
}

/** One row of the Ready to run list. */
export interface ReadyTask {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  level: string;
  /** Ancestor titles, epic first. */
  parentChain: string[];
  criteriaCount: number;
  tags: string[];
  /** In progress with no live run: `ndx work` would pick it up where it stopped. */
  resume: boolean;
  /** A run of this task is live (or cannot be confirmed dead) in some worktree. */
  liveRun: boolean;
}

function tail(text: string): string {
  return text.length > STDERR_TAIL_BYTES ? text.slice(-STDERR_TAIL_BYTES) : text;
}

interface NdxRun {
  stdout: string;
  stderr: string;
  failure: string | null;
}

/** Spawns running now, across both routes. */
let inFlight = 0;

/** An identical resolve in flight, joined rather than spawned again. */
interface SharedResolve {
  run: Promise<NdxRun>;
  controller: AbortController;
  waiters: number;
}
const sharedResolves = new Map<string, SharedResolve>();

/**
 * Run `ndx <args>` in the workspace's directory, through the same binary the
 * terminal uses. Aborting `signal` kills the child and its tree.
 */
async function runNdx(ctx: ServerContext, args: string[], timeout: number, signal?: AbortSignal): Promise<NdxRun> {
  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  inFlight++;
  try {
    const result = await exec(bin, [...prefixArgs, ...args], { cwd: ctx.projectDir, timeout, signal });
    const failure = result.exitCode === 0
      ? null
      : signal?.aborted
        ? "Cancelled: the client disconnected"
        : result.exitCode === null
          ? `Timed out after ${Math.round(timeout / 1000)}s`
          : `Exited with code ${result.exitCode}`;
    return { stdout: result.stdout, stderr: result.stderr, failure };
  } finally {
    inFlight--;
  }
}

/** An AbortController that fires when the client goes away before the response is written. */
function abortOnDisconnect(res: ServerResponse): AbortController {
  const controller = new AbortController();
  res.once("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller;
}

function refuseBusy(res: ServerResponse): true {
  res.setHeader("Retry-After", "2");
  jsonResponse(res, 429, { error: "Too many prepare requests in flight; retry shortly" });
  return true;
}

function admissionOf(req: IncomingMessage): PrepAdmission | null {
  const header = parseHubAdmissionHeader(req.headers[HUB_ADMISSION_HEADER]);
  if (!header) return null;
  return {
    running: header.running,
    max: header.maxSessions,
    queued: header.queued,
    availableBytes: header.availableBytes ?? null,
    pressure: header.pressure ?? "unknown",
    memoryPaused: header.memoryPaused ?? false,
  };
}

async function workspaceOf(
  ctx: ServerContext,
  resolved: Record<string, unknown>,
): Promise<PrepWorkspace> {
  const hench = (resolved["workspace"] ?? {}) as Record<string, unknown>;
  const servedRoot = getWorktreeRoot(ctx.projectDir);
  const worktrees = await listWorktrees(ctx.projectDir);
  const served = worktrees.find((wt) => wt.path === servedRoot);
  // The root run records are filed under: the worktree's, or the served directory outside git.
  const root = served?.path ?? ctx.projectDir;
  const held = await collectHeldRuns(ctx);
  return {
    key: ctx.workspace ?? null,
    root,
    branch: served ? served.branch : typeof hench["branch"] === "string" ? hench["branch"] : null,
    // Outside a git repository the served directory is the only workspace.
    isAnchor: served ? served.isMain : true,
    dirty: hench["dirty"] === true,
    liveRun: held.some((run) => run.root === root),
  };
}

/** The resolved vendor's catalog entry, or null when no vendor resolved. */
async function catalogFor(ctx: ServerContext, resolved: Record<string, unknown>): Promise<unknown> {
  const settings = (resolved["resolved"] ?? {}) as Record<string, { value?: unknown } | undefined>;
  const vendor = settings["vendor"]?.value;
  if (typeof vendor !== "string") return null;
  const catalog = (await buildLlmCatalog(ctx.projectDir, false)) as unknown as Record<string, unknown>;
  const entry = catalog[vendor];
  return entry === undefined ? null : { vendor, ...(entry as object) };
}

/** What the modal's header says about the task beyond hench's `task`; null when the PRD has no such item. */
export interface PrepDetail {
  priority: string | null;
  /** Ancestor titles, epic first. */
  parentChain: string[];
  criteriaCount: number;
}

type PrdEntry = NonNullable<ReturnType<typeof findItem>>;

function prdEntryOf(ctx: ServerContext, taskId: string): PrdEntry | null {
  const doc = loadPRDSync(ctx.rexDir);
  return doc ? findItem(doc.items, taskId) : null;
}

function detailOf(entry: PrdEntry | null): PrepDetail | null {
  if (!entry) return null;
  return {
    priority: entry.item.priority ?? null,
    parentChain: entry.parents.map((p) => p.title),
    criteriaCount: entry.item.acceptanceCriteria?.length ?? 0,
  };
}

/** `--reset-deferred` when execute would pass it, so resolve and preview describe the run execute starts. */
function resetDeferredArgs(entry: PrdEntry | null): string[] {
  return resetsDeferred(entry?.item.status) ? ["--reset-deferred"] : [];
}

/** GET /api/hench/prep/:taskId */
async function handlePrep(req: IncomingMessage, res: ServerResponse, ctx: ServerContext, taskId: string): Promise<boolean> {
  const entry = prdEntryOf(ctx, taskId);
  // Requests for the same task share one spawn; the child is killed only once
  // every request waiting on it has disconnected.
  const key = `${ctx.projectDir}\0${taskId}`;
  let shared = sharedResolves.get(key);
  if (!shared) {
    if (inFlight >= PREP_MAX_IN_FLIGHT) return refuseBusy(res);
    const controller = new AbortController();
    const started = runNdx(
      ctx,
      ["work", `--task=${taskId}`, "--resolve", ...resetDeferredArgs(entry), ctx.projectDir],
      PREP_RESOLVE_TIMEOUT_MS,
      controller.signal,
    ).finally(() => sharedResolves.delete(key));
    shared = { run: started, controller, waiters: 0 };
    sharedResolves.set(key, shared);
  }
  const joined = shared;
  joined.waiters++;
  res.once("close", () => {
    if (res.writableEnded) return;
    if (--joined.waiters === 0) joined.controller.abort();
  });
  const run = await joined.run;
  if (res.destroyed) return true;
  if (run.failure) {
    jsonResponse(res, 502, { error: `Could not resolve the run: ${run.failure}`, stderr: tail(run.stderr) });
    return true;
  }
  let resolved: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(run.stdout);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    resolved = parsed as Record<string, unknown>;
  } catch {
    jsonResponse(res, 502, { error: "Could not resolve the run: the resolve output was not JSON", stderr: tail(run.stderr) });
    return true;
  }
  const [catalog, workspace] = await Promise.all([catalogFor(ctx, resolved), workspaceOf(ctx, resolved)]);
  jsonResponse(res, 200, {
    ...resolved,
    // The directory the execute spawn passes, so the modal's command line is the spawned one.
    dir: ctx.projectDir,
    detail: detailOf(entry),
    catalog,
    admission: admissionOf(req),
    workspace: { ...(resolved["workspace"] as object | undefined), ...workspace },
    recommendation: null,
  });
  return true;
}

/** POST /api/hench/prep/:taskId/preview */
async function handlePreview(req: IncomingMessage, res: ServerResponse, ctx: ServerContext, taskId: string): Promise<boolean> {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await readBody(req, res));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    errorResponse(res, 400, "Invalid JSON in request body");
    return true;
  }
  const checked = await validateRunOptions(ctx.projectDir, body["options"]);
  if (!checked.ok) {
    jsonResponse(res, 400, { error: checked.error, key: checked.key });
    return true;
  }
  const { options } = checked;
  if (inFlight >= PREP_MAX_IN_FLIGHT) return refuseBusy(res);
  const disconnect = abortOnDisconnect(res);
  const contextFile = options.contextNotes ? await writeContextNotesFile(options.contextNotes) : null;
  let run: Awaited<ReturnType<typeof runNdx>>;
  try {
    run = await runNdx(
      ctx,
      [
        "work", `--task=${taskId}`, "--dry-run",
        ...runOptionArgs(options, contextFile?.path),
        // The dry run reads the task as reset without writing it.
        ...resetDeferredArgs(prdEntryOf(ctx, taskId)),
        ctx.projectDir,
      ],
      PREP_PREVIEW_TIMEOUT_MS,
      disconnect.signal,
    );
  } finally {
    await contextFile?.remove();
  }
  if (res.destroyed) return true;
  if (run.failure) {
    // A refusal prints its reason on stdout, so it travels with the failure.
    jsonResponse(res, 502, { error: `Could not preview the run: ${run.failure}`, stderr: tail(run.stderr), brief: run.stdout });
    return true;
  }
  jsonResponse(res, 200, { brief: run.stdout });
  return true;
}

/**
 * The `limit` query parameter: default {@link READY_DEFAULT_LIMIT}, clamped to
 * 1..{@link READY_MAX_LIMIT}. The whole value must be a number and an integer —
 * `Number()` reads `1e9` as a billion, where `parseInt` read it as 1 and `10abc`
 * as 10. Blank, partial or fractional values fall back to the default.
 */
function readyLimit(url: string): number {
  const raw = new URL(url, "http://localhost").searchParams.get("limit");
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isInteger(n)) return READY_DEFAULT_LIMIT;
  return Math.min(READY_MAX_LIMIT, Math.max(1, n));
}

/** GET /api/hench/ready */
async function handleReady(req: IncomingMessage, res: ServerResponse, ctx: ServerContext): Promise<boolean> {
  const doc = loadPRDSync(ctx.rexDir);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }
  const limit = readyLimit(req.url ?? READY_PATH);
  const holder = resolveClaimHolder(ctx.projectDir);
  const foreign = await openClaimsStore(ctx.projectDir).claimedElsewhere(holder.worktreeRoot);
  const liveTaskIds = new Set((await collectHeldRuns(ctx)).map((run) => run.taskId));
  const completedIds = collectCompletedIds(doc.items);
  // `--auto` skips stuck tasks and counts them done for their dependents; so does this list.
  const stuckIds = await loadStuckTaskIds(
    join(resolveLayout(ctx.projectDir).henchDir, "runs"),
    maxFailedAttemptsOf(loadHenchConfig(ctx.projectDir)),
  );
  for (const id of stuckIds) completedIds.add(id);

  // The order `ndx work --auto` picks in, in one selection pass. Asking for the
  // next task once per row rebuilt the comparator each time and froze the
  // request thread for seconds. Tasks another worktree holds are excluded.
  const picked = findActionableTasks(doc.items, completedIds, limit, {
    excludeIds: new Set([...foreign.keys(), ...stuckIds]),
  });
  const tasks: ReadyTask[] = picked.map(({ item, parents }) => {
    const liveRun = liveTaskIds.has(item.id);
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      priority: item.priority ?? null,
      level: item.level,
      parentChain: parents.map((p) => p.title),
      criteriaCount: item.acceptanceCriteria?.length ?? 0,
      tags: item.tags ?? [],
      resume: item.status === "in_progress" && !liveRun,
      liveRun,
    };
  });
  // `dir` is what execute passes `ndx work`, so a copied command matches the run.
  jsonResponse(res, 200, { tasks, limit, dir: ctx.projectDir });
  return true;
}

/** Handle the prep and ready routes. Resolves true if the request was handled. */
export async function handleHenchPrepRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = req.url || "/";
  const path = url.split("?")[0]!;
  const method = req.method || "GET";

  // These GETs make the server work (a spawn, a PRD scan), so a foreign page's
  // <img src> must not be able to trigger them. The browser already blocks the
  // cross-origin read; the work is not blocked, so refuse it here.
  if (path === READY_PATH && method === "GET") {
    return isForeignSiteRequest(req) ? refuseForeignSite(res) : handleReady(req, res, ctx);
  }

  const match = PREP_ROUTE.exec(path);
  if (!match) return false;
  let taskId: string;
  try {
    taskId = decodeURIComponent(match[1]!);
  } catch {
    errorResponse(res, 400, "Task id is not valid URL encoding");
    return true;
  }
  if (match[2]) return method === "POST" ? handlePreview(req, res, ctx, taskId) : false;
  if (method !== "GET") return false;
  return isForeignSiteRequest(req) ? refuseForeignSite(res) : handlePrep(req, res, ctx, taskId);
}
