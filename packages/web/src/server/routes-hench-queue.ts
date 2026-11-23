/**
 * The planned run queue: the task ids the person lined up for the agent, in
 * order (`<hench dir>/run-queue.json`). `ndx work` reads the same file and
 * takes its first item that can run before rex's own pick, taking it off
 * (hench `queue/run-queue.ts` owns that side; the two share the file format,
 * not code).
 *
 *   GET /api/hench/queue → { items: QueueItemWire[] }
 *   PUT /api/hench/queue   { taskIds: string[], base?: string[] } → the queue as saved, like GET
 *
 * A PUT replaces the whole order: the panel sends it after an add, a move or a
 * removal, with `base`, the order it last saw. When the file no longer holds
 * that order (another window saved, or `ndx work` took an item), the PUT is
 * refused with 409 and the queue as it stands, so a stale panel never puts
 * back what was taken or drops what someone else added. Each kept item keeps
 * when it was first added. The file is written
 * to a temporary name and renamed, so `ndx work` never reads half a queue.
 *
 * @module web/server/routes-hench-queue
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLayout } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { errorResponse, jsonResponse, readJsonBody } from "./response-utils.js";
import { isForeignSiteRequest, refuseForeignSite } from "./request-security.js";
import { loadPRDSync } from "./prd-io.js";
import { walkTree } from "./rex-gateway.js";

const QUEUE_PATH = "/api/hench/queue";
/** More than anyone lines up by hand; a cap keeps a bad client from writing a huge file. */
export const RUN_QUEUE_MAX = 200;

interface QueueFileItem { taskId: string; addedAt: string }

/** One queued item as the panel shows it; the task's fields are absent when it is no longer in the PRD. */
export interface QueueItemWire {
  taskId: string;
  addedAt: string;
  title?: string;
  status?: string;
  priority?: string | null;
  /** Not in the PRD any more: `ndx work` will drop it. */
  missing?: true;
}

function queueFile(ctx: ServerContext): string {
  return join(resolveLayout(ctx.projectDir).henchDir, "run-queue.json");
}

/** The saved queue; empty when the file is absent or not a queue. */
export function readQueueFile(path: string): QueueFileItem[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items.flatMap((entry) => {
      const item = entry as Partial<QueueFileItem>;
      return typeof item.taskId === "string" && item.taskId.trim() !== ""
        ? [{ taskId: item.taskId, addedAt: typeof item.addedAt === "string" ? item.addedAt : "" }]
        : [];
    });
  } catch {
    return [];
  }
}

/** How long a save waits for the queue's lock; a real hold lasts milliseconds. */
export const QUEUE_LOCK_WAIT_MS = 5_000;
/** A lock older than this was left by a writer that died: it is broken. */
export const QUEUE_LOCK_STALE_MS = 30_000;

/** The lock was still held when the wait ran out. */
export class QueueLockedError extends Error {}

/**
 * Run `fn` holding the queue's lock: `run-queue.json.lock`, created exclusively
 * beside the queue. `ndx work` takes the same lock the same way (hench
 * `queue/run-queue.ts`, `withRunQueueLock`); the two share this file contract,
 * not code. Without it a save could overwrite the item `ndx work` just took
 * off, or `ndx work` could overwrite the save.
 */
export async function withQueueLock<T>(file: string, fn: () => Promise<T>, { lockWaitMs = QUEUE_LOCK_WAIT_MS }: { lockWaitMs?: number } = {}): Promise<T> {
  mkdirSync(join(file, ".."), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + lockWaitMs;
  for (;;) {
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { encoding: "utf-8", flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > QUEUE_LOCK_STALE_MS) {
          rmSync(lock, { force: true });
          continue;
        }
      } catch {
        continue; // released between the create and the stat
      }
      if (Date.now() > deadline) throw new QueueLockedError("The run queue is being changed by another writer.");
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

function writeQueueFile(path: string, items: readonly QueueFileItem[]): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ version: 1, items }, null, 2)}\n`, "utf-8");
  renameSync(temp, path);
}

function idList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) return null;
  return [...new Set((value as string[]).map((id) => id.trim()).filter(Boolean))];
}

/** The order a PUT asks for: strings only, trimmed, first occurrence kept. Null when the body is not one. */
export function parseQueueOrder(body: unknown): string[] | null {
  return idList((body as { taskIds?: unknown } | null)?.taskIds);
}

/**
 * The order the client last saw (`base`), parsed like the order; undefined when
 * the body carries none, null when it carries one that is not a list of ids.
 */
export function parseQueueBase(body: unknown): string[] | null | undefined {
  const base = (body as { base?: unknown } | null)?.base;
  return base === undefined ? undefined : idList(base);
}

function describe(ctx: ServerContext, items: readonly QueueFileItem[]): QueueItemWire[] {
  const doc = loadPRDSync(ctx.rexDir);
  const byId = new Map<string, { title: string; status: string; priority?: string }>();
  if (doc) for (const { item } of walkTree(doc.items)) byId.set(item.id, item as { title: string; status: string; priority?: string });
  return items.map(({ taskId, addedAt }) => {
    const item = byId.get(taskId);
    return item
      ? { taskId, addedAt, title: item.title, status: item.status, priority: item.priority ?? null }
      : { taskId, addedAt, missing: true as const };
  });
}

/** Handle the run queue's routes. Resolves true when the request was one of them. */
export async function handleHenchQueueRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  options: { lockWaitMs?: number } = {},
): Promise<boolean> {
  const path = (req.url || "/").split("?")[0];
  if (path !== QUEUE_PATH) return false;
  const method = req.method || "GET";
  const file = queueFile(ctx);

  if (method === "GET") {
    jsonResponse(res, 200, { items: describe(ctx, readQueueFile(file)) });
    return true;
  }

  if (method === "PUT") {
    if (isForeignSiteRequest(req)) return refuseForeignSite(res);
    const body = await readJsonBody(req, res);
    if (body === undefined) return true;
    const order = parseQueueOrder(body);
    if (!order) {
      errorResponse(res, 400, "Expected { taskIds: string[] }");
      return true;
    }
    if (order.length > RUN_QUEUE_MAX) {
      errorResponse(res, 400, `The run queue holds at most ${RUN_QUEUE_MAX} items`);
      return true;
    }
    const base = parseQueueBase(body);
    if (base === null) {
      errorResponse(res, 400, "Expected base to be a list of task ids");
      return true;
    }
    // The read, the base check and the write happen under the queue's lock,
    // which `ndx work` takes around its own read-modify-write.
    type Outcome = { stale: QueueFileItem[] } | { saved: QueueFileItem[] };
    let outcome: Outcome;
    try {
      outcome = await withQueueLock(file, async () => {
        const current = readQueueFile(file);
        if (base && JSON.stringify(current.map((item) => item.taskId)) !== JSON.stringify(base)) return { stale: current };
        const added = new Map(current.map((item) => [item.taskId, item.addedAt]));
        const now = new Date().toISOString();
        const items = order.map((taskId) => ({ taskId, addedAt: added.get(taskId) || now }));
        writeQueueFile(file, items);
        return { saved: items };
      }, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof QueueLockedError) errorResponse(res, 503, `${message} Try again.`);
      else errorResponse(res, 500, `Could not save the run queue: ${message}`);
      return true;
    }
    if ("stale" in outcome) {
      jsonResponse(res, 409, { error: "The run queue changed since it was read", items: describe(ctx, outcome.stale) });
      return true;
    }
    jsonResponse(res, 200, { items: describe(ctx, outcome.saved) });
    return true;
  }

  errorResponse(res, 405, "Method not allowed");
  return true;
}
