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
 * GET  /api/hench/ready?limit=N        — the next N tasks in the order `ndx work --auto` would
 *                                         pick them (default 10, max 50), each with whether it
 *                                         carries saved run settings
 * PUT  /api/hench/prep/:taskId          — body `{run, version}`; saves (or clears) the task's
 *                                         own run settings, which `ndx work` then applies
 *
 * Every route answers for the request's workspace: `ctx` is already the worktree the
 * `/w/<key>/` slot or `X-Ndx-Workspace` named, and the spawned `ndx` runs in
 * `ctx.projectDir`. The dashboard never re-derives hench's defaults — the resolve
 * mode is the single source.
 *
 * The three GET/POST routes write nothing: `--resolve` and `--dry-run` observe
 * claims read-only, which is what lets the GET spawn a process and the preview be
 * called repeatedly. The PUT is the one writer here, and it writes the PRD — so it
 * goes through `store.withTransaction` under the workspace's own PRD lock, like
 * every other PRD-writing route.
 *
 * @module web/server/routes-hench-prep
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { exec, getWorktreeRoot, listWorktrees, resolveLayout } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { errorResponse, jsonResponse, readBody } from "./response-utils.js";
import { resolveNdxBin } from "./routes-commands.js";
import { isForeignSiteRequest, refuseForeignSite } from "./request-security.js";
import { buildLlmCatalog, resolveActiveVendor, validateCatalogModel } from "./routes-llm.js";
import { collectHeldRuns, loadHenchConfig } from "./routes-hench.js";
import { loadStuckTaskIds, maxFailedAttemptsOf } from "./stuck-tasks.js";
import { validateRunOptions, writeContextNotesFile } from "./run-options.js";
import { validateProviderForVendor } from "./hench-config-fields.js";
import { loadPRDSync, refreshPRDCache } from "./prd-io.js";
import {
  collectCompletedIds,
  findItem,
  findActionableTasks,
  isWorkItem,
  openClaimsStore,
  resolveClaimHolder,
  resolveStore,
  updateInTree,
  validateRunSettings,
} from "./rex-gateway.js";
import type { RunSettings } from "./rex-gateway.js";
import type { WebSocketBroadcaster } from "./websocket.js";
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
  /** The task carries its own run settings, which `ndx work` applies. */
  saved: boolean;
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

/**
 * Launch-time options, which a task may never carry: they are chosen per launch
 * and saving one would make a decision on behalf of a future run that has not
 * been started yet. Named here rather than inferred from the absence of a rex
 * key so the 400 can say which key it refused and why.
 */
const LAUNCH_ONLY_KEYS: ReadonlySet<string> = new Set(["fresh", "allowDirty", "resetDeferred"]);

/**
 * A short fingerprint of a task's saved block, used to detect a save racing
 * another writer.
 *
 * Canonical — keys sorted — so two blocks that differ only in key order share a
 * version and a save between them is not reported as a conflict. `"none"` for a
 * task carrying nothing, which is a real state the client can hold and send
 * back: it means "I believe this task has no saved settings".
 *
 * Deliberately not the item's `lastModified`: editing a task's title would then
 * invalidate a run-settings version the editor never touched, and every modal
 * left open would report a conflict that is not one.
 */
export function savedRunVersion(run: RunSettings | undefined | null): string {
  if (run === undefined || run === null || Object.keys(run).length === 0) return "none";
  return createHash("sha256").update(canonicalJson(run)).digest("hex").slice(0, 12);
}

/**
 * JSON with every object's keys sorted, at every depth.
 *
 * Written out rather than done with `JSON.stringify`'s array replacer, which
 * applies its whitelist at EVERY nesting level: `JSON.stringify({models:
 * {claude: "opus"}}, ["models"])` yields `{"models":{}}`, because `claude` is
 * not in the list. Every block with the same top-level keys then shared a
 * version, and two different model pins were indistinguishable — so a stale
 * save could overwrite another writer's pin with no 409, which is the single
 * thing this fingerprint exists to prevent.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** The request's `run` value, checked against both allow-lists, or the 400 to answer with. */
async function checkSavedRun(
  projectDir: string,
  input: unknown,
): Promise<{ ok: true; run: RunSettings | undefined } | { ok: false; key?: string; error: string }> {
  if (input === undefined) return { ok: false, error: 'Body must carry "run" (an object, or null to clear)' };
  // `null` and `{}` both mean "no saved settings"; rex writes neither.
  if (input === null) return { ok: true, run: undefined };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, key: "run", error: '"run" must be an object or null' };
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (LAUNCH_ONLY_KEYS.has(key)) {
      return {
        ok: false,
        key,
        error: `Run setting "${key}" is chosen per launch and cannot be saved on a task`,
      };
    }
  }
  // rex owns the schema: known keys, their types and bounds, and which vendors a
  // `models` map may name. Unknown keys are refused here.
  const checked = validateRunSettings(record);
  if (!checked.ok) return { ok: false, error: checked.error };

  const value = checked.value;
  if (!value) return { ok: true, run: undefined };

  // The project's own checks on top of the shape. Only the entry for the ACTIVE
  // vendor is checked against the catalog: a saved block is deliberately
  // vendor-agnostic, so it may carry a pin for a vendor this project is not on
  // and whose catalog we cannot ask about. Refusing those would make the block
  // un-saveable from a project that merely happens to be on a different vendor
  // today — and `ndx work` already skips a pin its vendor cannot run, with a
  // warning naming the task.
  const vendor = resolveActiveVendor(projectDir);
  for (const [key, models] of [
    ["models", value.models],
    ["reviewModels", value.reviewModels],
  ] as const) {
    const model = vendor ? (models as Record<string, string> | undefined)?.[vendor] : undefined;
    if (model === undefined) continue;
    const error = await validateCatalogModel(projectDir, vendor, model);
    if (error) return { ok: false, key, error: `Run setting "${key}.${vendor}": ${error}` };
  }
  if (value.provider !== undefined && vendor) {
    const error = validateProviderForVendor(value.provider, vendor);
    if (error) return { ok: false, key: "provider", error: `Run setting "provider": ${error}` };
  }
  return { ok: true, run: value };
}

