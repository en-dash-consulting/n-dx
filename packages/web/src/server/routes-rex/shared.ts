/**
 * Shared helpers for Rex route handlers.
 *
 * Thin wrappers over canonical rex functions that adapt the rex API
 * to the patterns used throughout the route modules.
 */

import type { ServerResponse } from "node:http";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "../types.js";
import { loadPRDSync, savePRDSync } from "../prd-io.js";

import {
  type PRDItem,
  type PRDDocument,
  type ItemStatus,
  type TreeEntry,
  VALID_STATUSES,
  findItem,
  insertChild as rexInsertChild,
  updateInTree as rexUpdateInTree,
  findNextTask as rexFindNextTask,
  collectCompletedIds,
  computeTimestampUpdates,
} from "../rex-gateway.js";

/**
 * API-settable statuses — excludes "deleted" from the canonical set.
 * Deleted items shouldn't be settable via the API.
 */
export const API_SETTABLE_STATUSES = new Set<string>(
  [...VALID_STATUSES].filter((s) => s !== "deleted"),
);

/** Find an item by ID, returning just the item (or null). */
export function findItemById(items: PRDItem[], id: string): PRDItem | null {
  const entry = findItem(items, id);
  return entry ? entry.item : null;
}

/**
 * Insert a child under a parent. Skips rex's hierarchy validation since the
 * web API validates level separately and some batch-import paths construct
 * items with the correct level pre-set.
 */
export function insertChild(items: PRDItem[], parentId: string, child: PRDItem): boolean {
  return rexInsertChild(items, parentId, child);
}

/**
 * Update an item in the tree, automatically applying timestamp transitions
 * (startedAt / completedAt) via the canonical `computeTimestampUpdates`.
 */
export function updateInTree(
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
export function findNextTask(items: PRDItem[], completedIds: Set<string>): PRDItem | null {
  const entry = rexFindNextTask(items, completedIds);
  return entry ? entry.item : null;
}

/** Load and parse prd.json. Returns null if not found. */
export function loadPRD(ctx: ServerContext): PRDDocument | null {
  return loadPRDSync(ctx.rexDir);
}

/** Save prd.json. */
export function savePRD(ctx: ServerContext, doc: PRDDocument): void {
  savePRDSync(ctx.rexDir, doc);
}

/** Extract the parent ID from a TreeEntry's parent chain. */
export function parentIdOf(entry: TreeEntry): string | null {
  return entry.parents.length > 0 ? entry.parents[entry.parents.length - 1].id : null;
}

/** Append to execution log (sync, best-effort). */
export function appendLog(ctx: ServerContext, entry: Record<string, unknown>): void {
  try {
    const logPath = join(ctx.rexDir, "execution-log.jsonl");
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    // Best-effort logging
  }
}

// Re-export collectCompletedIds for use in reads.ts
export { collectCompletedIds };
