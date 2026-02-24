/**
 * Rex API routes — CRUD for PRD items, tree stats, next task, and log entries.
 *
 * All endpoints are under /api/rex/.
 *
 * GET   /api/rex/prd              — full PRD document
 * GET   /api/rex/stats            — tree stats (total, completed, etc.)
 * GET   /api/rex/dashboard        — dashboard data (stats + per-epic + next task + priority dist)
 * GET   /api/rex/next             — next actionable task
 * GET   /api/rex/items/:id        — single item by ID
 * POST  /api/rex/items            — add a new item
 * PATCH /api/rex/items/:id        — update item fields
 * PATCH /api/rex/items/bulk       — bulk update multiple items
 * POST  /api/rex/items/merge     — consolidate/merge sibling items
 * GET   /api/rex/prune/preview    — preview items that would be pruned
 * POST  /api/rex/prune            — execute prune (removes completed subtrees)
 * POST  /api/rex/analyze          — trigger analysis (scan project)
 * GET   /api/rex/proposals        — get pending proposals
 * POST  /api/rex/proposals/accept — accept pending proposals
 * POST  /api/rex/proposals/accept-edited — accept edited proposals (inline-edited data)
 * POST  /api/rex/smart-add-preview — generate proposals from natural language (real-time preview)
 * POST  /api/rex/batch-import     — process multiple ideas from various sources with consolidated review
 * GET   /api/rex/log              — execution log (?limit=N)
 * GET   /api/rex/items/:id/requirements       — get requirements for item (own + inherited)
 * POST  /api/rex/items/:id/requirements       — add a requirement to item
 * PATCH /api/rex/items/:id/requirements/:rid  — update a requirement
 * DELETE /api/rex/items/:id/requirements/:rid — delete a requirement
 * GET   /api/rex/requirements/coverage        — requirements coverage stats
 * GET   /api/rex/requirements/traceability    — traceability matrix
 * POST  /api/rex/execute/epic-by-epic — start epic-by-epic execution
 * GET   /api/rex/execute/status       — current execution state
 * POST  /api/rex/execute/pause        — pause execution
 * POST  /api/rex/execute/resume       — resume execution
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { exec as foundationExec, spawnManaged, type ManagedChild } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./types.js";
import type { WebSocketBroadcaster } from "./websocket.js";

import {
  type Priority,
  type ItemLevel,
  type ItemStatus,
  type PRDItem,
  type PRDDocument,
  type TreeEntry,
  type TreeStats,
  type MergeValidation,
  type EpicStats,
  type PriorityDistribution,
  type RequirementsSummary,
  PRIORITY_ORDER,
  LEVEL_HIERARCHY,
  VALID_LEVELS,
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_REQUIREMENT_CATEGORIES,
  VALID_VALIDATION_TYPES,
  CHILD_LEVEL,
  isPriority,
  isItemLevel,
  isRequirementCategory,
  isValidationType,
  findItem,
  walkTree,
  insertChild as rexInsertChild,
  updateInTree as rexUpdateInTree,
  removeFromTree,
  computeStats,
  findNextTask as rexFindNextTask,
  collectCompletedIds,
  computeTimestampUpdates,
  validateMerge,
  previewMerge,
  mergeItems,
  countSubtree,
  isFullyCompleted,
  findPrunableItems,
  pruneItems,
  computeEpicStats,
  computePriorityDistribution,
  computeRequirementsSummary,
} from "./rex-gateway.js";

const REX_PREFIX = "/api/rex/";

/**
 * API-settable statuses — excludes "deleted" from the canonical set.
 * Deleted items shouldn't be settable via the API.
 */
const API_SETTABLE_STATUSES = new Set<string>(
  [...VALID_STATUSES].filter((s) => s !== "deleted"),
);

// ---------------------------------------------------------------------------
// Thin wrappers over canonical rex functions
// ---------------------------------------------------------------------------
// These adapt the rex API to the patterns used throughout this file.
// The underlying logic lives in rex — no duplication.

/** Find an item by ID, returning just the item (or null). */
function findItemById(items: PRDItem[], id: string): PRDItem | null {
  const entry = findItem(items, id);
  return entry ? entry.item : null;
}

/**
 * Insert a child under a parent. Skips rex's hierarchy validation since the
 * web API validates level separately and some batch-import paths construct
 * items with the correct level pre-set.
 */
function insertChild(items: PRDItem[], parentId: string, child: PRDItem): boolean {
  return rexInsertChild(items, parentId, child);
}

/**
 * Update an item in the tree, automatically applying timestamp transitions
 * (startedAt / completedAt) via the canonical `computeTimestampUpdates`.
 */
function updateInTree(
  items: PRDItem[],
  id: string,
  updates: Partial<PRDItem>,
): boolean {
  // Auto-apply timestamps when status changes
  if (updates.status) {
    const existing = findItemById(items, id);
    if (existing && existing.status !== updates.status) {
      const tsUpdates = computeTimestampUpdates(
        existing.status,
        updates.status as ItemStatus,
        existing,
      );
      Object.assign(updates, tsUpdates);
    }
  }
  return rexUpdateInTree(items, id, updates);
}

/** Find the next actionable task, returning just the item (or null). */
function findNextTask(items: PRDItem[], completedIds: Set<string>): PRDItem | null {
  const entry = rexFindNextTask(items, completedIds);
  return entry ? entry.item : null;
}

/** Load and parse prd.json. Returns null if not found. */
function loadPRD(ctx: ServerContext): PRDDocument | null {
  const prdPath = join(ctx.rexDir, "prd.json");
  if (!existsSync(prdPath)) return null;
  try {
    return JSON.parse(readFileSync(prdPath, "utf-8")) as PRDDocument;
  } catch {
    return null;
  }
}

/** Save prd.json. */
function savePRD(ctx: ServerContext, doc: PRDDocument): void {
  const prdPath = join(ctx.rexDir, "prd.json");
  writeFileSync(prdPath, JSON.stringify(doc, null, 2) + "\n");
}

// EpicStats, PriorityDistribution, RequirementsSummary types and functions
// are imported from rex via the gateway (domain-gateway.ts).

// ---------------------------------------------------------------------------
// Sub-routers — each handles a focused domain area within the Rex API.
// The main handleRexRoute dispatcher tries each in turn.
// ---------------------------------------------------------------------------

/** PRD read routes: prd, stats, dashboard, next, log. */
function routePrdReads(
  url: string, path: string, method: string,
  res: ServerResponse, ctx: ServerContext,
): boolean {
  // GET /api/rex/prd — full PRD document
  if (path === "prd" && method === "GET") {
    const doc = loadPRD(ctx);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    jsonResponse(res, 200, doc);
    return true;
  }

  // GET /api/rex/stats — tree stats
  if (path === "stats" && method === "GET") {
    const doc = loadPRD(ctx);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    const stats = computeStats(doc.items);
    jsonResponse(res, 200, {
      title: doc.title,
      stats,
      percentComplete: stats.total > 0
        ? Math.round((stats.completed / stats.total) * 100)
        : 0,
    });
    return true;
  }

  // GET /api/rex/dashboard — dashboard data (overall + per-epic + next task + priority distribution)
  if (path === "dashboard" && method === "GET") {
    const doc = loadPRD(ctx);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    const stats = computeStats(doc.items);
    const completedIds = collectCompletedIds(doc.items);
    const next = findNextTask(doc.items, completedIds);
    const epics = computeEpicStats(doc.items);
    const priorities = computePriorityDistribution(doc.items);
    const reqSummary = computeRequirementsSummary(doc.items);
    jsonResponse(res, 200, {
      title: doc.title,
      stats,
      percentComplete: stats.total > 0
        ? Math.round((stats.completed / stats.total) * 100)
        : 0,
      epics,
      nextTask: next,
      priorities,
      requirements: reqSummary,
    });
    return true;
  }

  // GET /api/rex/next — next actionable task
  if (path === "next" && method === "GET") {
    const doc = loadPRD(ctx);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    const completedIds = collectCompletedIds(doc.items);
    const next = findNextTask(doc.items, completedIds);
    if (!next) {
      jsonResponse(res, 200, { task: null, message: "All tasks completed or blocked" });
      return true;
    }
    jsonResponse(res, 200, { task: next });
    return true;
  }

  // GET /api/rex/log — execution log
  if (path === "log" && method === "GET") {
    const logPath = join(ctx.rexDir, "execution-log.jsonl");
    if (!existsSync(logPath)) {
      jsonResponse(res, 200, { entries: [] });
      return true;
    }
    try {
      const raw = readFileSync(logPath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);

      // Parse limit from query string
      const queryIdx = url.indexOf("?");
      let limit = 0;
      if (queryIdx !== -1) {
        const params = new URLSearchParams(url.slice(queryIdx));
        const limitStr = params.get("limit");
        if (limitStr) limit = parseInt(limitStr, 10);
      }

      const entries = lines
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);

      const result = limit > 0 ? entries.slice(-limit) : entries;
      jsonResponse(res, 200, { entries: result });
    } catch {
      jsonResponse(res, 200, { entries: [] });
    }
    return true;
  }

  return false;
}

