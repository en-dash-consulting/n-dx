/**
 * Item CRUD routes: add, get, patch, delete, bulk update, merge.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerContext } from "../types.js";
import { jsonResponse, errorResponse, readBody } from "../response-utils.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import {
  findItemById, updateInTree,
  appendLog, API_SETTABLE_STATUSES,
} from "./rex-route-helpers.js";
import { loadPRDSync, refreshPRDCache } from "../prd-io.js";
import { resolveStore } from "../rex-gateway.js";
import { getIndexMarkdown } from "./index-markdown.js";

import {
  type PRDItem,
  type ItemLevel,
  type TreeEntry,
  LEVEL_HIERARCHY,
  CHILD_LEVEL,
  isPriority,
  isItemLevel,
  validateMerge,
  previewMerge,
  mergeItems,
} from "../rex-gateway.js";

// Re-import parentIdOf from rex-route-helpers for merge handler

/** Item CRUD routes: add, get, patch, bulk update, merge. */
export function routeItems(
  path: string, method: string,
  req: IncomingMessage, res: ServerResponse, ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
  routeItemRequirements?: (
    path: string, method: string,
    req: IncomingMessage, res: ServerResponse, ctx: ServerContext,
    itemId: string, broadcast?: WebSocketBroadcaster,
  ) => boolean | Promise<boolean>,
): boolean | Promise<boolean> {
  // POST /api/rex/items — add a new item
  if (path === "items" && method === "POST") {
    return handleItemAdd(req, res, ctx, broadcast);
  }

  // PATCH /api/rex/items/bulk — bulk status update
  if (path === "items/bulk" && method === "PATCH") {
    return handleBulkUpdate(req, res, ctx, broadcast);
  }

  // POST /api/rex/items/merge — consolidate/merge sibling items
  if (path === "items/merge" && method === "POST") {
    return handleItemMerge(req, res, ctx, broadcast);
  }

  // Routes under /api/rex/items/:id
  const itemsMatch = path.match(/^items\/([^/?]+)/);
  if (itemsMatch) {
    const itemId = itemsMatch[1];

    // GET /api/rex/items/:id/index-md — index.md content (new schema sections)
    if (path === `items/${itemId}/index-md` && method === "GET") {
      return getIndexMarkdown(res, ctx, itemId);
    }

    // Requirements sub-routes: /api/rex/items/:id/requirements[/:reqId]
    if (routeItemRequirements) {
      const reqResult = routeItemRequirements(
        path, method, req, res, ctx, itemId, broadcast,
      );
      if (reqResult !== false) return reqResult;
    }

    // GET /api/rex/items/:id — single item
    if (method === "GET") {
      const doc = loadPRDSync(ctx.rexDir);
      if (!doc) {
        errorResponse(res, 404, "No PRD data found");
        return true;
      }
      const item = findItemById(doc.items, itemId);
      if (!item) {
        errorResponse(res, 404, `Item "${itemId}" not found`);
        return true;
      }
      jsonResponse(res, 200, item);
      return true;
    }

    // PATCH /api/rex/items/:id — update item
    if (method === "PATCH") {
      return handleItemPatch(req, res, ctx, itemId, broadcast);
    }

    // DELETE /api/rex/items/:id — remove item and all descendants
    if (method === "DELETE") {
      return handleItemDelete(res, ctx, itemId, broadcast);
    }
  }

  return false;
}

/**
 * The fields the viewer edits through `PATCH /api/rex/items/:id`. Anything else
 * is refused — in particular `run`, which only the version-checked
 * `PUT /api/hench/prep/:taskId` may write, and the system-managed fields
 * (id, level, timestamps, blockedBy, children).
 */
const PATCHABLE_FIELDS = new Set([
  "status", "failureReason", "priority", "tags", "title",
  "description", "acceptanceCriteria", "requirements",
]);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

