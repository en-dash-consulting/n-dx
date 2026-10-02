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
import { exec, getWorktreeRoot, listWorktrees } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { errorResponse, jsonResponse, readBody } from "./response-utils.js";
import { resolveNdxBin } from "./routes-commands.js";
import { buildLlmCatalog } from "./routes-llm.js";
import { collectHeldRuns } from "./routes-hench.js";
import { validateRunOptions, writeContextNotesFile } from "./run-options.js";
import { loadPRDSync } from "./prd-io.js";
import {
  collectCompletedIds,
  findItem,
  findNextTask,
  openClaimsStore,
  resolveClaimHolder,
} from "./rex-gateway.js";
import {
  HUB_ADMISSION_HEADER,
  parseHubAdmissionHeader,
  runOptionArgs,
} from "../shared/index.js";
import type { HubMemoryPressure } from "../shared/index.js";

/** `ndx work --resolve` reads the PRD and config: it answers in well under this. */
export const PREP_RESOLVE_TIMEOUT_MS = 15_000;
/** A dry run assembles the whole brief, so it gets longer. */
export const PREP_PREVIEW_TIMEOUT_MS = 30_000;

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

/** Run `ndx <args>` in the workspace's directory, through the same binary the terminal uses. */
async function runNdx(ctx: ServerContext, args: string[], timeout: number) {
  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  const result = await exec(bin, [...prefixArgs, ...args], { cwd: ctx.projectDir, timeout });
  const timedOut = result.exitCode === null;
  const failure = result.exitCode === 0
    ? null
    : timedOut
      ? `Timed out after ${Math.round(timeout / 1000)}s`
      : `Exited with code ${result.exitCode}`;
  return { stdout: result.stdout, stderr: result.stderr, failure };
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

function detailOf(ctx: ServerContext, taskId: string): PrepDetail | null {
  const doc = loadPRDSync(ctx.rexDir);
  const entry = doc ? findItem(doc.items, taskId) : null;
  if (!entry) return null;
  return {
    priority: entry.item.priority ?? null,
    parentChain: entry.parents.map((p) => p.title),
    criteriaCount: entry.item.acceptanceCriteria?.length ?? 0,
  };
}

/** GET /api/hench/prep/:taskId */
async function handlePrep(req: IncomingMessage, res: ServerResponse, ctx: ServerContext, taskId: string): Promise<boolean> {
  const run = await runNdx(ctx, ["work", `--task=${taskId}`, "--resolve", ctx.projectDir], PREP_RESOLVE_TIMEOUT_MS);
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
    detail: detailOf(ctx, taskId),
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
  const checked = validateRunOptions(ctx.projectDir, body["options"]);
  if (!checked.ok) {
    jsonResponse(res, 400, { error: checked.error, key: checked.key });
    return true;
  }
  const { options } = checked;
  const contextFile = options.contextNotes ? await writeContextNotesFile(options.contextNotes) : null;
  let run: Awaited<ReturnType<typeof runNdx>>;
  try {
    run = await runNdx(
      ctx,
      ["work", `--task=${taskId}`, "--dry-run", ...runOptionArgs(options, contextFile?.path), ctx.projectDir],
      PREP_PREVIEW_TIMEOUT_MS,
    );
  } finally {
    await contextFile?.remove();
  }
  if (run.failure) {
    // A refusal prints its reason on stdout, so it travels with the failure.
    jsonResponse(res, 502, { error: `Could not preview the run: ${run.failure}`, stderr: tail(run.stderr), brief: run.stdout });
    return true;
  }
  jsonResponse(res, 200, { brief: run.stdout });
  return true;
}

/** The `limit` query parameter: default {@link READY_DEFAULT_LIMIT}, clamped to 1..{@link READY_MAX_LIMIT}. */
function readyLimit(url: string): number {
  const raw = new URL(url, "http://localhost").searchParams.get("limit");
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return READY_DEFAULT_LIMIT;
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

  // The order `ndx work --auto` picks in: each pick is excluded and asked again,
  // starting with every task another worktree holds.
  const excludeIds = new Set(foreign.keys());
  const tasks: ReadyTask[] = [];
  while (tasks.length < limit) {
    const entry = findNextTask(doc.items, completedIds, { excludeIds });
    if (!entry) break;
    excludeIds.add(entry.item.id);
    const { item, parents } = entry;
    const liveRun = liveTaskIds.has(item.id);
    tasks.push({
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
    });
  }
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

  if (path === READY_PATH && method === "GET") return handleReady(req, res, ctx);

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
  return method === "GET" ? handlePrep(req, res, ctx, taskId) : false;
}
