/**
 * Requirements routes: CRUD on item requirements, coverage stats, traceability matrix.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { ServerContext } from "../types.js";
import { jsonResponse, errorResponse, readBody } from "../response-utils.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { findItemById, loadPRD, savePRD, appendLog } from "./rex-route-helpers.js";

import {
  type PRDItem,
  type Requirement,
  isPriority,
  isRequirementCategory,
  isValidationType,
  VALID_REQUIREMENT_CATEGORIES,
  VALID_VALIDATION_TYPES,
} from "../rex-gateway.js";

type RequirementRecord = Requirement;

// ---------------------------------------------------------------------------
// Route dispatchers
// ---------------------------------------------------------------------------

/** Item requirements sub-routes: CRUD on /api/rex/items/:id/requirements. */
export function routeItemRequirements(
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
export function routeRequirementsAnalytics(
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

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