/** Item CRUD routes: add, get, patch, bulk update, merge. */
function routeItems(
  path: string, method: string,
  req: IncomingMessage, res: ServerResponse, ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
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

    // Requirements sub-routes: /api/rex/items/:id/requirements[/:reqId]
    const reqResult = routeItemRequirements(
      path, method, req, res, ctx, itemId, broadcast,
    );
    if (reqResult !== false) return reqResult;

    // GET /api/rex/items/:id — single item
    if (method === "GET") {
      const doc = loadPRD(ctx);
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
  }

  return false;
}

/** Item requirements sub-routes: CRUD on /api/rex/items/:id/requirements. */
function routeItemRequirements(
  path: string, method: string,
  req: IncomingMessage, res: ServerResponse, ctx: ServerContext,
  itemId: string, broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  const reqSubMatch = path.match(/^items\/[^/?]+\/requirements(?:\/([^/?]+))?$/);
  if (!reqSubMatch) return false;

  const reqId = reqSubMatch[1]; // undefined for collection routes

  // GET /api/rex/items/:id/requirements — list requirements (own + inherited)
  if (method === "GET" && !reqId) {
    return handleGetRequirements(res, ctx, itemId);
  }

  // POST /api/rex/items/:id/requirements — add a requirement
  if (method === "POST" && !reqId) {
    return handleAddRequirement(req, res, ctx, itemId, broadcast);
  }

  // PATCH /api/rex/items/:id/requirements/:reqId — update a requirement
  if (method === "PATCH" && reqId) {
    return handleUpdateRequirement(req, res, ctx, itemId, reqId, broadcast);
  }

  // DELETE /api/rex/items/:id/requirements/:reqId — delete a requirement
  if (method === "DELETE" && reqId) {
    return handleDeleteRequirement(res, ctx, itemId, reqId, broadcast);
  }

  return false;
}

/** Requirements coverage & traceability top-level routes. */
function routeRequirementsAnalytics(
  path: string, method: string,
  res: ServerResponse, ctx: ServerContext,
): boolean {
  if (path === "requirements/coverage" && method === "GET") {
    return handleRequirementsCoverage(res, ctx);
  }

  if (path === "requirements/traceability" && method === "GET") {
    return handleRequirementsTraceability(res, ctx);
  }

  return false;
}

/** Prune routes: preview and execute. */
function routePrune(
  path: string, method: string,
  req: IncomingMessage, res: ServerResponse, ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  // GET /api/rex/prune/preview — preview prunable items (supports criteria params)
  if (path === "prune/preview" && method === "GET") {
    return handlePrunePreview(req, res, ctx);
  }

  // POST /api/rex/prune — execute prune with optional backup
  if (path === "prune" && method === "POST") {
    return handlePruneExecute(req, res, ctx, broadcast);
  }

  return false;
}

/** Analysis and proposal routes: analyze, proposals, smart-add, batch-import. */
function routeProposals(
  path: string, method: string,
  req: IncomingMessage, res: ServerResponse, ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  // POST /api/rex/analyze — trigger analysis
  if (path === "analyze" && method === "POST") {
    return handleAnalyze(req, res, ctx, broadcast);
  }

  // GET /api/rex/proposals — get pending proposals
  if (path === "proposals" && method === "GET") {
    return handleGetProposals(res, ctx);
  }

  // POST /api/rex/proposals/accept — accept pending proposals
  if (path === "proposals/accept" && method === "POST") {
    return handleAcceptProposals(req, res, ctx, broadcast);
  }

  // POST /api/rex/proposals/accept-edited — accept edited proposals (inline-edited data)
  if (path === "proposals/accept-edited" && method === "POST") {
    return handleAcceptEditedProposals(req, res, ctx, broadcast);
  }

  // POST /api/rex/smart-add-preview — generate proposals from natural language (real-time preview)
  if (path === "smart-add-preview" && method === "POST") {
    return handleSmartAddPreview(req, res, ctx);
  }

  // POST /api/rex/batch-import — process multiple ideas from various sources
  if (path === "batch-import" && method === "POST") {
    return handleBatchImport(req, res, ctx, broadcast);
  }

  return false;
}

/** Execution routes: epic-by-epic, status, pause, resume. */
function routeExecution(
  path: string, method: string,
  req: IncomingMessage, res: ServerResponse, ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  // POST /api/rex/execute/epic-by-epic — start epic-by-epic execution
  if (path === "execute/epic-by-epic" && method === "POST") {
    return handleStartEpicByEpic(req, res, ctx, broadcast);
  }

  // GET /api/rex/execute/status — current execution state
  if (path === "execute/status" && method === "GET") {
    return handleExecutionStatus(res);
  }

  // POST /api/rex/execute/pause — pause execution
  if (path === "execute/pause" && method === "POST") {
    return handleExecutionPause(res, broadcast);
  }

  // POST /api/rex/execute/resume — resume execution
  if (path === "execute/resume" && method === "POST") {
    return handleExecutionResume(res, ctx, broadcast);
  }

  return false;
}

/**
 * Handle Rex API requests. Returns true if the request was handled.
 *
 * Delegates to focused sub-routers for each domain area:
 * - PRD reads (prd, stats, dashboard, next, log)
 * - Item CRUD (add, get, patch, bulk, merge)
 * - Requirements (item requirements CRUD, coverage, traceability)
 * - Prune (preview, execute)
 * - Proposals (analyze, proposals, smart-add, batch-import)
 * - Execution (epic-by-epic, status, pause, resume)
 */
