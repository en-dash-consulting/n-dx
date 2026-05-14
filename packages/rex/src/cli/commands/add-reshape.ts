/**
 * Scoped consolidation pass for the add command.
 *
 * After inserting a new item, detects hash-suffix duplicate siblings and
 * consolidates them immediately so the PRD never accumulates near-duplicate
 * siblings from repeated `add` calls with slightly different titles.
 *
 * Hash suffix: a short alphanumeric token in parentheses or brackets at the
 * end of a title, e.g. "(abc123)" in "Fix observation in global (abc123)".
 *
 * @module cli/commands/add-reshape
 */

import { join } from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { findItem } from "../../core/tree.js";
import { applyReshape } from "../../core/reshape.js";
import type { ReshapeProposal, MergeAction } from "../../core/reshape.js";
import type { PRDItem } from "../../schema/index.js";
import type { PRDStore } from "../../store/index.js";
import { syncFolderTree } from "./folder-tree-sync.js";

// ── Hash-suffix detection ─────────────────────────────────────────────────────

/**
 * Strip trailing hash/ID suffix from a title.
 *
 * Matches patterns like:
 *   "Fix bug (abc123)"   → "Fix bug"
 *   "Fix bug [abc123]"   → "Fix bug"
 *   "Fix bug (ABC-123)"  → "Fix bug"
 *
 * A hash suffix is 3–12 alphanumeric-or-hyphen characters inside
 * parentheses or brackets at the end of the string.
 */
export function stripHashSuffix(title: string): string {
  return title.replace(/\s*[\(\[]\s*[a-zA-Z0-9][a-zA-Z0-9\-]{2,11}\s*[\)\]]\s*$/, "").trim();
}

/**
 * Normalize a title for deduplication comparison.
 * Strips hash suffix then lowercases and collapses whitespace.
 */
function normalizeForComparison(title: string): string {
  return stripHashSuffix(title).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Detect hash-suffix duplicate pairs among siblings.
 *
 * Two siblings are hash-suffix duplicates when their titles, after stripping
 * any trailing "(hash)" / "[hash]" suffix, normalize to the same string.
 *
 * Survivor selection:
 *   1. Prefer the item whose title has no hash suffix (canonical form).
 *   2. If both have hash suffixes, prefer the existing item over the
 *      newly added item (newItemId).
 *   3. If both are existing items with hash suffixes, prefer the first
 *      in sibling order (oldest positionally).
 *
 * Returns merge proposals: survivor absorbs loser's children and body.
 */
export function detectHashSuffixDuplicates(
  siblings: PRDItem[],
  newItemId: string,
): ReshapeProposal[] {
  if (siblings.length < 2) return [];

  // Group siblings by normalized stripped title
  const groups = new Map<string, PRDItem[]>();
  for (const sib of siblings) {
    const key = normalizeForComparison(sib.title);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(sib);
    groups.set(key, group);
  }

  const proposals: ReshapeProposal[] = [];
  const processed = new Set<string>();

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Pick survivor: no-suffix items > existing items > new item
    const noSuffix = group.filter((g) => stripHashSuffix(g.title) === g.title.trim());
    let survivor: PRDItem;

    if (noSuffix.length > 0) {
      // Prefer the no-suffix form; if multiple, pick first (oldest in sibling order)
      survivor = noSuffix[0];
    } else {
      // All have hash suffixes — prefer any existing item over the new item
      const existing = group.filter((g) => g.id !== newItemId);
      survivor = existing.length > 0 ? existing[0] : group[0];
    }

    const losers = group.filter((g) => g.id !== survivor.id);
    for (const loser of losers) {
      const key = `${survivor.id}:${loser.id}`;
      if (processed.has(key)) continue;
      processed.add(key);

      const action: MergeAction = {
        action: "merge",
        survivorId: survivor.id,
        mergedIds: [loser.id],
        reason: "hash-suffix-duplicate-sibling",
        mergeReasoning:
          `Hash-suffix duplicate: "${loser.title}" consolidates into "${survivor.title}" (same stripped title)`,
      };

      proposals.push({
        id: `hash-dup-${survivor.id}-${loser.id}`,
        action,
      });
    }
  }

  return proposals;
}

// ── Reshape in-progress detection ─────────────────────────────────────────────

/** Name of the lock file written by cmdReshape while it runs. */
export const RESHAPE_LOCK_FILENAME = "reshape.lock";

