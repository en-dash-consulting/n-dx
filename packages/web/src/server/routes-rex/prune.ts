/**
 * Prune routes: preview and execute pruning of completed subtrees.
 *
 * Includes criteria-based filtering, archive management, storage estimation,
 * and per-epic impact computation for visual diff rendering.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "../types.js";
import { jsonResponse, errorResponse, readBody } from "../response-utils.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { findItemById, loadPRD, savePRD, appendLog, parentIdOf } from "./rex-route-helpers.js";

import {
  type PRDItem,
  walkTree,
  countSubtree,
  isWorkItem,
} from "../rex-gateway.js";

// ---------------------------------------------------------------------------
// Prune helpers
// ---------------------------------------------------------------------------

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
      if (isWorkItem(node.level)) {
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
          if (isWorkItem(n.level)) {
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
          if (isWorkItem(n.level) && n.status === "completed") {
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

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** Prune routes: preview and execute. */
export function routePrune(
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
