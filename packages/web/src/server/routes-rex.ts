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
 * POST  /api/rex/analyze          — trigger analysis (scan project)
 * GET   /api/rex/proposals        — get pending proposals
 * POST  /api/rex/proposals/accept — accept pending proposals
 * GET   /api/rex/log              — execution log (?limit=N)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./types.js";
import type { WebSocketBroadcaster } from "./websocket.js";

const REX_PREFIX = "/api/rex/";

// --------------------------------------------------------------------------
// Rex domain types and constants — intentionally duplicated from
// packages/rex/src/schema/v1.ts.
//
// Sourcevision does not depend on Rex as a package to keep the two
// independent at both compile-time and runtime. This is a deliberate
// architectural choice: the sourcevision web server must be deployable
// without Rex installed, and the viewer bundle must work as standalone
// browser code.
//
// Trade-off: duplication creates drift risk, but it's mitigated by:
//   1. @see annotations pointing back to the canonical source
//   2. Compile-time consistency tests in tests/unit/server/type-consistency.test.ts
//   3. The values are stable domain constants that rarely change
//
// If the canonical definitions in Rex change, update these to match.
// @see packages/rex/src/schema/v1.ts — canonical source of truth
// --------------------------------------------------------------------------

/** @see packages/rex/src/schema/v1.ts — Priority */
type Priority = "critical" | "high" | "medium" | "low";

/** @see packages/rex/src/schema/v1.ts — ItemLevel */
type ItemLevel = "epic" | "feature" | "task" | "subtask";

const VALID_LEVELS = new Set<ItemLevel>(["epic", "feature", "task", "subtask"]);
const VALID_STATUSES = new Set(["pending", "in_progress", "completed", "deferred", "blocked"]);
const VALID_PRIORITIES = new Set<Priority>(["critical", "high", "medium", "low"]);

/** Type guard: narrows a string to Priority if it's a valid priority value. */
function isPriority(value: string | undefined): value is Priority {
  return value !== undefined && VALID_PRIORITIES.has(value as Priority);
}

/** Type guard: narrows a string to ItemLevel if it's a valid level value. */
function isItemLevel(value: string | undefined): value is ItemLevel {
  return value !== undefined && VALID_LEVELS.has(value as ItemLevel);
}

/** Valid parent levels for each item level. null = root allowed.
 *  @see packages/rex/src/schema/v1.ts — LEVEL_HIERARCHY */
const LEVEL_HIERARCHY: Record<ItemLevel, Array<ItemLevel | null>> = {
  epic: [null],
  feature: ["epic"],
  task: ["feature", "epic"],
  subtask: ["task"],
};

/** Infer child level from parent level. */
const CHILD_LEVEL: Partial<Record<ItemLevel, ItemLevel>> = {
  epic: "feature",
  feature: "task",
  task: "subtask",
};

interface PRDItemRecord {
  id: string;
  status: string;
  level: string;
  title: string;
  children?: PRDItemRecord[];
  [key: string]: unknown;
}

interface PRDDocRecord {
  schema: string;
  title: string;
  items: PRDItemRecord[];
  [key: string]: unknown;
}

