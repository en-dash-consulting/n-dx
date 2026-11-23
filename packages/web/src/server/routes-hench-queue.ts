/**
 * The planned run queue: the task ids the person lined up for the agent, in
 * order (`<hench dir>/run-queue.json`). `ndx work` reads the same file and
 * takes its first item that can run before rex's own pick, taking it off
 * (hench `queue/run-queue.ts` owns that side; the two share the file format,
 * not code).
 *
 *   GET /api/hench/queue → { items: QueueItemWire[] }
 *   PUT /api/hench/queue   { taskIds: string[] } → the queue as saved, like GET
 *
 * A PUT replaces the whole order: the panel sends it after an add, a move or a
 * removal. Each kept item keeps when it was first added. The file is written
 * to a temporary name and renamed, so `ndx work` never reads half a queue.
 *
 * @module web/server/routes-hench-queue
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

function writeQueueFile(path: string, items: readonly QueueFileItem[]): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ version: 1, items }, null, 2)}\n`, "utf-8");
  renameSync(temp, path);
}

/** The order a PUT asks for: strings only, trimmed, first occurrence kept. Null when the body is not one. */
export function parseQueueOrder(body: unknown): string[] | null {
  const ids = (body as { taskIds?: unknown } | null)?.taskIds;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return null;
  return [...new Set((ids as string[]).map((id) => id.trim()).filter(Boolean))];
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
export async function handleHenchQueueRoute(req: IncomingMessage, res: ServerResponse, ctx: ServerContext): Promise<boolean> {
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
    const added = new Map(readQueueFile(file).map((item) => [item.taskId, item.addedAt]));
    const now = new Date().toISOString();
    const items = order.map((taskId) => ({ taskId, addedAt: added.get(taskId) || now }));
    try {
      writeQueueFile(file, items);
    } catch (err) {
      errorResponse(res, 500, `Could not save the run queue: ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }
    jsonResponse(res, 200, { items: describe(ctx, items) });
    return true;
  }

  errorResponse(res, 405, "Method not allowed");
  return true;
}