/** PUT /api/hench/prep/:taskId — save or clear the task's own run settings. */
async function handleSave(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  taskId: string,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await readBody(req, res));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    errorResponse(res, 400, "Invalid JSON in request body");
    return true;
  }

  const version = body["version"];
  if (typeof version !== "string" || version.length === 0) {
    errorResponse(res, 400, 'Body must carry "version" (the version a GET reported)');
    return true;
  }
  const checked = await checkSavedRun(ctx.projectDir, body["run"]);
  if (!checked.ok) {
    jsonResponse(res, 400, { error: checked.error, ...(checked.key ? { key: checked.key } : {}) });
    return true;
  }

  // A workspace with no `.rex/` has no PRD to write to. Without this the store
  // fails trying to create its lock file and the route answers 500, where the
  // honest answer is the same 404 the ready list gives.
  if (!existsSync(ctx.rexDir)) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  let conflict: { saved: RunSettings | null; version: string } | null = null;
  let missing = false;
  let notAWorkItem = false;
  let updatedDoc;
  try {
    const store = await resolveStore(ctx.rexDir);
    // Read, check and write inside one transaction: the version check is only
    // worth having if nothing can land between the read it compares against and
    // the write it guards.
    updatedDoc = await store.withTransaction(async (doc) => {
      const entry = findItem(doc.items, taskId);
      if (!entry) {
        missing = true;
        return doc;
      }
      if (!isWorkItem(entry.item.level)) {
        notAWorkItem = true;
        return doc;
      }
      const current = entry.item.run as RunSettings | undefined;
      const currentVersion = savedRunVersion(current);
      if (currentVersion !== version) {
        conflict = { saved: current ?? null, version: currentVersion };
        return doc;
      }
      // `undefined` removes the block: the serializer skips an absent `run`.
      updateInTree(doc.items, taskId, { run: checked.run } as never);
      return doc;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The lock failure names the holder's PID, which is the most useful fact in
    // it — passed through rather than replaced with wording of our own.
    errorResponse(res, message.includes("Could not acquire PRD lock") ? 409 : 500, message);
    return true;
  }

  if (missing) {
    errorResponse(res, 404, `Task "${taskId}" not found`);
    return true;
  }
  if (notAWorkItem) {
    errorResponse(res, 400, `Item "${taskId}" is not a task or subtask, so it cannot carry run settings`);
    return true;
  }
  if (conflict) {
    const current = conflict as { saved: RunSettings | null; version: string };
    // The current values travel with the refusal so the client can show what it
    // would overwrite and offer to do so — resending with this version is the
    // overwrite.
    jsonResponse(res, 409, {
      error: "These run settings were changed by someone else since you loaded them",
      conflict: true,
      saved: current.saved,
      version: current.version,
    });
    return true;
  }

  // The watcher will catch up on its own; refreshing here makes the change
  // visible to the next read in this process rather than one tick later.
  refreshPRDCache(ctx.rexDir, updatedDoc);
  if (broadcast) {
    broadcast({
      type: "rex:item-updated",
      itemId: taskId,
      updates: { run: checked.run ?? null },
      timestamp: new Date().toISOString(),
    });
  }

  const workspace = await workspaceOf(ctx, {});
  jsonResponse(res, 200, {
    saved: checked.run ?? null,
    version: savedRunVersion(checked.run),
    // The modal says "Saved on branch <name>; lands when the branch merges" off
    // the anchor, so it needs to know which workspace took the write.
    workspace: { key: workspace.key, branch: workspace.branch, isAnchor: workspace.isAnchor },
  });
  return true;
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
    // What a save must send back, so a PUT can tell "nothing changed since I
    // loaded this" from "someone else saved in between".
    savedVersion: savedRunVersion(entry?.item.run as RunSettings | undefined),
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
      saved: savedRunVersion(item.run as RunSettings | undefined) !== "none",
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
  broadcast?: WebSocketBroadcaster,
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
  // The PUT writes the PRD, so a foreign page must not reach it either — the
  // browser's preflight already blocks the common shapes, but the write is what
  // matters and it is refused here rather than relying on that.
  if (method === "PUT") {
    return isForeignSiteRequest(req) ? refuseForeignSite(res) : handleSave(req, res, ctx, taskId, broadcast);
  }
  if (method !== "GET") return false;
  return isForeignSiteRequest(req) ? refuseForeignSite(res) : handlePrep(req, res, ctx, taskId);
}