/** Walk the tree to find an item by ID. */
function findItemById(items: PRDItemRecord[], id: string): PRDItemRecord | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (Array.isArray(item.children)) {
      const found = findItemById(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Insert a child item under the specified parent. */
function insertChild(items: PRDItemRecord[], parentId: string, child: PRDItemRecord): boolean {
  for (const item of items) {
    if (item.id === parentId) {
      if (!Array.isArray(item.children)) {
        item.children = [];
      }
      item.children.push(child);
      return true;
    }
    if (Array.isArray(item.children) && insertChild(item.children, parentId, child)) {
      return true;
    }
  }
  return false;
}

/** Walk the tree to update an item in place. */
function updateInTree(
  items: PRDItemRecord[],
  id: string,
  updates: Record<string, unknown>,
): boolean {
  for (const item of items) {
    if (item.id === id) {
      // Apply auto-timestamps for status changes
      if (updates.status === "in_progress" && item.status !== "in_progress") {
        updates.startedAt = updates.startedAt || new Date().toISOString();
      }
      if (updates.status === "completed" && item.status !== "completed") {
        updates.completedAt = updates.completedAt || new Date().toISOString();
      }
      Object.assign(item, updates);
      return true;
    }
    if (Array.isArray(item.children) && updateInTree(item.children, id, updates)) {
      return true;
    }
  }
  return false;
}

interface TreeStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  deferred: number;
  blocked: number;
}

/** Compute stats counting only task and subtask levels. */
function computeStats(items: PRDItemRecord[]): TreeStats {
  const stats: TreeStats = {
    total: 0,
    completed: 0,
    inProgress: 0,
    pending: 0,
    deferred: 0,
    blocked: 0,
  };

  function walk(list: PRDItemRecord[]): void {
    for (const item of list) {
      if (item.level === "task" || item.level === "subtask") {
        stats.total++;
        switch (item.status) {
          case "completed": stats.completed++; break;
          case "in_progress": stats.inProgress++; break;
          case "pending": stats.pending++; break;
          case "deferred": stats.deferred++; break;
          case "blocked": stats.blocked++; break;
        }
      }
      if (Array.isArray(item.children)) walk(item.children);
    }
  }

  walk(items);
  return stats;
}

/**
 * Canonical priority ordering — lower number = higher priority.
 * Intentionally duplicated from packages/rex/src/schema/v1.ts — PRIORITY_ORDER.
 * @see packages/rex/src/schema/v1.ts — PRIORITY_ORDER
 * @see routes-rex.ts header comment for rationale.
 */
const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Find the next actionable task (pending/in_progress leaf with resolved deps). */
function findNextTask(items: PRDItemRecord[], completedIds: Set<string>): PRDItemRecord | null {

  interface Candidate {
    item: PRDItemRecord;
    priority: number;
  }

  const candidates: Candidate[] = [];

  function collect(list: PRDItemRecord[]): void {
    for (const item of list) {
      if (item.status === "completed" || item.status === "deferred" || item.status === "blocked") continue;

      // Check unresolved dependencies
      if (Array.isArray(item.blockedBy) && item.blockedBy.length > 0) {
        if (!(item.blockedBy as string[]).every((dep) => completedIds.has(dep))) continue;
      }

      if (Array.isArray(item.children) && item.children.length > 0) {
        collect(item.children);
        const allChildrenDone = item.children.every(
          (c) => c.status === "completed" || c.status === "deferred",
        );
        if (allChildrenDone) {
          candidates.push({
            item,
            priority: PRIORITY_ORDER[isPriority(item.priority as string | undefined) ? item.priority as Priority : "medium"],
          });
        }
      } else {
        candidates.push({
          item,
          priority: PRIORITY_ORDER[isPriority(item.priority as string | undefined) ? item.priority as Priority : "medium"],
        });
      }
    }
  }

  collect(items);

  if (candidates.length === 0) return null;

  // Sort: in_progress first, then by priority
  candidates.sort((a, b) => {
    const aInProg = a.item.status === "in_progress" ? 0 : 1;
    const bInProg = b.item.status === "in_progress" ? 0 : 1;
    if (aInProg !== bInProg) return aInProg - bInProg;
    return a.priority - b.priority;
  });

  return candidates[0].item;
}

/** Collect IDs of all completed items. */
function collectCompletedIds(items: PRDItemRecord[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: PRDItemRecord[]): void {
    for (const item of list) {
      if (item.status === "completed") ids.add(item.id);
      if (Array.isArray(item.children)) walk(item.children);
    }
  }
  walk(items);
  return ids;
}

/** Load and parse prd.json. Returns null if not found. */
function loadPRD(ctx: ServerContext): PRDDocRecord | null {
  const prdPath = join(ctx.rexDir, "prd.json");
  if (!existsSync(prdPath)) return null;
  try {
    return JSON.parse(readFileSync(prdPath, "utf-8")) as PRDDocRecord;
  } catch {
    return null;
  }
}

/** Save prd.json. */
function savePRD(ctx: ServerContext, doc: PRDDocRecord): void {
  const prdPath = join(ctx.rexDir, "prd.json");
  writeFileSync(prdPath, JSON.stringify(doc, null, 2) + "\n");
}

interface EpicStats {
  id: string;
  title: string;
  status: string;
  priority?: string;
  stats: TreeStats;
  percentComplete: number;
}

/** Compute per-epic stats. Each epic's descendants (tasks/subtasks) are counted. */
function computeEpicStats(items: PRDItemRecord[]): EpicStats[] {
  return items
    .filter((item) => item.level === "epic")
    .map((epic) => {
      const stats = computeStats(epic.children ?? []);
      return {
        id: epic.id,
        title: epic.title,
        status: epic.status,
        priority: epic.priority as string | undefined,
        stats,
        percentComplete: stats.total > 0
          ? Math.round((stats.completed / stats.total) * 100)
          : 0,
      };
    });
}

interface PriorityDistribution {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unset: number;
}

/** Count tasks/subtasks by priority. */
function computePriorityDistribution(items: PRDItemRecord[]): PriorityDistribution {
  const dist: PriorityDistribution = { critical: 0, high: 0, medium: 0, low: 0, unset: 0 };

  function walk(list: PRDItemRecord[]): void {
    for (const item of list) {
      if (item.level === "task" || item.level === "subtask") {
        const p = (item.priority as string) ?? "";
        if (p === "critical") dist.critical++;
        else if (p === "high") dist.high++;
        else if (p === "medium") dist.medium++;
        else if (p === "low") dist.low++;
        else dist.unset++;
      }
      if (Array.isArray(item.children)) walk(item.children);
    }
  }

  walk(items);
  return dist;
}

/** Handle Rex API requests. Returns true if the request was handled. */
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
    jsonResponse(res, 200, {
      title: doc.title,
      stats,
      percentComplete: stats.total > 0
        ? Math.round((stats.completed / stats.total) * 100)
        : 0,
      epics,
      nextTask: next,
      priorities,
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

  // POST /api/rex/items — add a new item
  if (path === "items" && method === "POST") {
    return handleItemAdd(req, res, ctx, broadcast);
  }

  // PATCH /api/rex/items/bulk — bulk status update
  if (path === "items/bulk" && method === "PATCH") {
    return handleBulkUpdate(req, res, ctx, broadcast);
  }

  // Routes under /api/rex/items/:id
  const itemsMatch = path.match(/^items\/([^/?]+)/);
  if (itemsMatch) {
    const itemId = itemsMatch[1];

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
    let level: string;
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
      if (allowedParentLevels.length > 0 && !allowedParentLevels.includes(parent.level as ItemLevel)) {
        errorResponse(res, 400, `A ${level} must be a child of a ${allowedParentLevels.join(" or ")}, not a ${parent.level}`);
        return true;
      }
    }

    const id = randomUUID();
    const item: PRDItemRecord = {
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
    if (input.updates.status && !VALID_STATUSES.has(input.updates.status as string)) {
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

    await new Promise<void>((resolve, reject) => {
      execFile(binPath, binArgs, {
        cwd: ctx.projectDir,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      }, (error, stdout, stderr) => {
        if (error) {
          // Try to parse JSON from stdout even on error (CLI may exit non-zero but still output)
          try {
            const parsed = JSON.parse(stdout);
            jsonResponse(res, 200, { ok: true, ...parsed });
            resolve();
            return;
          } catch {
            // Fall through to error response
          }
          errorResponse(res, 500, `Analysis failed: ${stderr || error.message}`);
          resolve();
          return;
        }

        try {
          const result = JSON.parse(stdout);
          if (broadcast) {
            broadcast({
              type: "rex:prd-changed",
              timestamp: new Date().toISOString(),
            });
          }
          jsonResponse(res, 200, { ok: true, ...result });
        } catch {
          // Non-JSON output — return as plain result
          jsonResponse(res, 200, { ok: true, output: stdout.trim() });
        }
        resolve();
      });
    });
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
      const epicItem: PRDItemRecord = {
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
        const featureItem: PRDItemRecord = {
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
          const taskItem: PRDItemRecord = {
            id: taskId,
            title: t.title,
            level: "task",
            status: "pending",
            source: t.source,
          };
          if (t.description) taskItem.description = t.description;
          if (t.acceptanceCriteria) taskItem.acceptanceCriteria = t.acceptanceCriteria;
          if (t.priority) taskItem.priority = t.priority;
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

/** Append to execution log (sync, best-effort). */
function appendLog(ctx: ServerContext, entry: Record<string, unknown>): void {
  try {
    const logPath = join(ctx.rexDir, "execution-log.jsonl");
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    // Best-effort logging
  }
}