export function handleRexRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (!url.startsWith(REX_PREFIX)) return false;

  const fullPath = url.slice(REX_PREFIX.length);
  const qIdx = fullPath.indexOf("?");
  const path = qIdx === -1 ? fullPath : fullPath.slice(0, qIdx);

  // Try each sub-router in turn. The first to return non-false wins.
  const prdResult = routePrdReads(url, path, method, res, ctx);
  if (prdResult !== false) return prdResult;

  const itemsResult = routeItems(path, method, req, res, ctx, broadcast);
  if (itemsResult !== false) return itemsResult;

  const reqAnalyticsResult = routeRequirementsAnalytics(path, method, res, ctx);
  if (reqAnalyticsResult !== false) return reqAnalyticsResult;

  const pruneResult = routePrune(path, method, req, res, ctx, broadcast);
  if (pruneResult !== false) return pruneResult;

  const proposalResult = routeProposals(path, method, req, res, ctx, broadcast);
  if (proposalResult !== false) return proposalResult;

  const execResult = routeExecution(path, method, req, res, ctx, broadcast);
  if (execResult !== false) return execResult;

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
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  try {
    const body = await readBody(req);
    const updates = JSON.parse(body);

    if (!updateInTree(doc.items, itemId, updates)) {
      errorResponse(res, 404, `Item "${itemId}" not found`);
      return true;
    }

    savePRD(ctx, doc);

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

/** Handle POST /api/rex/items — add a new item */
async function handleItemAdd(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

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

    const parentId = input.parentId;

    // Resolve level: explicit > inferred from parent > default to epic
    let level: ItemLevel;
    if (input.level && isItemLevel(input.level)) {
      level = input.level;
    } else if (parentId) {
      const parent = findItemById(doc.items, parentId);
      if (!parent) {
        errorResponse(res, 400, `Parent "${parentId}" not found`);
        return true;
      }
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

    if (parentId) {
      const parent = findItemById(doc.items, parentId);
      if (!parent) {
        errorResponse(res, 400, `Parent "${parentId}" not found`);
        return true;
      }
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

    if (parentId) {
      insertChild(doc.items, parentId, item);
    } else {
      doc.items.push(item);
    }

    savePRD(ctx, doc);

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
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

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

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of input.ids) {
      // Clone updates for each item to get independent timestamps
      const itemUpdates = { ...input.updates };
      if (updateInTree(doc.items, id, itemUpdates)) {
        results.push({ id, ok: true });
      } else {
        results.push({ id, ok: false, error: "not found" });
      }
    }

    savePRD(ctx, doc);

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

// Merge functions (validateMerge, previewMerge, mergeItems) are imported
// from rex via the gateway (domain-gateway.ts).

/** Extract the parent ID from a TreeEntry's parent chain. */
function parentIdOf(entry: TreeEntry): string | null {
  return entry.parents.length > 0 ? entry.parents[entry.parents.length - 1].id : null;
}

/** Handle POST /api/rex/items/merge — consolidate/merge sibling items */
async function handleItemMerge(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

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

    const validation = validateMerge(doc.items, input.sourceIds, input.targetId);
    if (!validation.valid) {
      errorResponse(res, 400, validation.error!);
      return true;
    }

    const options = {
      ...(input.title ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    };

    // Preview mode
    if (input.preview) {
      const preview = previewMerge(doc.items, input.sourceIds, input.targetId, options);
      jsonResponse(res, 200, { ok: true, preview });
      return true;
    }

    // Execute merge
    const result = mergeItems(doc.items, input.sourceIds, input.targetId, options);
    savePRD(ctx, doc);

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

// Prune functions (isFullyCompleted, countSubtree, findPrunableItems, pruneItems)
// are imported from rex via the gateway (domain-gateway.ts).

/**
 * Remove specific subtrees by ID from the item tree.
 * Web-specific variant for criteria-based pruning where items are pre-identified.
 */
function pruneItemsByIds(
  items: PRDItem[],
  ids: Set<string>,
): { pruned: PRDItem[]; prunedCount: number } {
  const pruned: PRDItem[] = [];
  let prunedCount = 0;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (ids.has(item.id)) {
      pruned.unshift(item);
      prunedCount += countSubtree(item);
      items.splice(i, 1);
    } else if (Array.isArray(item.children) && item.children.length > 0) {
      const childResult = pruneItemsByIds(item.children, ids);
      pruned.push(...childResult.pruned);
      prunedCount += childResult.prunedCount;
    }
  }

  return { pruned, prunedCount };
}

/** Summarize a prunable item for API response. */
function summarizeItem(item: PRDItem): {
  id: string;
  title: string;
  level: string;
  status: string;
  childCount: number;
  totalCount: number;
  completedAt?: string;
} {
  return {
    id: item.id,
    title: item.title,
    level: item.level,
    status: item.status,
    childCount: Array.isArray(item.children) ? item.children.length : 0,
    totalCount: countSubtree(item),
    ...(item.completedAt ? { completedAt: item.completedAt as string } : {}),
  };
}

// ── Pruning criteria ──────────────────────────────────────────────────

/** Criteria for filtering which items are eligible for pruning. */
interface PruneCriteria {
  /** Minimum age in days since completion. 0 = no age filter. */
  minAgeDays: number;
  /** Statuses considered eligible. Default: ["completed"]. */
  statuses: string[];
}

const DEFAULT_PRUNE_CRITERIA: PruneCriteria = {
  minAgeDays: 0,
  statuses: ["completed"],
};

/**
 * Check whether an item matches the pruning criteria.
 *
 * An item is eligible if:
 * - Its status (and all descendants') is in the criteria statuses
 * - It was completed at least `minAgeDays` ago (if completedAt is set)
 */
function matchesPruneCriteria(item: PRDItem, criteria: PruneCriteria, now: Date): boolean {
  // Status check
  if (!criteria.statuses.includes(item.status)) return false;

  // Age check — only applies when minAgeDays > 0 and completedAt is present
  if (criteria.minAgeDays > 0 && item.completedAt) {
    const completedAt = new Date(item.completedAt as string);
    const ageMs = now.getTime() - completedAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < criteria.minAgeDays) return false;
  }

  // All children must also match
  if (Array.isArray(item.children) && item.children.length > 0) {
    return item.children.every((child) => matchesPruneCriteria(child, criteria, now));
  }
  return true;
}

/**
 * Find top-level prunable subtrees applying criteria.
 * Like findPrunableItems but uses criteria matching instead of isFullyCompleted.
 */
function findPrunableWithCriteria(
  items: PRDItem[],
  criteria: PruneCriteria,
  now: Date,
): PRDItem[] {
  const prunable: PRDItem[] = [];
  for (const entry of walkTree(items)) {
    if (!matchesPruneCriteria(entry.item, criteria, now)) continue;
    // Skip items whose parent also matches (they'd be pruned as part of parent)
    const pid = parentIdOf(entry);
    const parent = pid ? findItemById(items, pid) : null;
    if (parent && matchesPruneCriteria(parent, criteria, now)) continue;
    prunable.push(entry.item);
  }
  return prunable;
}

/** Estimate the JSON byte size of a PRD item subtree. */
function estimateSubtreeBytes(item: PRDItem): number {
  return JSON.stringify(item).length;
}

// --------------------------------------------------------------------------
// Visual diff helpers — collect IDs and compute before/after impact
// --------------------------------------------------------------------------

/** Collect all IDs from a list of subtree roots (item + all descendants). */
function collectSubtreeIds(items: PRDItem[]): Set<string> {
  const ids = new Set<string>();
  function walk(node: PRDItem): void {
    ids.add(node.id);
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  for (const item of items) walk(item);
  return ids;
}

interface EpicImpactEntry {
  id: string;
  title: string;
  before: { total: number; completed: number; pct: number };
  after: { total: number; completed: number; pct: number };
  removedCount: number;
}

/**
 * Compute per-epic before/after completion impact from pruning.
 *
 * Counts tasks/subtasks (matching Rex's computeStats behavior) in the
 * "before" tree, then simulates removal of prunable items to get "after"
 * counts. Epics not affected by pruning are omitted.
 */
function computeEpicImpact(
  items: PRDItem[],
  prunableIds: Set<string>,
): EpicImpactEntry[] {
  const impact: EpicImpactEntry[] = [];

  for (const epic of items) {
    if (epic.level !== "epic") continue;

    // Count tasks/subtasks in the epic subtree
    let beforeTotal = 0;
    let beforeCompleted = 0;
    let removedCount = 0;

    function countBefore(node: PRDItem): void {
      if (node.level === "task" || node.level === "subtask") {
        if (node.status !== "deleted") {
          beforeTotal++;
          if (node.status === "completed") beforeCompleted++;
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) countBefore(child);
      }
    }

    function countRemoved(node: PRDItem): void {
      if (prunableIds.has(node.id)) {
        // Count all tasks/subtasks in this subtree as removed
        function countAll(n: PRDItem): void {
          if (n.level === "task" || n.level === "subtask") {
            if (n.status !== "deleted") removedCount++;
          }
          if (Array.isArray(n.children)) {
            for (const child of n.children) countAll(child);
          }
        }
        countAll(node);
      } else if (Array.isArray(node.children)) {
        for (const child of node.children) countRemoved(child);
      }
    }

    countBefore(epic);
    countRemoved(epic);

    if (removedCount === 0) continue;

    const afterTotal = beforeTotal - removedCount;
    // After pruning, completed count drops by however many completed tasks/subtasks were removed
    let removedCompleted = 0;
    function countRemovedCompleted(node: PRDItem): void {
      if (prunableIds.has(node.id)) {
        function countComp(n: PRDItem): void {
          if ((n.level === "task" || n.level === "subtask") && n.status === "completed") {
            removedCompleted++;
          }
          if (Array.isArray(n.children)) {
            for (const child of n.children) countComp(child);
          }
        }
        countComp(node);
      } else if (Array.isArray(node.children)) {
        for (const child of node.children) countRemovedCompleted(child);
      }
    }
    countRemovedCompleted(epic);

    const afterCompleted = beforeCompleted - removedCompleted;

    impact.push({
      id: epic.id,
      title: epic.title,
      before: {
        total: beforeTotal,
        completed: beforeCompleted,
        pct: beforeTotal > 0 ? Math.round((beforeCompleted / beforeTotal) * 100) : 0,
      },
      after: {
        total: afterTotal,
        completed: afterCompleted,
        pct: afterTotal > 0 ? Math.round((afterCompleted / afterTotal) * 100) : 0,
      },
      removedCount,
    });
  }

  return impact;
}

// --------------------------------------------------------------------------
// Archive helpers — matching structure from packages/rex/src/cli/commands/prune.ts
// --------------------------------------------------------------------------

interface PruneArchiveRecord {
  schema: "rex/archive/v1";
  batches: Array<{
    timestamp: string;
    source?: string;
    items: PRDItem[];
    count: number;
    reason?: string;
  }>;
}

function loadArchiveSync(archivePath: string): PruneArchiveRecord {
  try {
    if (existsSync(archivePath)) {
      return JSON.parse(readFileSync(archivePath, "utf-8")) as PruneArchiveRecord;
    }
  } catch { /* ignore parse errors */ }
  return { schema: "rex/archive/v1", batches: [] };
}

/**
 * Handle GET /api/rex/prune/preview — preview prunable items.
 *
 * Supports query params for pruning criteria:
 *   ?minAge=N      — minimum completion age in days (default: 0)
 *   ?statuses=a,b  — comma-separated statuses to include (default: "completed")
 *
 * Response includes storage estimation (estimatedBytes), level breakdown,
 * and diff data (prunableIds, epicImpact) for visual diff rendering.
 */
function handlePrunePreview(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  // Parse criteria from query params
  const url = req.url || "";
  const qIdx = url.indexOf("?");
  const criteria = { ...DEFAULT_PRUNE_CRITERIA };
  if (qIdx !== -1) {
    const params = new URLSearchParams(url.slice(qIdx));
    const minAgeStr = params.get("minAge");
    if (minAgeStr) {
      const parsed = parseInt(minAgeStr, 10);
      if (!isNaN(parsed) && parsed >= 0) criteria.minAgeDays = parsed;
    }
    const statusesStr = params.get("statuses");
    if (statusesStr) {
      criteria.statuses = statusesStr.split(",").filter(Boolean);
    }
  }

  const now = new Date();
  const prunable = findPrunableWithCriteria(doc.items, criteria, now);
  const totalCount = prunable.reduce((sum, item) => sum + countSubtree(item), 0);

  // Estimate storage savings
  const estimatedBytes = prunable.reduce((sum, item) => sum + estimateSubtreeBytes(item), 0);

  // Compute level breakdown
  const levelBreakdown: Record<string, number> = {};
  for (const item of prunable) {
    levelBreakdown[item.level] = (levelBreakdown[item.level] || 0) + 1;
  }

  // Total PRD size for context
  const totalPrdBytes = JSON.stringify(doc).length;

  // Collect all IDs in prunable subtrees (for visual diff highlighting)
  const prunableIds = collectSubtreeIds(prunable);

  // Compute per-epic impact (before/after completion stats)
  const epicImpact = computeEpicImpact(doc.items, prunableIds);

  jsonResponse(res, 200, {
    ok: true,
    items: prunable.map(summarizeItem),
    totalItemCount: totalCount,
    hasPrunableItems: prunable.length > 0,
    estimatedBytes,
    totalPrdBytes,
    levelBreakdown,
    criteria: {
      minAgeDays: criteria.minAgeDays,
      statuses: criteria.statuses,
    },
    // Visual diff data
    prunableIds: [...prunableIds],
    epicImpact,
  });
  return true;
}

/** Handle POST /api/rex/prune — execute prune with optional backup */
async function handlePruneExecute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      /** Create a backup of the PRD before pruning. */
      backup?: boolean;
      /** Confirmation token — must match the expected count to prevent stale operations. */
      confirmCount?: number;
      /** Pruning criteria — if provided, filters items before pruning. */
      criteria?: { minAgeDays?: number; statuses?: string[] };
    };

    // Build criteria from input or use defaults
    const criteria: PruneCriteria = {
      minAgeDays: input.criteria?.minAgeDays ?? 0,
      statuses: input.criteria?.statuses ?? ["completed"],
    };
    const now = new Date();

    // Preview first to validate
    const prunable = findPrunableWithCriteria(doc.items, criteria, now);
    if (prunable.length === 0) {
      jsonResponse(res, 200, { ok: true, prunedCount: 0, message: "Nothing to prune" });
      return true;
    }

    const expectedCount = prunable.reduce((sum, item) => sum + countSubtree(item), 0);

    // Confirm count must match to prevent operating on stale data
    if (input.confirmCount !== undefined && input.confirmCount !== expectedCount) {
      errorResponse(res, 409, `Stale prune request: expected ${input.confirmCount} items but found ${expectedCount}. Refresh the preview.`);
      return true;
    }

    // Create backup if requested
    let backupPath: string | undefined;
    if (input.backup) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = join(ctx.rexDir, `prd-backup-${timestamp}.json`);
      writeFileSync(backupPath, JSON.stringify(doc, null, 2) + "\n");
    }

    // Execute prune — remove items matching criteria
    const prunableIds = new Set(prunable.map((p) => p.id));
    const result = pruneItemsByIds(doc.items, prunableIds);

    // Archive pruned items
    const archivePath = join(ctx.rexDir, "archive.json");
    const archive = loadArchiveSync(archivePath);
    archive.batches.push({
      timestamp: new Date().toISOString(),
      source: "prune",
      items: result.pruned,
      count: result.prunedCount,
      ...(criteria.minAgeDays > 0 ? { reason: `age >= ${criteria.minAgeDays}d` } : {}),
    });
    writeFileSync(archivePath, JSON.stringify(archive, null, 2) + "\n");

    // Save pruned document
    savePRD(ctx, doc);

    // Log the prune action
    const titles = result.pruned.map((i) => i.title).join(", ");
    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "items_pruned",
      detail: `Pruned ${result.prunedCount} items: ${titles} (via web, criteria: statuses=${criteria.statuses.join(",")}, minAge=${criteria.minAgeDays}d)`,
    });

    if (broadcast) {
      broadcast({
        type: "rex:prd-changed",
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 200, {
      ok: true,
      prunedCount: result.prunedCount,
      prunedItems: result.pruned.map(summarizeItem),
      archivedTo: "archive.json",
      ...(backupPath ? { backupPath } : {}),
    });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** Handle POST /api/rex/analyze — trigger analysis via CLI subprocess */
async function handleAnalyze(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      accept?: boolean;
      noLlm?: boolean;
      lite?: boolean;
    };

    const args = ["analyze", "--format=json"];
    if (input.accept) args.push("--accept");
    if (input.noLlm) args.push("--no-llm");
    if (input.lite) args.push("--lite");
    args.push(ctx.projectDir);

    // Find the rex CLI binary
    const rexBin = join(ctx.projectDir, "node_modules", ".bin", "rex");
    const rexFallback = join(ctx.projectDir, "packages", "rex", "dist", "cli", "index.js");

    const binPath = existsSync(rexBin) ? rexBin : "node";
    const binArgs = existsSync(rexBin) ? args : [rexFallback, ...args];

    const result = await foundationExec(binPath, binArgs, {
      cwd: ctx.projectDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
      // Try to parse JSON from stdout even on error (CLI may exit non-zero but still output)
      try {
        const parsed = JSON.parse(result.stdout);
        jsonResponse(res, 200, { ok: true, ...parsed });
      } catch {
        errorResponse(res, 500, `Analysis failed: ${result.stderr || result.error.message}`);
      }
    } else {
      try {
        const parsed = JSON.parse(result.stdout);
        if (broadcast) {
          broadcast({
            type: "rex:prd-changed",
            timestamp: new Date().toISOString(),
          });
        }
        jsonResponse(res, 200, { ok: true, ...parsed });
      } catch {
        // Non-JSON output — return as plain result
        jsonResponse(res, 200, { ok: true, output: result.stdout.trim() });
      }
    }
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** Handle GET /api/rex/proposals — get pending proposals */
function handleGetProposals(
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const pendingPath = join(ctx.rexDir, "pending-proposals.json");
  if (!existsSync(pendingPath)) {
    jsonResponse(res, 200, { proposals: [] });
    return true;
  }
  try {
    const raw = readFileSync(pendingPath, "utf-8");
    const proposals = JSON.parse(raw);
    jsonResponse(res, 200, { proposals });
  } catch {
    jsonResponse(res, 200, { proposals: [] });
  }
  return true;
}

/** Handle POST /api/rex/proposals/accept — accept pending proposals */
async function handleAcceptProposals(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      /** Indices of proposals to accept. If not provided, accept all. */
      indices?: number[];
    };

    const pendingPath = join(ctx.rexDir, "pending-proposals.json");
    if (!existsSync(pendingPath)) {
      errorResponse(res, 404, "No pending proposals");
      return true;
    }

    const raw = readFileSync(pendingPath, "utf-8");
    const allProposals = JSON.parse(raw) as Array<{
      epic: { title: string; source: string; description?: string };
      features: Array<{
        title: string;
        source: string;
        description?: string;
        tasks: Array<{
          title: string;
          source: string;
          sourceFile: string;
          description?: string;
          acceptanceCriteria?: string[];
          priority?: string;
          tags?: string[];
        }>;
      }>;
    }>;

    // Filter to selected indices, or accept all
    const toAccept = input.indices
      ? input.indices.filter((i) => i >= 0 && i < allProposals.length).map((i) => allProposals[i])
      : allProposals;

    if (toAccept.length === 0) {
      errorResponse(res, 400, "No valid proposals to accept");
      return true;
    }

    let addedCount = 0;

    for (const p of toAccept) {
      const epicId = randomUUID();
      const epicItem: PRDItem = {
        id: epicId,
        title: p.epic.title,
        level: "epic",
        status: "pending",
        source: p.epic.source,
      };
      if (p.epic.description) epicItem.description = p.epic.description;
      doc.items.push(epicItem);
      addedCount++;

      for (const f of p.features) {
        const featureId = randomUUID();
        const featureItem: PRDItem = {
          id: featureId,
          title: f.title,
          level: "feature",
          status: "pending",
          source: f.source,
        };
        if (f.description) featureItem.description = f.description;
        insertChild(doc.items, epicId, featureItem);
        addedCount++;

        for (const t of f.tasks) {
          const taskId = randomUUID();
          const taskItem: PRDItem = {
            id: taskId,
            title: t.title,
            level: "task",
            status: "pending",
            source: t.source,
          };
          if (t.description) taskItem.description = t.description;
          if (t.acceptanceCriteria) taskItem.acceptanceCriteria = t.acceptanceCriteria;
          if (t.priority && isPriority(t.priority)) taskItem.priority = t.priority;
          if (t.tags) taskItem.tags = t.tags;
          insertChild(doc.items, featureId, taskItem);
          addedCount++;
        }
      }
    }

    savePRD(ctx, doc);

    // Remove accepted proposals from pending (keep remaining)
    if (input.indices && input.indices.length < allProposals.length) {
      const remaining = allProposals.filter((_, i) => !input.indices!.includes(i));
      if (remaining.length > 0) {
        writeFileSync(pendingPath, JSON.stringify(remaining, null, 2));
      } else {
        try { writeFileSync(pendingPath, "[]"); } catch { /* ignore */ }
      }
    } else {
      // All accepted — clear pending
      try { writeFileSync(pendingPath, "[]"); } catch { /* ignore */ }
    }

    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "analyze_accept",
      detail: `Accepted ${toAccept.length} proposals (${addedCount} items) via web`,
    });

    if (broadcast) {
      broadcast({
        type: "rex:prd-changed",
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 200, { ok: true, acceptedCount: toAccept.length, addedCount });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** Edited proposal shape sent from the proposal editor. */
interface EditedProposalTask {
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: string;
  tags?: string[];
  selected: boolean;
}

interface EditedProposalFeature {
  title: string;
  description?: string;
  tasks: EditedProposalTask[];
  selected: boolean;
}

interface EditedProposal {
  epic: { title: string; description?: string };
  features: EditedProposalFeature[];
  selected: boolean;
}

/** Validate an edited proposal tree. Returns an array of error messages. */
function validateEditedProposals(proposals: EditedProposal[]): string[] {
  const errors: string[] = [];
  for (let pi = 0; pi < proposals.length; pi++) {
    const p = proposals[pi];
    if (!p.selected) continue;
    if (!p.epic?.title?.trim()) {
      errors.push(`Proposal ${pi + 1}: epic title is required`);
    }
    for (let fi = 0; fi < (p.features ?? []).length; fi++) {
      const f = p.features[fi];
      if (!f.selected) continue;
      if (!f.title?.trim()) {
        errors.push(`Proposal ${pi + 1}, feature ${fi + 1}: title is required`);
      }
      for (let ti = 0; ti < (f.tasks ?? []).length; ti++) {
        const t = f.tasks[ti];
        if (!t.selected) continue;
        if (!t.title?.trim()) {
          errors.push(`Proposal ${pi + 1}, feature ${fi + 1}, task ${ti + 1}: title is required`);
        }
      }
    }
  }
  return errors;
}

/** Handle POST /api/rex/proposals/accept-edited — accept edited proposals with inline changes */
async function handleAcceptEditedProposals(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      proposals: EditedProposal[];
      /** If true, only validate — don't commit changes. */
      validateOnly?: boolean;
    };

    if (!Array.isArray(input.proposals) || input.proposals.length === 0) {
      errorResponse(res, 400, "No proposals provided");
      return true;
    }

    // Validate
    const errors = validateEditedProposals(input.proposals);
    if (input.validateOnly) {
      jsonResponse(res, 200, { ok: errors.length === 0, errors });
      return true;
    }
    if (errors.length > 0) {
      errorResponse(res, 400, `Validation failed: ${errors.join("; ")}`);
      return true;
    }

    let addedCount = 0;
    const selectedProposals = input.proposals.filter((p) => p.selected);

    for (const p of selectedProposals) {
      const epicId = randomUUID();
      const epicItem: PRDItem = {
        id: epicId,
        title: p.epic.title.trim(),
        level: "epic",
        status: "pending",
        source: "web-proposal-editor",
      };
      if (p.epic.description?.trim()) epicItem.description = p.epic.description.trim();
      doc.items.push(epicItem);
      addedCount++;

      for (const f of p.features) {
        if (!f.selected) continue;
        const featureId = randomUUID();
        const featureItem: PRDItem = {
          id: featureId,
          title: f.title.trim(),
          level: "feature",
          status: "pending",
          source: "web-proposal-editor",
        };
        if (f.description?.trim()) featureItem.description = f.description.trim();
        insertChild(doc.items, epicId, featureItem);
        addedCount++;

        for (const t of f.tasks) {
          if (!t.selected) continue;
          const taskId = randomUUID();
          const taskItem: PRDItem = {
            id: taskId,
            title: t.title.trim(),
            level: "task",
            status: "pending",
            source: "web-proposal-editor",
          };
          if (t.description?.trim()) taskItem.description = t.description.trim();
          if (t.acceptanceCriteria?.length) taskItem.acceptanceCriteria = t.acceptanceCriteria;
          if (t.priority && isPriority(t.priority)) taskItem.priority = t.priority;
          if (t.tags?.length) taskItem.tags = t.tags;
          insertChild(doc.items, featureId, taskItem);
          addedCount++;
        }
      }
    }

    if (addedCount === 0) {
      errorResponse(res, 400, "No items selected for acceptance");
      return true;
    }

    savePRD(ctx, doc);

    // Clear pending proposals file
    const pendingPath = join(ctx.rexDir, "pending-proposals.json");
    if (existsSync(pendingPath)) {
      try { writeFileSync(pendingPath, "[]"); } catch { /* ignore */ }
    }

    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "proposals_edited_accept",
      detail: `Accepted ${selectedProposals.length} edited proposals (${addedCount} items) via proposal editor`,
    });

    if (broadcast) {
      broadcast({
        type: "rex:prd-changed",
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 200, { ok: true, acceptedCount: selectedProposals.length, addedCount });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** Handle POST /api/rex/smart-add-preview — generate proposals from natural language */
async function handleSmartAddPreview(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      text: string;
      parentId?: string;
    };

    if (!input.text || typeof input.text !== "string" || input.text.trim().length === 0) {
      errorResponse(res, 400, "Text is required");
      return true;
    }

    // Minimum length to avoid wasteful LLM calls
    if (input.text.trim().length < 5) {
      jsonResponse(res, 200, { proposals: [], confidence: 0, qualityIssues: [] });
      return true;
    }

    // Use rex CLI smart-add with --format=json (no --accept = preview mode)
    const args = ["smart-add", "--format=json"];
    if (input.parentId) args.push("--parent", input.parentId);
    args.push(input.text.trim());
    args.push(ctx.projectDir);

    const rexBin = join(ctx.projectDir, "node_modules", ".bin", "rex");
    const rexFallback = join(ctx.projectDir, "packages", "rex", "dist", "cli", "index.js");

    const binPath = existsSync(rexBin) ? rexBin : "node";
    const binArgs = existsSync(rexBin) ? args : [rexFallback, ...args];

    const cliResult = await foundationExec(binPath, binArgs, {
      cwd: ctx.projectDir,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (cliResult.error && !cliResult.stdout.trim()) {
      throw new Error(cliResult.stderr || cliResult.error.message);
    }

    try {
      const parsed = JSON.parse(cliResult.stdout);
      const proposals = parsed.proposals ?? [];

      // Compute a confidence score based on proposal quality
      const confidence = computeConfidence(Array.isArray(proposals) ? proposals : []);

      jsonResponse(res, 200, {
        proposals: Array.isArray(proposals) ? proposals : [],
        confidence,
        qualityIssues: parsed.qualityIssues ?? [],
      });
    } catch {
      // Non-JSON output — return empty
      jsonResponse(res, 200, { proposals: [], confidence: 0, qualityIssues: [] });
    }
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

/**
 * Compute a confidence score (0-100) for a set of proposals based on quality heuristics.
 * Higher scores indicate more complete, well-structured proposals.
 */
function computeConfidence(proposals: Record<string, unknown>[]): number {
  if (proposals.length === 0) return 0;

  let score = 50; // Base score for having any proposals

  for (const p of proposals) {
    const epic = p.epic as Record<string, unknown> | undefined;
    const features = (p.features ?? []) as Record<string, unknown>[];

    // Epic quality
    if (epic?.title && typeof epic.title === "string" && epic.title.length > 5) score += 5;
    if (epic?.description) score += 3;

    // Feature quality
    for (const f of features) {
      if (f.title && typeof f.title === "string" && f.title.length > 5) score += 2;
      if (f.description) score += 2;

      const tasks = (f.tasks ?? []) as Record<string, unknown>[];
      for (const t of tasks) {
        if (t.title && typeof t.title === "string" && t.title.length > 5) score += 1;
        if (t.description) score += 1;
        if (t.acceptanceCriteria && Array.isArray(t.acceptanceCriteria) && t.acceptanceCriteria.length > 0) score += 2;
        if (t.priority) score += 1;
      }
    }
  }

  return Math.min(100, score);
}

// --------------------------------------------------------------------------
// Batch import — process multiple ideas from various sources
// --------------------------------------------------------------------------

/** Format extension for batch import items. */
const BATCH_FORMAT_EXT: Record<string, string> = {
  text: ".txt",
  markdown: ".md",
  json: ".json",
};

/** Handle POST /api/rex/batch-import — process multiple ideas with consolidated review */
async function handleBatchImport(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      items: Array<{
        content: string;
        format?: "text" | "markdown" | "json";
        source?: string;
      }>;
      parentId?: string;
      /** If true, accept proposals immediately without returning for review. */
      accept?: boolean;
    };

    if (!Array.isArray(input.items) || input.items.length === 0) {
      errorResponse(res, 400, "At least one import item is required");
      return true;
    }

    // Validate items
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      if (!item.content || typeof item.content !== "string" || item.content.trim().length === 0) {
        errorResponse(res, 400, `Item ${i + 1} has empty content`);
        return true;
      }
    }

    // Write items to temp files and build --file args for rex CLI
    const tmpDir = mkdtempSync(join(tmpdir(), "rex-batch-"));
    const filePaths: string[] = [];
    const itemSources: string[] = [];

    try {
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const format = item.format ?? "text";
        const ext = BATCH_FORMAT_EXT[format] ?? ".txt";
        const fileName = `batch-${i}${ext}`;
        const filePath = join(tmpDir, fileName);
        writeFileSync(filePath, item.content, "utf-8");
        filePaths.push(filePath);
        itemSources.push(item.source ?? fileName);
      }

      // Build rex CLI args: smart-add --format=json --file=<f1> --file=<f2> ...
      const args = ["smart-add", "--format=json"];
      if (input.parentId) args.push("--parent", input.parentId);
      if (input.accept) args.push("--accept");
      for (const fp of filePaths) {
        args.push(`--file=${fp}`);
      }
      args.push(ctx.projectDir);

      const rexBin = join(ctx.projectDir, "node_modules", ".bin", "rex");
      const rexFallback = join(ctx.projectDir, "packages", "rex", "dist", "cli", "index.js");

      const binPath = existsSync(rexBin) ? rexBin : "node";
      const binArgs = existsSync(rexBin) ? args : [rexFallback, ...args];

      const cliResult = await foundationExec(binPath, binArgs, {
        cwd: ctx.projectDir,
        timeout: 120_000, // 2 minutes — batch may take longer
        maxBuffer: 10 * 1024 * 1024,
      });

      if (cliResult.error && !cliResult.stdout.trim()) {
        throw new Error(cliResult.stderr || cliResult.error.message);
      }

      // Parse the JSON output from rex CLI
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(cliResult.stdout);
      } catch {
        jsonResponse(res, 200, {
          proposals: [],
          confidence: 0,
          qualityIssues: [],
          itemCount: input.items.length,
          itemSources,
        });
        return true;
      }

      const proposals = parsed.proposals ?? [];
      const proposalArray = Array.isArray(proposals) ? proposals : [];
      const confidence = computeConfidence(proposalArray as Record<string, unknown>[]);

      // If accept mode was used, proposals were already committed
      if (input.accept && parsed.added) {
        appendLog(ctx, {
          timestamp: new Date().toISOString(),
          event: "batch_import_accept",
          detail: `Batch imported ${input.items.length} items (${parsed.added} PRD items added) from: ${itemSources.join(", ")}`,
        });

        if (broadcast) {
          broadcast({
            type: "rex:prd-changed",
            timestamp: new Date().toISOString(),
          });
        }
      }

      jsonResponse(res, 200, {
        proposals: proposalArray,
        confidence,
        qualityIssues: parsed.qualityIssues ?? [],
        itemCount: input.items.length,
        itemSources,
        added: parsed.added ?? 0,
      });
    } finally {
      // Clean up temp files
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

// --------------------------------------------------------------------------
// Epic-by-epic execution — in-memory state machine
// --------------------------------------------------------------------------

/** Per-epic progress tracked during execution. */
interface EpicExecutionProgress {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  tasksTotal: number;
  tasksCompleted: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

/** Global execution state (one execution at a time). */
interface ExecutionState {
  status: "idle" | "running" | "paused" | "completed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  currentEpicId?: string;
  currentEpicIndex: number;
  epics: EpicExecutionProgress[];
  error?: string;
}

/** Singleton execution state. Reset on server restart. */
let executionState: ExecutionState = {
  status: "idle",
  currentEpicIndex: -1,
  epics: [],
};

/** Reference to the current hench child process (if any). */
let henchProcess: ManagedChild | null = null;

/** Context and broadcast saved during execution for resume. */
let savedCtx: ServerContext | null = null;
let savedBroadcast: WebSocketBroadcaster | undefined;

/** Broadcast the current execution state over WebSocket. */
function broadcastExecutionState(broadcast?: WebSocketBroadcaster): void {
  if (!broadcast) return;
  broadcast({
    type: "rex:execution-progress",
    state: getExecutionStatusPayload(),
    timestamp: new Date().toISOString(),
  });
}

/** Build the status payload returned by the status endpoint and broadcasts. */
function getExecutionStatusPayload() {
  const { status, startedAt, finishedAt, currentEpicId, currentEpicIndex, epics, error } = executionState;
  const totalEpics = epics.length;
  const completedEpics = epics.filter((e) => e.status === "completed").length;
  const totalTasks = epics.reduce((s, e) => s + e.tasksTotal, 0);
  const completedTasks = epics.reduce((s, e) => s + e.tasksCompleted, 0);
  return {
    status,
    startedAt,
    finishedAt,
    currentEpicId,
    currentEpicIndex,
    totalEpics,
    completedEpics,
    totalTasks,
    completedTasks,
    percentComplete: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    epics: epics.map((e) => ({ ...e })),
    error,
  };
}

/** Refresh epic task counts from the PRD on disk. */
function refreshEpicProgress(ctx: ServerContext): void {
  const doc = loadPRD(ctx);
  if (!doc) return;
  for (const ep of executionState.epics) {
    const epicItem = findItemById(doc.items, ep.id);
    if (!epicItem) continue;
    const stats = computeStats(epicItem.children ?? []);
    ep.tasksTotal = stats.total;
    ep.tasksCompleted = stats.completed;
  }
}

/**
 * Run the hench CLI for one epic.
 * Returns a promise that resolves when hench exits.
 */
async function runHenchForEpic(ctx: ServerContext, epicId: string): Promise<{ code: number | null; signal: string | null }> {
  const henchBin = join(ctx.projectDir, "node_modules", ".bin", "hench");
  const henchFallback = join(ctx.projectDir, "packages", "hench", "dist", "cli", "index.js");
  const args = ["run", "--epic=" + epicId, "--loop", "--auto", ctx.projectDir];

  const binPath = existsSync(henchBin) ? henchBin : "node";
  const binArgs = existsSync(henchBin) ? args : [henchFallback, ...args];

  const handle = spawnManaged(binPath, binArgs, {
    cwd: ctx.projectDir,
    stdio: "inherit",
    env: { ...process.env },
  });

  henchProcess = handle;

  const result = await handle.done;
  if (henchProcess === handle) henchProcess = null;
  return { code: result.exitCode, signal: null };
}

/**
 * Execute epics sequentially, starting from the current index.
 * Respects pause state and broadcasts progress.
 */
async function executeEpicSequence(ctx: ServerContext, broadcast?: WebSocketBroadcaster): Promise<void> {
  while (executionState.currentEpicIndex < executionState.epics.length) {
    // Check for pause
    if (executionState.status === "paused") return;
    if (executionState.status !== "running") return;

    const epicIdx = executionState.currentEpicIndex;
    const epic = executionState.epics[epicIdx];

    // Refresh task counts before starting
    refreshEpicProgress(ctx);
    broadcastExecutionState(broadcast);

    // Skip epics with no actionable tasks
    if (epic.tasksTotal === 0 || epic.tasksCompleted >= epic.tasksTotal) {
      epic.status = epic.tasksTotal === 0 ? "skipped" : "completed";
      epic.finishedAt = new Date().toISOString();
      executionState.currentEpicIndex++;
      broadcastExecutionState(broadcast);
      continue;
    }

    // Start this epic
    epic.status = "running";
    epic.startedAt = new Date().toISOString();
    executionState.currentEpicId = epic.id;
    broadcastExecutionState(broadcast);

    // Run hench for this epic
    const result = await runHenchForEpic(ctx, epic.id);

    // Refresh task counts after hench finishes
    refreshEpicProgress(ctx);

    // Check if we were paused/stopped while hench was running
    // (status can change via pause endpoint during the await above)
    const currentStatus = executionState.status as ExecutionState["status"];
    if (currentStatus === "paused") {
      epic.status = "pending"; // Revert to pending — will resume later
      epic.startedAt = undefined;
      broadcastExecutionState(broadcast);
      return;
    }

    if (currentStatus !== "running") return;

    // Mark epic as completed or failed
    if (result.code === 0 || epic.tasksCompleted >= epic.tasksTotal) {
      epic.status = "completed";
    } else {
      // Non-zero exit but some tasks may have completed
      // Mark completed if all tasks done, otherwise move on
      epic.status = epic.tasksCompleted >= epic.tasksTotal ? "completed" : "completed";
    }
    epic.finishedAt = new Date().toISOString();

    executionState.currentEpicIndex++;
    broadcastExecutionState(broadcast);
  }

  // All epics processed
  if (executionState.status === "running") {
    executionState.status = "completed";
    executionState.finishedAt = new Date().toISOString();
    executionState.currentEpicId = undefined;

    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "epic_by_epic_completed",
      detail: `Epic-by-epic execution completed. ${executionState.epics.filter((e) => e.status === "completed").length}/${executionState.epics.length} epics processed.`,
    });

    broadcastExecutionState(broadcast);
  }
}

/** Handle POST /api/rex/execute/epic-by-epic — start sequential epic execution. */
async function handleStartEpicByEpic(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  // Don't allow starting if already running
  if (executionState.status === "running" || executionState.status === "paused") {
    errorResponse(res, 409, `Execution already ${executionState.status}. Use pause/resume or wait for completion.`);
    return true;
  }

  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      /** Optional list of epic IDs to execute (in order). If omitted, all non-completed epics. */
      epicIds?: string[];
    };

    // Build the list of epics to execute
    const allEpics = doc.items.filter((item) => item.level === "epic");

    let epicsToRun: PRDItem[];
    if (input.epicIds && input.epicIds.length > 0) {
      epicsToRun = input.epicIds
        .map((id) => allEpics.find((e) => e.id === id))
        .filter((e): e is PRDItem => e != null);
    } else {
      // All epics that aren't fully completed
      epicsToRun = allEpics.filter((epic) => {
        const stats = computeStats(epic.children ?? []);
        return stats.total === 0 || stats.completed < stats.total;
      });
    }

    if (epicsToRun.length === 0) {
      jsonResponse(res, 200, { ok: true, message: "No actionable epics to execute" });
      return true;
    }

    // Initialize execution state
    executionState = {
      status: "running",
      startedAt: new Date().toISOString(),
      currentEpicIndex: 0,
      epics: epicsToRun.map((epic) => {
        const stats = computeStats(epic.children ?? []);
        return {
          id: epic.id,
          title: epic.title,
          status: "pending" as const,
          tasksTotal: stats.total,
          tasksCompleted: stats.completed,
        };
      }),
    };

    savedCtx = ctx;
    savedBroadcast = broadcast;

    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "epic_by_epic_started",
      detail: `Started epic-by-epic execution with ${epicsToRun.length} epics: ${epicsToRun.map((e) => e.title).join(", ")}`,
    });

    broadcastExecutionState(broadcast);

    // Respond immediately — execution runs in the background
    jsonResponse(res, 200, {
      ok: true,
      epicCount: epicsToRun.length,
      epics: executionState.epics.map((e) => ({ id: e.id, title: e.title })),
    });

    // Start execution asynchronously (don't await)
    executeEpicSequence(ctx, broadcast).catch((err) => {
      executionState.status = "failed";
      executionState.error = String(err);
      executionState.finishedAt = new Date().toISOString();
      broadcastExecutionState(broadcast);
    });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** Handle GET /api/rex/execute/status — return current execution state. */