/** Returns a message naming the first problem, or null when the patch is acceptable. */
function validateItemPatch(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "Request body must be a JSON object";
  }
  const patch = body as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    if (!PATCHABLE_FIELDS.has(key)) {
      return `Field "${key}" cannot be changed through this route. Allowed: ${[...PATCHABLE_FIELDS].join(", ")}`;
    }
  }
  if (patch.status !== undefined
    && !(typeof patch.status === "string" && API_SETTABLE_STATUSES.has(patch.status))) {
    return `Invalid status: ${String(patch.status)}`;
  }
  if (patch.priority !== undefined
    && !(typeof patch.priority === "string" && isPriority(patch.priority))) {
    return `Invalid priority: ${String(patch.priority)}`;
  }
  for (const key of ["title", "description", "failureReason"] as const) {
    if (patch[key] !== undefined && typeof patch[key] !== "string") return `"${key}" must be a string`;
  }
  if (patch.title !== undefined && (patch.title as string).trim() === "") return `"title" must not be empty`;
  for (const key of ["tags", "acceptanceCriteria"] as const) {
    if (patch[key] !== undefined && !isStringArray(patch[key])) return `"${key}" must be an array of strings`;
  }
  // Requirement objects are validated by the store's document check on write.
  if (patch.requirements !== undefined && !Array.isArray(patch.requirements)) {
    return `"requirements" must be an array`;
  }
  return null;
}

class ItemNotFoundError extends Error {}