interface ReshapeLockInfo {
  pid: number;
  timestamp: string;
}

/**
 * Encode a reshape lock payload for the current process.
 */
export function encodeReshapeLock(): string {
  return JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() });
}

/**
 * Acquire a reshape lock by writing `reshape.lock` to rexDir.
 * Returns a release function that deletes the lock file.
 */
export async function acquireReshapeLock(rexDir: string): Promise<() => Promise<void>> {
  const lockPath = join(rexDir, RESHAPE_LOCK_FILENAME);
  await writeFile(lockPath, encodeReshapeLock(), "utf-8");
  return async () => {
    try {
      await unlink(lockPath);
    } catch {
      // Stale cleanup already removed it — not an error.
    }
  };
}

/**
 * Check whether a full reshape is currently in progress.
 *
 * Returns `true` if `reshape.lock` exists and its recorded PID is alive.
 * Returns `false` if the file is absent, unreadable, malformed, or stale
 * (owner process is dead).
 */
export async function isReshapeInProgress(rexDir: string): Promise<boolean> {
  const lockPath = join(rexDir, RESHAPE_LOCK_FILENAME);
  try {
    const content = await readFile(lockPath, "utf-8");
    const info = JSON.parse(content) as ReshapeLockInfo;
    if (typeof info.pid !== "number") return false;
    try {
      process.kill(info.pid, 0); // signal 0 = existence check only
      return true;
    } catch {
      return false; // PID dead → stale lock
    }
  } catch {
    return false; // File absent or unreadable
  }
}

// ── Scoped consolidation pass ─────────────────────────────────────────────────

export interface ScopedConsolidationResult {
  /** Number of merge proposals applied (0 = no action). */
  mergedCount: number;
  /** Human-readable label for the parent scope (for CLI output). */
  parentLabel: string;
}

/**
 * Run a scoped hash-suffix consolidation pass on the siblings of a newly
 * added item.
 *
 * Skips silently when:
 * - `flags["no-reshape"] === "true"` (user passed `--no-reshape`)
 * - A full `ndx reshape` is detected in progress (reshape.lock present + live PID)
 * - The new item has no siblings
 * - No hash-suffix duplicates are found among siblings
 *
 * When duplicates are found, applies merge proposals in-memory and persists
 * the updated document and folder tree.
 */
export async function runScopedConsolidationPass(
  rexDir: string,
  store: PRDStore,
  newItemId: string,
  flags: Record<string, string>,
): Promise<ScopedConsolidationResult> {
  // --no-reshape opt-out
  if (flags["no-reshape"] === "true") {
    return { mergedCount: 0, parentLabel: "" };
  }

  // Skip if a full reshape is running concurrently
  if (await isReshapeInProgress(rexDir)) {
    return { mergedCount: 0, parentLabel: "" };
  }

  // Load post-add document state
  const doc = await store.loadDocument();
  const entry = findItem(doc.items, newItemId);
  if (!entry) {
    return { mergedCount: 0, parentLabel: "" };
  }

  // Determine sibling cohort
  let siblings: PRDItem[];
  let parentLabel: string;

  if (entry.parents.length === 0) {
    siblings = doc.items;
    parentLabel = "root";
  } else {
    const parent = entry.parents[entry.parents.length - 1];
    siblings = parent.children ?? [];
    parentLabel = parent.title;
  }

  if (siblings.length < 2) {
    return { mergedCount: 0, parentLabel };
  }

  // Detect hash-suffix duplicates among siblings
  const proposals = detectHashSuffixDuplicates(siblings, newItemId);
  if (proposals.length === 0) {
    return { mergedCount: 0, parentLabel };
  }

  // Apply proposals — applyReshape mutates doc.items in place
  const reshapeResult = applyReshape(doc.items, proposals);
  if (reshapeResult.applied.length === 0) {
    return { mergedCount: 0, parentLabel };
  }

  // Persist
  await store.saveDocument(doc);
  await syncFolderTree(rexDir, store);

  // Log the consolidation
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "add_reshape_consolidation",
    itemId: newItemId,
    detail: JSON.stringify({
      mergedCount: reshapeResult.applied.length,
      parentLabel,
      deletedIds: reshapeResult.deletedIds,
    }),
  });

  return {
    mergedCount: reshapeResult.applied.length,
    parentLabel,
  };
}
