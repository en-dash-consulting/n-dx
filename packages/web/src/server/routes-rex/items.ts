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
import { resolveStore, isChangeLayerStore, completeV2Work, cascadeParentCompletion } from "../rex-gateway.js";
import { getIndexMarkdown } from "./index-markdown.js";

import {
  type PRDItem,
  type TreeEntry,
  isPriority,
  validateMerge,
  previewMerge,
  mergeItems,
  validateChangesMerge,
  mergeChanges,
  type ChangesMergeOutcome,
} from "../rex-gateway.js";
import {
  type ItemType,
  childTypeOf,
  isItemType,
  isProductType,
  isValidParentType,
  itemTypeOf,
  levelOf,
  parentTypesOf,
} from "../../shared/index.js";

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
 * (id, type, timestamps, blockedBy, children). A node's type is set when it is
 * added and changed by `move_item`, never by an edit.
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

/**
 * Complete the ancestors a v1 status write finished, as `rex update` does.
 *
 * Without it, closing a feature's last task here left the feature and its epic
 * pending with every child done; selection then picked the empty feature as
 * the next task and `ndx loop` handed a run nothing to do. v2 completion
 * cascades inside rex's own `completeV2Work`, so this is the v1 path only.
 */
async function cascadeV1Completion(
  ctx: ServerContext,
  store: Awaited<ReturnType<typeof resolveStore>>,
  ids: readonly string[],
): Promise<Array<{ id: string; title: string; level: string }>> {
  const completed: Array<{ id: string; title: string; level: string }> = [];
  for (const id of ids) completed.push(...await cascadeParentCompletion(store, id, { projectDir: ctx.projectDir }));
  return completed;
}

/**
 * Refresh the in-process cache (so the next read sees the write before the
 * folder-tree watcher fires) and tell connected clients what changed.
 */