/** Handle PATCH /api/rex/items/:id */
async function handleItemPatch(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  itemId: string,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  let updates: Record<string, unknown>;
  try {
    updates = JSON.parse(await readBody(req, res)) as Record<string, unknown>;
  } catch (err) {
    errorResponse(res, 400, `Invalid JSON body: ${String(err)}`);
    return true;
  }
  const problem = validateItemPatch(updates);
  if (problem) {
    errorResponse(res, 400, problem);
    return true;
  }

  try {
    // The store, not savePRDSync, so writes reach the right backend; the whole
    // read-modify-write sits inside the lock so a concurrent writer's item is
    // not dropped. `updateInTree` applies startedAt/completedAt on a status change.
    const store = await resolveStore(ctx.rexDir);
    const updatedDoc = await store.withTransaction(async (doc) => {
      if (!updateInTree(doc.items, itemId, updates as Partial<PRDItem>)) {
        throw new ItemNotFoundError(`Item "${itemId}" not found`);
      }
      return doc;
    });

    // Refresh the in-process cache immediately so subsequent loadPRDSync calls
    // see the change before the folder-tree watcher fires.
    refreshPRDCache(ctx.rexDir, updatedDoc);

    // Broadcast change to connected WebSocket clients
    if (broadcast) {
      broadcast({
        type: "rex:item-updated",
        itemId,
        updates,
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 200, { ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ItemNotFoundError) {
      errorResponse(res, 404, message);
    } else if (message.includes("Could not acquire PRD lock")) {
      // Names the holder's PID — pass it through rather than retrying.
      errorResponse(res, 409, message);
    } else {
      errorResponse(res, 400, message);
    }
  }
  return true;
}

/** Handle DELETE /api/rex/items/:id — remove item and all descendants */
async function handleItemDelete(
  res: ServerResponse,
  ctx: ServerContext,
  itemId: string,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  // Use the PRDStore so writes go to the correct backend (prd_tree/ or
  // prd.md) rather than always writing to prd.md via savePRDSync.
  const store = await resolveStore(ctx.rexDir);
  const item = await store.getItem(itemId);
  if (!item) {
    errorResponse(res, 404, `Item "${itemId}" not found`);
    return true;
  }

  const title = item.title;
  const level = item.level;
  try {
    await store.removeItem(itemId);
  } catch (err) {
    errorResponse(res, 404, `Item "${itemId}" could not be removed: ${String(err)}`);
    return true;
  }

  const updatedDoc = await store.loadDocument();
  refreshPRDCache(ctx.rexDir, updatedDoc);

  // Append log entry
  const logPath = join(ctx.rexDir, "execution-log.jsonl");
  const logEntry = {
    timestamp: new Date().toISOString(),
    event: "item_deleted",
    itemId,
    detail: `Deleted ${level} "${title}" and its descendants (via web)`,
  };
  try {
    appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
  } catch {
    // Non-fatal — log file may not exist yet
  }

  // Broadcast change to connected WebSocket clients
  if (broadcast) {
    const timestamp = new Date().toISOString();
    broadcast({
      type: "rex:item-deleted",
      itemId,
      level,
      title,
      timestamp,
    });
    // Also broadcast generic prd-changed so sidebar status indicators refresh
    broadcast({
      type: "rex:prd-changed",
      timestamp,
    });
  }

  jsonResponse(res, 200, { ok: true, id: itemId, level, title });
  return true;
}

/** Handle POST /api/rex/items — add a new item */
async function handleItemAdd(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  try {
    const body = await readBody(req, res);
    const input = JSON.parse(body) as {
      title?: string;
      level?: string;
      parentId?: string;
      description?: string;
      priority?: string;
      tags?: string[];
      acceptanceCriteria?: string[];
    };

    if (!input.title || input.title.trim().length === 0) {
      errorResponse(res, 400, "Missing required field: title");
      return true;
    }

    // Use the PRDStore so writes go to the correct backend (prd_tree/ or
    // prd.md) rather than always writing to prd.md via savePRDSync — the
    // same fix already applied to handleItemPatch below. Writing only
    // through savePRDSync left the real folder tree untouched, so the next
    // folder-tree-watcher-triggered cache refresh (start.ts's
    // refreshPRDCache) silently reverted the addition — the item vanished
    // on reload.
    const store = await resolveStore(ctx.rexDir);

    const parentId = input.parentId;
    let parent: PRDItem | null = null;
    if (parentId) {
      parent = await store.getItem(parentId);
      if (!parent) {
        errorResponse(res, 400, `Parent "${parentId}" not found`);
        return true;
      }
    }

    // Resolve level: explicit > inferred from parent > default to epic
    let level: ItemLevel;
    if (input.level && isItemLevel(input.level)) {
      level = input.level;
    } else if (parent) {
      const parentLevel = parent.level;
      const inferred = isItemLevel(parentLevel) ? CHILD_LEVEL[parentLevel] : undefined;
      if (!inferred) {
        errorResponse(res, 400, `Cannot infer child level for parent type "${parentLevel}"`);
        return true;
      }
      level = inferred;
    } else {
      level = "epic";
    }

    // Validate parent-child level relationship
    const allowedParents = isItemLevel(level) ? LEVEL_HIERARCHY[level] : undefined;
    if (!allowedParents) {
      errorResponse(res, 400, `Unknown level: "${level}"`);
      return true;
    }
    const canBeRoot = allowedParents.includes(null);

    if (!canBeRoot && !parentId) {
      const parentNames = allowedParents.filter((p): p is ItemLevel => p !== null).join(" or ");
      errorResponse(res, 400, `A ${level} requires a parent (${parentNames})`);
      return true;
    }

    if (parent) {
      const allowedParentLevels = allowedParents.filter((p): p is ItemLevel => p !== null);
      if (allowedParentLevels.length > 0 && !allowedParentLevels.includes(parent.level)) {
        errorResponse(res, 400, `A ${level} must be a child of a ${allowedParentLevels.join(" or ")}, not a ${parent.level}`);
        return true;
      }
    }

    const id = randomUUID();
    const item: PRDItem = {
      id,
      title: input.title.trim(),
      status: "pending",
      level,
    };

    if (input.description) item.description = input.description;
    if (input.priority && isPriority(input.priority)) item.priority = input.priority;
    if (input.tags && Array.isArray(input.tags)) item.tags = input.tags;
    if (input.acceptanceCriteria && Array.isArray(input.acceptanceCriteria)) {
      item.acceptanceCriteria = input.acceptanceCriteria;
    }

    await store.addItem(item, parentId);

    // Refresh the in-process cache immediately so subsequent loadPRDSync
    // calls (including this same request's response and any fetch before
    // the watcher fires) see the change right away.
    const updatedDoc = await store.loadDocument();
    refreshPRDCache(ctx.rexDir, updatedDoc);

    // Log the addition
    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "item_added",
      itemId: id,
      detail: `Added ${level}: ${item.title} (via web)`,
    });

    if (broadcast) {
      broadcast({
        type: "rex:prd-changed",
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 201, { ok: true, id, level, title: item.title });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** Handle PATCH /api/rex/items/bulk — bulk status update */
async function handleBulkUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  try {
    const body = await readBody(req, res);
    const input = JSON.parse(body) as {
      ids: string[];
      updates: Record<string, unknown>;
    };

    if (!Array.isArray(input.ids) || input.ids.length === 0) {
      errorResponse(res, 400, "Missing required field: ids (array of item IDs)");
      return true;
    }
    if (!input.updates || typeof input.updates !== "object") {
      errorResponse(res, 400, "Missing required field: updates");
      return true;
    }

    // Validate status if provided
    if (input.updates.status && !API_SETTABLE_STATUSES.has(input.updates.status as string)) {
      errorResponse(res, 400, `Invalid status: ${input.updates.status}`);
      return true;
    }

    // Use the PRDStore's transaction so writes go to the correct backend
    // (prd_tree/ or prd.md) rather than always writing to prd.md via
    // savePRDSync.
    const store = await resolveStore(ctx.rexDir);
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    const updatedDoc = await store.withTransaction(async (doc) => {
      for (const id of input.ids) {
        // Clone updates for each item to get independent timestamps
        const itemUpdates = { ...input.updates };
        if (updateInTree(doc.items, id, itemUpdates)) {
          results.push({ id, ok: true });
        } else {
          results.push({ id, ok: false, error: "not found" });
        }
      }
      return doc;
    });
    refreshPRDCache(ctx.rexDir, updatedDoc);

    // Log the bulk update
    const successCount = results.filter((r) => r.ok).length;
    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "bulk_update",
      detail: `Bulk updated ${successCount}/${input.ids.length} items (via web)`,
    });

    if (broadcast) {
      broadcast({
        type: "rex:prd-changed",
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 200, { ok: true, results });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** Handle POST /api/rex/items/merge — consolidate/merge sibling items */
async function handleItemMerge(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  try {
    const body = await readBody(req, res);
    const input = JSON.parse(body) as {
      sourceIds: string[];
      targetId: string;
      preview?: boolean;
      title?: string;
      description?: string;
    };

    if (!Array.isArray(input.sourceIds) || input.sourceIds.length < 2) {
      errorResponse(res, 400, "sourceIds must be an array of at least 2 item IDs");
      return true;
    }
    if (!input.targetId || typeof input.targetId !== "string") {
      errorResponse(res, 400, "targetId is required");
      return true;
    }

    const store = await resolveStore(ctx.rexDir);

    // Preview mode — read-only, no store mutation needed.
    if (input.preview) {
      const doc = await store.loadDocument();
      const validation = validateMerge(doc.items, input.sourceIds, input.targetId);
      if (!validation.valid) {
        errorResponse(res, 400, validation.error!);
        return true;
      }
      const options = {
        ...(input.title ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      };
      const preview = previewMerge(doc.items, input.sourceIds, input.targetId, options);
      jsonResponse(res, 200, { ok: true, preview });
      return true;
    }

    // Execute merge via the PRDStore's transaction so writes go to the
    // correct backend (prd_tree/ or prd.md) rather than always writing to
    // prd.md via savePRDSync.
    let result: ReturnType<typeof mergeItems> | undefined;
    let validationError: string | undefined;
    const updatedDoc = await store.withTransaction(async (doc) => {
      const validation = validateMerge(doc.items, input.sourceIds, input.targetId);
      if (!validation.valid) {
        validationError = validation.error!;
        return doc;
      }
      const options = {
        ...(input.title ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      };
      result = mergeItems(doc.items, input.sourceIds, input.targetId, options);
      return doc;
    });

    if (validationError) {
      errorResponse(res, 400, validationError);
      return true;
    }
    if (!result) {
      errorResponse(res, 500, "Merge did not produce a result");
      return true;
    }

    refreshPRDCache(ctx.rexDir, updatedDoc);

    // Log the merge
    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "items_merged",
      itemId: input.targetId,
      detail: `Merged ${input.sourceIds.length} items into "${input.targetId}". Absorbed: ${result.absorbedIds.join(", ")}. ${result.reparentedChildIds.length} children reparented, ${result.rewrittenDependencyCount} dependency refs rewritten (via web).`,
    });

    if (broadcast) {
      broadcast({
        type: "rex:prd-changed",
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 200, { ok: true, ...result });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}