function handleExecutionStatus(res: ServerResponse): boolean {
  // Refresh epic progress if running
  if (savedCtx && (executionState.status === "running" || executionState.status === "paused")) {
    refreshEpicProgress(savedCtx);
  }
  jsonResponse(res, 200, getExecutionStatusPayload());
  return true;
}

/** Handle POST /api/rex/execute/pause — pause the current execution. */
function handleExecutionPause(
  res: ServerResponse,
  broadcast?: WebSocketBroadcaster,
): boolean {
  if (executionState.status !== "running") {
    errorResponse(res, 409, `Cannot pause: execution is ${executionState.status}`);
    return true;
  }

  executionState.status = "paused";

  // Kill the current hench process if running
  if (henchProcess) {
    henchProcess.kill("SIGINT");
    henchProcess = null;
  }

  broadcastExecutionState(broadcast);
  jsonResponse(res, 200, { ok: true, status: "paused" });
  return true;
}

/** Handle POST /api/rex/execute/resume — resume a paused execution. */
function handleExecutionResume(
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean {
  if (executionState.status !== "paused") {
    errorResponse(res, 409, `Cannot resume: execution is ${executionState.status}`);
    return true;
  }

  executionState.status = "running";
  savedCtx = ctx;
  savedBroadcast = broadcast;

  broadcastExecutionState(broadcast);
  jsonResponse(res, 200, { ok: true, status: "running" });

  // Continue execution asynchronously
  executeEpicSequence(ctx, broadcast).catch((err) => {
    executionState.status = "failed";
    executionState.error = String(err);
    executionState.finishedAt = new Date().toISOString();
    broadcastExecutionState(broadcast);
  });

  return true;
}

// ---------------------------------------------------------------------------
// Requirements CRUD handlers
// ---------------------------------------------------------------------------

// RequirementRecord is now the canonical Requirement type from rex,
// imported via the gateway (domain-gateway.ts).
type RequirementRecord = import("./rex-gateway.js").Requirement;

/** Walk the item tree collecting requirements with inheritance. */
function collectInheritedRequirements(
  items: PRDItem[],
  targetId: string,
): Array<RequirementRecord & { sourceItemId: string; sourceItemTitle: string; sourceItemLevel: string }> {
  const result: Array<RequirementRecord & { sourceItemId: string; sourceItemTitle: string; sourceItemLevel: string }> = [];

  // Find the item and its parent chain
  function findWithParents(
    list: PRDItem[],
    id: string,
    parents: PRDItem[],
  ): { item: PRDItem; parents: PRDItem[] } | null {
    for (const item of list) {
      if (item.id === id) return { item, parents };
      if (Array.isArray(item.children)) {
        const found = findWithParents(item.children, id, [...parents, item]);
        if (found) return found;
      }
    }
    return null;
  }

  const found = findWithParents(items, targetId, []);
  if (!found) return result;

  // Own requirements first
  const reqs = (found.item.requirements ?? []) as RequirementRecord[];
  for (const req of reqs) {
    result.push({
      ...req,
      sourceItemId: found.item.id,
      sourceItemTitle: found.item.title,
      sourceItemLevel: found.item.level,
    });
  }

  // Then parent chain (immediate parent → root)
  for (const parent of [...found.parents].reverse()) {
    const parentReqs = (parent.requirements ?? []) as RequirementRecord[];
    for (const req of parentReqs) {
      result.push({
        ...req,
        sourceItemId: parent.id,
        sourceItemTitle: parent.title,
        sourceItemLevel: parent.level,
      });
    }
  }

  return result;
}

/** GET /api/rex/items/:id/requirements */
function handleGetRequirements(
  res: ServerResponse,
  ctx: ServerContext,
  itemId: string,
): boolean {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  const item = findItemById(doc.items, itemId);
  if (!item) {
    errorResponse(res, 404, `Item "${itemId}" not found`);
    return true;
  }

  const inherited = collectInheritedRequirements(doc.items, itemId);
  const own = (item.requirements ?? []) as RequirementRecord[];

  jsonResponse(res, 200, {
    own,
    inherited,
    totalCount: inherited.length,
    ownCount: own.length,
    inheritedCount: inherited.length - own.length,
  });
  return true;
}

/** POST /api/rex/items/:id/requirements */
async function handleAddRequirement(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  itemId: string,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  const item = findItemById(doc.items, itemId);
  if (!item) {
    errorResponse(res, 404, `Item "${itemId}" not found`);
    return true;
  }

  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      title?: string;
      category?: string;
      validationType?: string;
      description?: string;
      acceptanceCriteria?: string[];
      validationCommand?: string;
      threshold?: number;
      priority?: string;
    };

    if (!input.title?.trim()) {
      errorResponse(res, 400, "Missing required field: title");
      return true;
    }
    if (!input.category || !isRequirementCategory(input.category)) {
      errorResponse(res, 400, `Invalid category: ${input.category}. Valid: ${[...VALID_REQUIREMENT_CATEGORIES].join(", ")}`);
      return true;
    }
    if (!input.validationType || !isValidationType(input.validationType)) {
      errorResponse(res, 400, `Invalid validationType: ${input.validationType}. Valid: ${[...VALID_VALIDATION_TYPES].join(", ")}`);
      return true;
    }

    const id = randomUUID();
    const requirement: RequirementRecord = {
      id,
      title: input.title.trim(),
      category: input.category,
      validationType: input.validationType,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
    };

    if (input.description) requirement.description = input.description;
    if (input.validationCommand) requirement.validationCommand = input.validationCommand;
    if (input.threshold !== undefined) requirement.threshold = input.threshold;
    if (input.priority && isPriority(input.priority)) requirement.priority = input.priority;

    if (!Array.isArray(item.requirements)) {
      item.requirements = [];
    }
    (item.requirements as RequirementRecord[]).push(requirement);

    savePRD(ctx, doc);

    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "requirement_added",
      itemId,
      detail: `Added ${input.category} requirement "${input.title}" to item "${item.title}" (via web)`,
    });

    if (broadcast) {
      broadcast({
        type: "rex:prd-changed",
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 201, { ok: true, id, requirement });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** PATCH /api/rex/items/:id/requirements/:reqId */
async function handleUpdateRequirement(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  itemId: string,
  reqId: string,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  const item = findItemById(doc.items, itemId);
  if (!item) {
    errorResponse(res, 404, `Item "${itemId}" not found`);
    return true;
  }

  const reqs = (item.requirements ?? []) as RequirementRecord[];
  const reqIdx = reqs.findIndex((r) => r.id === reqId);
  if (reqIdx === -1) {
    errorResponse(res, 404, `Requirement "${reqId}" not found on item "${itemId}"`);
    return true;
  }

  try {
    const body = await readBody(req);
    const updates = JSON.parse(body) as Partial<RequirementRecord>;

    // Validate category/validationType if being changed
    if (updates.category !== undefined && !isRequirementCategory(updates.category)) {
      errorResponse(res, 400, `Invalid category: ${updates.category}`);
      return true;
    }
    if (updates.validationType !== undefined && !isValidationType(updates.validationType)) {
      errorResponse(res, 400, `Invalid validationType: ${updates.validationType}`);
      return true;
    }
    if (updates.priority !== undefined && updates.priority !== null && !isPriority(updates.priority)) {
      errorResponse(res, 400, `Invalid priority: ${updates.priority}`);
      return true;
    }

    // Apply updates (preserve id)
    const existing = reqs[reqIdx];
    Object.assign(existing, updates, { id: reqId });

    savePRD(ctx, doc);

    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "requirement_updated",
      itemId,
      detail: `Updated requirement "${existing.title}" on item "${item.title}" (via web)`,
    });

    if (broadcast) {
      broadcast({
        type: "rex:prd-changed",
        timestamp: new Date().toISOString(),
      });
    }

    jsonResponse(res, 200, { ok: true, requirement: existing });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** DELETE /api/rex/items/:id/requirements/:reqId */
function handleDeleteRequirement(
  res: ServerResponse,
  ctx: ServerContext,
  itemId: string,
  reqId: string,
  broadcast?: WebSocketBroadcaster,
): boolean {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  const item = findItemById(doc.items, itemId);
  if (!item) {
    errorResponse(res, 404, `Item "${itemId}" not found`);
    return true;
  }

  const reqs = (item.requirements ?? []) as RequirementRecord[];
  const reqIdx = reqs.findIndex((r) => r.id === reqId);
  if (reqIdx === -1) {
    errorResponse(res, 404, `Requirement "${reqId}" not found on item "${itemId}"`);
    return true;
  }

  const removed = reqs.splice(reqIdx, 1)[0];
  if (reqs.length === 0) {
    delete item.requirements;
  }

  savePRD(ctx, doc);

  appendLog(ctx, {
    timestamp: new Date().toISOString(),
    event: "requirement_deleted",
    itemId,
    detail: `Deleted requirement "${removed.title}" from item "${item.title}" (via web)`,
  });

  if (broadcast) {
    broadcast({
      type: "rex:prd-changed",
      timestamp: new Date().toISOString(),
    });
  }

  jsonResponse(res, 200, { ok: true });
  return true;
}

// ---------------------------------------------------------------------------
// Requirements coverage & traceability
// ---------------------------------------------------------------------------

interface RequirementsCoverageStats {
  /** Total items in the tree. */
  totalItems: number;
  /** Items with at least one direct requirement. */
  itemsWithRequirements: number;
  /** Items inheriting requirements from parents. */
  itemsWithInheritedRequirements: number;
  /** Items with zero applicable requirements. */
  itemsWithNoRequirements: number;
  /** Total unique requirements across all items. */
  totalRequirements: number;
  /** Breakdown by category. */
  byCategory: Record<string, number>;
  /** Breakdown by validation type. */
  byValidationType: Record<string, number>;
  /** Breakdown by priority. */
  byPriority: Record<string, number>;
  /** Coverage percentage (items with any requirements / total items). */
  coveragePercent: number;
}

/** GET /api/rex/requirements/coverage */
function handleRequirementsCoverage(
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  const stats: RequirementsCoverageStats = {
    totalItems: 0,
    itemsWithRequirements: 0,
    itemsWithInheritedRequirements: 0,
    itemsWithNoRequirements: 0,
    totalRequirements: 0,
    byCategory: {},
    byValidationType: {},
    byPriority: {},
    coveragePercent: 0,
  };

  const seenReqIds = new Set<string>();

  // Walk tree counting requirements
  function walkForCoverage(list: PRDItem[], parentHasReqs: boolean): void {
    for (const item of list) {
      if (item.status === "deleted") continue;
      stats.totalItems++;

      const ownReqs = (item.requirements ?? []) as RequirementRecord[];
      const hasOwn = ownReqs.length > 0;

      if (hasOwn) {
        stats.itemsWithRequirements++;
        for (const req of ownReqs) {
          if (!seenReqIds.has(req.id)) {
            seenReqIds.add(req.id);
            stats.totalRequirements++;
            stats.byCategory[req.category] = (stats.byCategory[req.category] ?? 0) + 1;
            stats.byValidationType[req.validationType] = (stats.byValidationType[req.validationType] ?? 0) + 1;
            const p = (req.priority as string) ?? "unset";
            stats.byPriority[p] = (stats.byPriority[p] ?? 0) + 1;
          }
        }
      }

      const inherits = parentHasReqs && !hasOwn;
      if (inherits) {
        stats.itemsWithInheritedRequirements++;
      }

      if (!hasOwn && !parentHasReqs) {
        stats.itemsWithNoRequirements++;
      }

      if (Array.isArray(item.children)) {
        walkForCoverage(item.children, hasOwn || parentHasReqs);
      }
    }
  }

  walkForCoverage(doc.items, false);

  stats.coveragePercent = stats.totalItems > 0
    ? Math.round(((stats.totalItems - stats.itemsWithNoRequirements) / stats.totalItems) * 100)
    : 0;

  jsonResponse(res, 200, stats);
  return true;
}

/** GET /api/rex/requirements/traceability */
function handleRequirementsTraceability(
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  // Build traceability: each requirement → which items it applies to
  const matrix: Array<{
    requirement: RequirementRecord;
    definedOnItemId: string;
    definedOnItemTitle: string;
    definedOnItemLevel: string;
    appliesTo: Array<{ id: string; title: string; level: string; status: string }>;
  }> = [];

  // Collect all unique requirements and find what items they are defined on
  const reqMap = new Map<string, {
    requirement: RequirementRecord;
    definedOnItemId: string;
    definedOnItemTitle: string;
    definedOnItemLevel: string;
    childIds: string[];
  }>();

  function walkForReqs(list: PRDItem[]): void {
    for (const item of list) {
      const reqs = (item.requirements ?? []) as RequirementRecord[];
      for (const req of reqs) {
        if (!reqMap.has(req.id)) {
          reqMap.set(req.id, {
            requirement: req,
            definedOnItemId: item.id,
            definedOnItemTitle: item.title,
            definedOnItemLevel: item.level,
            childIds: [],
          });
        }
      }
      if (Array.isArray(item.children)) {
        walkForReqs(item.children);
      }
    }
  }

  // Collect descendant items for each requirement-bearing item
  function collectDescendants(items: PRDItem[]): Array<{ id: string; title: string; level: string; status: string }> {
    const result: Array<{ id: string; title: string; level: string; status: string }> = [];
    for (const item of items) {
      if (item.status !== "deleted") {
        result.push({ id: item.id, title: item.title, level: item.level, status: item.status });
      }
      if (Array.isArray(item.children)) {
        result.push(...collectDescendants(item.children));
      }
    }
    return result;
  }

  walkForReqs(doc.items);

  // For each requirement, find all items it applies to (the defining item + descendants)
  for (const [, entry] of reqMap) {
    const defItem = findItemById(doc.items, entry.definedOnItemId);
    const appliesTo: Array<{ id: string; title: string; level: string; status: string }> = [];

    if (defItem) {
      appliesTo.push({
        id: defItem.id,
        title: defItem.title,
        level: defItem.level,
        status: defItem.status,
      });
      if (Array.isArray(defItem.children)) {
        appliesTo.push(...collectDescendants(defItem.children));
      }
    }

    matrix.push({
      requirement: entry.requirement,
      definedOnItemId: entry.definedOnItemId,
      definedOnItemTitle: entry.definedOnItemTitle,
      definedOnItemLevel: entry.definedOnItemLevel,
      appliesTo,
    });
  }

  jsonResponse(res, 200, { matrix, totalRequirements: matrix.length });
  return true;
}

/** Append to execution log (sync, best-effort). */
function appendLog(ctx: ServerContext, entry: Record<string, unknown>): void {
  try {
    const logPath = join(ctx.rexDir, "execution-log.jsonl");
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    // Best-effort logging
  }
}