async function publishItemUpdate(
  ctx: ServerContext,
  store: Awaited<ReturnType<typeof resolveStore>>,
  itemId: string,
  updates: Record<string, unknown>,
  broadcast?: WebSocketBroadcaster,
): Promise<void> {
  refreshPRDCache(ctx.rexDir, await store.loadDocument());
  broadcast?.({ type: "rex:item-updated", itemId, updates, timestamp: new Date().toISOString() });
}

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
    // On a v2 tree completing work follows the change layer's rules (a task's
    // change closes with its last task, an applied change amends the product
    // layer), so it goes through rex's completion, not a status write. Any
    // other field, and every other status, goes through the store as on v1.
    const completing = updates.status === "completed" && isChangeLayerStore(store);
    const fieldUpdates = { ...updates };
    if (completing) delete fieldUpdates.status;
    // Completion first, as `rex update` does: a refused completion throws before
    // anything is written, so a PATCH never half-applies.
    const completion = completing ? await completeV2Work(store, itemId) : undefined;
    if (Object.keys(fieldUpdates).length > 0 || !completing) {
      try {
        await store.withTransaction(async (doc) => {
          if (!updateInTree(doc.items, itemId, fieldUpdates as Partial<PRDItem>)) {
            throw new ItemNotFoundError(`Item "${itemId}" not found`);
          }
        });
      } catch (err) {
        if (!completing) throw err;
        // The completion is already on disk: publish it, and say the fields were not saved.
        await publishItemUpdate(ctx, store, itemId, { status: "completed" }, broadcast);
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Completed "${itemId}", but its other fields were not saved: ${message}`);
      }
    }
    const autoCompleted = !completing && updates.status === "completed"
      ? await cascadeV1Completion(ctx, store, [itemId])
      : [];
    await publishItemUpdate(ctx, store, itemId, updates, broadcast);
    // The item event names one item; the ancestors that closed with it need a
    // whole-tree refresh in every open viewer.
    if (autoCompleted.length > 0) broadcast?.({ type: "rex:prd-changed", timestamp: new Date().toISOString() });
    // Say why a change was held open or left unapplied (rex.applyOn), so the dashboard can.
    jsonResponse(res, 200, {
      ok: true,
      ...(completion?.reason ? { applied: completion.applied, reason: completion.reason } : {}),
      ...(autoCompleted.length > 0 ? { autoCompleted } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ItemNotFoundError) {
      errorResponse(res, 404, message);
    } else if (message.startsWith("No live ")) {
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
  const type = itemTypeOf(item);
  const level = levelOf(type);
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
    detail: `Deleted ${type} "${title}" and its descendants (via web)`,
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
      itemType: type,
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

  jsonResponse(res, 200, { ok: true, id: itemId, type, level, title });
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
      /** Node type (`change`, `task`, …). `level` is the accepted v1 spelling. */
      type?: string;
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

    // v2: the item is a change in the Inbox, placed later. Levels are a v1
    // notion and are ignored. Only a change can be added here: any other
    // `type` is refused, and so is a parent.
    if (isChangeLayerStore(store)) {
      if (input.type !== undefined && input.type !== "change") {
        errorResponse(
          res,
          400,
          `Quick Add on a v2 project creates a change, not a ${String(input.type)}. ` +
            'Omit type (or send "change") for an Inbox change, or use `rex add --type=<type> --parent=<id>` (or MCP add_item).',
        );
        return true;
      }
      if (input.parentId) {
        errorResponse(
          res,
          400,
          "Quick Add does not add a task under a change. " +
            "Use Add with no parent for an Inbox change, or `rex add --type=task --parent=<id>` (or MCP add_item).",
        );
        return true;
      }
      return await addInboxChange(res, ctx, store, { ...input, title: input.title.trim() }, broadcast);
    }

    const parentId = input.parentId;
    let parent: PRDItem | null = null;
    if (parentId) {
      parent = await store.getItem(parentId);
      if (!parent) {
        errorResponse(res, 400, `Parent "${parentId}" not found`);
        return true;
      }
    }

    // Resolve the type: explicit > the parent's child type > the root type.
    const parentType = parent ? itemTypeOf(parent) : undefined;
    const requested = itemTypeOf(input);
    let type: ItemType;
    if (requested) {
      if (!isItemType(requested)) {
        errorResponse(res, 400, `Unknown type: "${requested}"`);
        return true;
      }
      type = requested;
    } else if (parentType) {
      const inferred = childTypeOf(parentType);
      if (!inferred) {
        errorResponse(res, 400, `Cannot infer a child type for a ${parentType}`);
        return true;
      }
      type = inferred;
    } else {
      type = "epic";
    }

    // Validate the parent-child relationship before touching the store.
    if (!isValidParentType(type, parentType ?? null)) {
      const allowed = parentTypesOf(type);
      if (!parentId) {
        errorResponse(res, 400, `A ${type} requires a parent (${allowed.join(" or ")})`);
      } else {
        errorResponse(res, 400, `A ${type} must be a child of a ${allowed.join(" or ")}, not a ${parentType}`);
      }
      return true;
    }

    // The store behind this route is still v1, which has no level for a
    // product-layer node. Refusing names the reason rather than writing the
    // node out as an epic that reads back as something it is not.
    const level = levelOf(type, parentType);
    if (!level) {
      const why = isProductType(type)
        ? `the product layer is not writable through this route yet`
        : `it has no v1 level`;
      errorResponse(res, 400, `Cannot add a ${type}: ${why}`);
      return true;
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
      detail: `Added ${type}: ${item.title} (via web)`,
    });

    if (broadcast) {
      broadcast({
        type: "rex:prd-changed",
        timestamp: new Date().toISOString(),
      });
    }

    // `level` rides along for a client still reading the v1 spelling.
    jsonResponse(res, 201, { ok: true, id, type, level, title: item.title });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/**
 * Add an Inbox change to a v2 tree: a root change that neither amends nor
 * touches anything carries `needsPlacement`, as rex's `add_item` makes it.
 * Slug and rule checks are the change-layer store's.
 */
async function addInboxChange(
  res: ServerResponse,
  ctx: ServerContext,
  store: Parameters<typeof completeV2Work>[0],
  input: { title: string; description?: string; priority?: string; tags?: string[]; acceptanceCriteria?: string[] },
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const id = randomUUID();
  const item = { id, title: input.title, status: "pending", level: "epic", type: "change", needsPlacement: true } as PRDItem;
  if (input.description) item.description = input.description;
  if (input.priority && isPriority(input.priority)) item.priority = input.priority;
  if (Array.isArray(input.tags)) item.tags = input.tags;
  if (Array.isArray(input.acceptanceCriteria)) item.acceptanceCriteria = input.acceptanceCriteria;

  await store.addItem(item);
  refreshPRDCache(ctx.rexDir, await store.loadDocument());
  appendLog(ctx, {
    timestamp: new Date().toISOString(),
    event: "item_added",
    itemId: id,
    detail: `Added change: ${input.title} (via web)`,
  });
  if (broadcast) broadcast({ type: "rex:prd-changed", timestamp: new Date().toISOString() });
  jsonResponse(res, 201, { ok: true, id, type: "change", title: input.title, needsPlacement: true });
  return true;
}

/** Handle PATCH /api/rex/items/bulk — the single PATCH's fields, applied to many ids */
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

    // The same field rules as the single PATCH, so the bulk route cannot write
    // what that one refuses (`run`, ids, timestamps, an empty title).
    const problem = validateItemPatch(input.updates);
    if (problem) {
      errorResponse(res, 400, problem);
      return true;
    }

    // Use the PRDStore's transaction so writes go to the correct backend
    // (prd_tree/ or prd.md) rather than always writing to prd.md via
    // savePRDSync.
    const store = await resolveStore(ctx.rexDir);
    // `applied` and `reason` appear only when rex held a change open or left it
    // unapplied (rex.applyOn), as in the single PATCH's answer.
    const results: Array<{ id: string; ok: boolean; error?: string; applied?: boolean; reason?: string }> = [];
    // As the single PATCH: on a v2 tree "completed" goes through rex's
    // completion (closes a change with its last task, applies amendments to the
    // product layer); any other field or status goes through the store.
    const completing = input.updates.status === "completed" && isChangeLayerStore(store);
    const fieldUpdates = { ...input.updates };
    if (completing) delete fieldUpdates.status;
    const writeFields = !completing || Object.keys(fieldUpdates).length > 0;
    let updatedDoc: Awaited<ReturnType<typeof store.loadDocument>>;
    if (completing) {
      // Completion runs first and fields are written only for the ids it
      // completed, so a refused completion writes nothing of its own. A change
      // selected with its tasks is refused while a task listed after it is
      // still open, so a refused id is retried after any pass that completed
      // something.
      const before = await store.loadDocument();
      for (const id of input.ids) results.push({ id, ok: Boolean(findItemById(before.items, id)) });
      let pending = results.filter((r) => r.ok);
      while (pending.length > 0) {
        const refused: typeof pending = [];
        for (const result of pending) {
          try {
            const completion = await completeV2Work(store, result.id);
            delete result.error;
            if (completion.reason) {
              result.applied = completion.applied;
              result.reason = completion.reason;
            }
          } catch (err) {
            result.error = err instanceof Error ? err.message : String(err);
            refused.push(result);
          }
        }
        if (refused.length === pending.length) break;
        pending = refused;
      }
      for (const result of pending) result.ok = !result.error;
      updatedDoc = await store.loadDocument();
      // A change that closed with its last task refuses its own call (not
      // open). Report the outcome, not the call: completed is what was asked.
      for (const result of results) {
        if (!result.ok && result.error && findItemById(updatedDoc.items, result.id)?.status === "completed") {
          result.ok = true;
          delete result.error;
        }
      }
      if (writeFields) {
        try {
          updatedDoc = await store.withTransaction(async (doc) => {
            for (const result of results) {
              if (result.ok) updateInTree(doc.items, result.id, { ...fieldUpdates });
            }
            return doc;
          });
        } catch (err) {
          // The completions are on disk; report them and fall through to the
          // cache refresh and broadcast below.
          const message = err instanceof Error ? err.message : String(err);
          for (const result of results) {
            if (!result.ok) continue;
            result.ok = false;
            result.error = `completed, but its other fields were not saved: ${message}`;
          }
        }
      }
    } else {
      updatedDoc = await store.withTransaction(async (doc) => {
        for (const id of input.ids) {
          // Cloned per item to get independent timestamps
          results.push({ id, ok: updateInTree(doc.items, id, { ...fieldUpdates }) });
        }
        return doc;
      });
      if (input.updates.status === "completed") {
        await cascadeV1Completion(ctx, store, results.filter((r) => r.ok).map((r) => r.id));
        updatedDoc = await store.loadDocument();
      }
    }
    for (const result of results) {
      if (!result.ok && !result.error) result.error = "not found";
    }
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
    // On a v2 tree only sibling changes merge, through rex's mergeChanges.
    const v2 = isChangeLayerStore(store);
    const options = {
      ...(input.title ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    };

    // Preview mode — read-only, no store mutation needed.
    if (input.preview) {
      const doc = await store.loadDocument();
      const validation = (v2 ? validateChangesMerge : validateMerge)(doc.items, input.sourceIds, input.targetId);
      if (!validation.valid) {
        errorResponse(res, 400, validation.error!);
        return true;
      }
      const preview = previewMerge(doc.items, input.sourceIds, input.targetId, options);
      jsonResponse(res, 200, { ok: true, preview });
      return true;
    }

    // Execute merge via the PRDStore's transaction so writes go to the
    // correct backend (prd_tree/ or prd.md) rather than always writing to
    // prd.md via savePRDSync. A refused merge mutates nothing.
    let outcome: ChangesMergeOutcome | undefined;
    const updatedDoc = await store.withTransaction(async (doc) => {
      if (v2) {
        outcome = mergeChanges(doc.items, input.sourceIds, input.targetId, options);
        return doc;
      }
      const validation = validateMerge(doc.items, input.sourceIds, input.targetId);
      outcome = validation.valid
        ? { valid: true, result: mergeItems(doc.items, input.sourceIds, input.targetId, options) }
        : { valid: false, error: validation.error! };
      return doc;
    });

    if (!outcome) {
      errorResponse(res, 500, "Merge did not produce a result");
      return true;
    }
    if (!outcome.valid) {
      errorResponse(res, 400, outcome.error);
      return true;
    }
    const result = outcome.result;

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
