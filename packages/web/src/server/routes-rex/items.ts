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
  type ItemStatus,
  type TreeEntry,
  computeTimestampUpdates,
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

/** Handle PATCH /api/rex/items/:id */
async function handleItemPatch(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  itemId: string,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  try {
    const body = await readBody(req);
    const updates = JSON.parse(body) as Record<string, unknown>;

    // Use the PRDStore so writes go to the correct backend (prd_tree/ or prd.md)
    // rather than always writing to prd.md via savePRDSync.
    const store = await resolveStore(ctx.rexDir);
    const existing = await store.getItem(itemId);
    if (!existing) {
      errorResponse(res, 404, `Item "${itemId}" not found`);
      return true;
    }

    // Validate status if provided (same rule as bulk update)
    if (updates.status && !API_SETTABLE_STATUSES.has(updates.status as string)) {
      errorResponse(res, 400, `Invalid status: ${updates.status}`);
      return true;
    }

    // Auto-apply timestamp transitions (startedAt/completedAt) on status change,
    // matching the bulk-update path's updateInTree wrapper.
    if (updates.status && existing.status !== updates.status) {
      Object.assign(
        updates,
        computeTimestampUpdates(existing.status, updates.status as ItemStatus, existing),
      );
    }

    await store.updateItem(itemId, updates as Partial<import("../rex-gateway.js").PRDItem>);

    // Refresh the in-process cache immediately so subsequent loadPRDSync calls
    // see the change before the folder-tree watcher fires.
    const updatedDoc = await store.loadDocument();
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
    errorResponse(res, 400, String(err));
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
    const body = await readBody(req);
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
    const body = await readBody(req);
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
    const body = await readBody(req);
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
