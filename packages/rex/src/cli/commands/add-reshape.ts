/**
 * Hash-suffix duplicate detector and scoped consolidation pass for the add command.
 *
 * After inserting a new item, detects hash-suffix duplicate siblings and
 * consolidates them immediately so the PRD never accumulates near-duplicate
 * siblings from repeated `add` calls with slightly different titles.
 *
 * Hash suffix patterns stripped by this module:
 *   - Parenthesized/bracketed short identifier: "(abc123)", "[ABC-1]"
 *   - Parenthesized/bracketed UUID: "(550e8400-e29b-41d4-a716-446655440000)"
 *   - Dash UUID tail: " - 550e8400-e29b-41d4-a716-446655440000"
 *   - Dash short hex tail: " - a1b2c3" (6–12 purely hex chars)
 *
 * @module cli/commands/add-reshape
 */

import { join } from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { findItem, walkTree } from "../../core/tree.js";
import { applyReshape } from "../../core/reshape.js";
import type { ReshapeProposal, MergeAction, GroupAction } from "../../core/reshape.js";
import type { PRDItem, ItemLevel } from "../../schema/index.js";
import type { PRDStore } from "../../store/index.js";
import { syncFolderTree } from "./folder-tree-sync.js";
import { appendArchiveBatch } from "../../core/archive.js";
import { captureGitCommitHash } from "../../core/git-utils.js";

// ── Hash-suffix detection ─────────────────────────────────────────────────────

/** Hex UUID pattern: 8-4-4-4-12 lowercase hex segments. */
const UUID_RE = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";

/**
 * Strip trailing hash/ID suffix from a title.
 *
 * Matched patterns (checked in order, most-specific first):
 *   "Fix bug (550e8400-e29b-41d4-a716-446655440000)" → "Fix bug"  (bracketed UUID)
 *   "Fix bug (abc123)"                               → "Fix bug"  (bracketed short id)
 *   "Fix bug [ABC-123]"                              → "Fix bug"  (bracket variant)
 *   "Fix bug - 550e8400-e29b-41d4-a716-446655440000" → "Fix bug"  (dash UUID tail)
 *   "Fix bug - a1b2c3"                               → "Fix bug"  (dash short hex tail)
 */
export function stripHashSuffix(title: string): string {
  return (
    title
      // 1. Parenthesized/bracketed UUID
      .replace(new RegExp(`\\s*[\\(\\[]\\s*${UUID_RE}\\s*[\\)\\]]\\s*$`, "i"), "")
      // 2. Parenthesized/bracketed short alphanumeric-or-hyphen identifier (3–12 chars)
      .replace(/\s*[\(\[]\s*[a-zA-Z0-9][a-zA-Z0-9\-]{2,11}\s*[\)\]]\s*$/, "")
      // 3. Dash UUID tail: " - <uuid>"
      .replace(new RegExp(`\\s+-\\s+${UUID_RE}$`, "i"), "")
      // 4. Dash short hex tail: " - <6–12 purely hex chars>"
      .replace(/\s+-\s+[a-f0-9]{6,12}$/i, "")
      .trim()
  );
}

/**
 * Normalize a title for deduplication comparison.
 * Strips hash suffix then lowercases and collapses whitespace.
 */
function normalizeForComparison(title: string): string {
  return stripHashSuffix(title).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Return the container level one step above the given item level, or null
 * if there is no valid container level (e.g. epics can only live at root).
 */
export function getContainerLevel(level: ItemLevel): ItemLevel | null {
  switch (level) {
    case "task": return "feature";
    case "feature": return "epic";
    case "subtask": return "task";
    case "epic": return null;
  }
}

/**
 * Detect hash-suffix duplicate pairs among siblings.
 *
 * Two siblings are hash-suffix duplicates when their titles, after stripping
 * any trailing "(hash)" / "[hash]" suffix, normalize to the same string.
 *
 * Survivor selection (most children > no-suffix > oldest createdAt > non-new > first):
 *   1. Prefer the item with the most children.
 *   2. Among ties, prefer the item whose title has no hash suffix (canonical form).
 *   3. Among ties, prefer the item with the oldest createdAt timestamp.
 *   4. Among ties, prefer any existing item over the newly added item (newItemId).
 *   5. Fall back to first in sibling order.
 *
 * Strategy selection:
 *   - When ALL items in a group have at least one child AND the group level has a
 *     valid container level → emit a GroupAction (parent-container strategy).
 *   - Otherwise → emit MergeActions (merge strategy).
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

  for (const [strippedKey, group] of groups) {
    if (group.length < 2) continue;

    // Determine strategy: group action when all items have children and level allows
    const allHaveChildren = group.every((g) => g.children && g.children.length > 0);
    const containerLevel = group[0].level ? getContainerLevel(group[0].level) : null;

    if (allHaveChildren && containerLevel !== null) {
      // Parent-container strategy: create a new container and move all items under it
      const action: GroupAction = {
        action: "group",
        containerId: randomUUID(),
        containerTitle: strippedKey,
        containerLevel,
        itemIds: group.map((g) => g.id),
        reason: "hash-suffix-distinct-cases-container",
      };
      proposals.push({
        id: `hash-group-${group.map((g) => g.id).join("-")}`,
        action,
      });
      continue;
    }

    // Merge strategy: pick survivor, merge losers into it

    // Sort by most children first, then no-suffix, then non-new, then first in sibling order
    const sorted = [...group].sort((a, b) => {
      const aChildren = a.children?.length ?? 0;
      const bChildren = b.children?.length ?? 0;
      if (bChildren !== aChildren) return bChildren - aChildren; // more children first

      const aNoSuffix = stripHashSuffix(a.title) === a.title.trim() ? 0 : 1;
      const bNoSuffix = stripHashSuffix(b.title) === b.title.trim() ? 0 : 1;
      if (aNoSuffix !== bNoSuffix) return aNoSuffix - bNoSuffix; // no-suffix first

      const aNew = a.id === newItemId ? 1 : 0;
      const bNew = b.id === newItemId ? 1 : 0;
      return aNew - bNew; // non-new first (positional fallback preserved)
    });

    const survivor = sorted[0];
    const losers = sorted.slice(1);

    const processed = new Set<string>();
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

// ── Tree-level duplicate detector ────────────────────────────────────────────

/**
 * A group of sibling items whose titles reduce to the same normalized form
 * after stripping trailing hash/ID suffixes.
 */
export interface HashSuffixDuplicateGroup {
  /** Normalized title shared by all members (hash suffix stripped, lowercased). */
  normalizedTitle: string;
  /** Parent item ID, or undefined for root-level items. */
  parentId: string | undefined;
  /** Parent item title, or undefined for root-level items. */
  parentTitle: string | undefined;
  /** Members of this duplicate group. */
  members: Array<{
    id: string;
    title: string;
    childCount: number;
  }>;
  /** Pre-computed reshape proposals for this group (feed into applyReshape). */
  proposals: ReshapeProposal[];
}

/**
 * Walk the full PRD tree and detect hash-suffix duplicate sibling cohorts.
 *
 * Groups sibling items (same parent + level) whose titles are identical after
 * stripping trailing hash/ID suffixes. Returns one entry per group with:
 *   - parent context (parentId, parentTitle)
 *   - member IDs, original titles, and child counts
 *   - normalized canonical title
 *   - pre-computed reshape proposals (feed into applyReshape)
 *
 * Use `groups.flatMap(g => g.proposals)` to feed the reshape pipeline.
 * Items with genuinely different titles (differences beyond a suffix) are
 * never grouped — normalizeForComparison must return distinct strings.
 */
export function detectHashSuffixDuplicatesInTree(
  items: PRDItem[],
): HashSuffixDuplicateGroup[] {
  // Build cohort map: (parentId:level) → { items[], parent }
  const cohortMap = new Map<string, { items: PRDItem[]; parent: PRDItem | undefined }>();

  for (const { item, parents } of walkTree(items)) {
    const parent = parents.length > 0 ? parents[parents.length - 1] : undefined;
    const parentId = parent?.id ?? "root";
    const key = `${parentId}:${item.level}`;
    const entry = cohortMap.get(key) ?? { items: [], parent };
    entry.items.push(item);
    cohortMap.set(key, entry);
  }

  const groups: HashSuffixDuplicateGroup[] = [];

  for (const [, { items: cohort, parent }] of cohortMap) {
    if (cohort.length < 2) continue;

    // Sub-group members by normalized title
    const byNormalized = new Map<string, PRDItem[]>();
    for (const item of cohort) {
      const key = normalizeForComparison(item.title);
      if (!key) continue;
      const grp = byNormalized.get(key) ?? [];
      grp.push(item);
      byNormalized.set(key, grp);
    }

    for (const [normalizedTitle, members] of byNormalized) {
      if (members.length < 2) continue;

      // Generate proposals for this group using the existing per-cohort detector.
      // Pass empty string as newItemId — no single "new" item in the tree context.
      const proposals = detectHashSuffixDuplicates(members, "");

      groups.push({
        normalizedTitle,
        parentId: parent?.id,
        parentTitle: parent?.title,
        members: members.map((item) => ({
          id: item.id,
          title: item.title,
          childCount: item.children?.length ?? 0,
        })),
        proposals,
      });
    }
  }

  return groups;
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
  /** IDs archived (losers in merge strategy). */
  archivedIds: string[];
  /** Strategy applied: "merge" or "parent-container". */
  strategy: "merge" | "parent-container" | "none";
  /** Number of children reparented from losers to survivor. */
  reparentedChildCount: number;
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
  const empty = (parentLabel: string): ScopedConsolidationResult => ({
    mergedCount: 0,
    parentLabel,
    archivedIds: [],
    strategy: "none",
    reparentedChildCount: 0,
  });

  // --no-reshape opt-out
  if (flags["no-reshape"] === "true") {
    return empty("");
  }

  // Skip if a full reshape is running concurrently
  if (await isReshapeInProgress(rexDir)) {
    return empty("");
  }

  // Load post-add document state
  const doc = await store.loadDocument();
  const entry = findItem(doc.items, newItemId);
  if (!entry) {
    return empty("");
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
    return empty(parentLabel);
  }

  // Detect hash-suffix duplicates among siblings
  const proposals = detectHashSuffixDuplicates(siblings, newItemId);
  if (proposals.length === 0) {
    return empty(parentLabel);
  }

  // Determine strategy and count reparented children before applying
  const hasGroup = proposals.some((p) => p.action.action === "group");
  const strategy: ScopedConsolidationResult["strategy"] = hasGroup ? "parent-container" : "merge";

  let reparentedChildCount = 0;
  for (const proposal of proposals) {
    if (proposal.action.action === "merge") {
      const mergeAction = proposal.action as import("../../core/reshape.js").MergeAction;
      for (const loserId of mergeAction.mergedIds) {
        const loserEntry = findItem(doc.items, loserId);
        reparentedChildCount += loserEntry?.item.children?.length ?? 0;
      }
    } else if (proposal.action.action === "group") {
      const groupAction = proposal.action as import("../../core/reshape.js").GroupAction;
      for (const itemId of groupAction.itemIds) {
        const itemEntry = findItem(doc.items, itemId);
        reparentedChildCount += itemEntry?.item.children?.length ?? 0;
      }
    }
  }

  // Apply proposals — applyReshape mutates doc.items in place
  const reshapeResult = applyReshape(doc.items, proposals);
  if (reshapeResult.applied.length === 0) {
    return empty(parentLabel);
  }

  // Persist
  await store.saveDocument(doc);
  await syncFolderTree(rexDir, store);

  // Archive removed items
  if (reshapeResult.archivedItems.length > 0) {
    const dir = join(rexDir, "..");
    const preReshapeCommit = await captureGitCommitHash(dir);
    const timestamp = new Date().toISOString();
    await appendArchiveBatch(rexDir, {
      timestamp,
      source: "reshape",
      items: reshapeResult.archivedItems,
      count: reshapeResult.archivedItems.length,
      reason: "hash-suffix consolidation (add path)",
      mergeAuditTrail: reshapeResult.mergeAuditTrail.map((m) => ({
        survivorId: m.survivorId,
        mergedFromIds: m.mergedFromIds,
        reasoning: m.reasoning,
        preReshapeCommit,
        timestamp,
      })),
    });
  }

  // Log the consolidation
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "add_reshape_consolidation",
    itemId: newItemId,
    detail: JSON.stringify({
      mergedCount: reshapeResult.applied.length,
      parentLabel,
      deletedIds: reshapeResult.deletedIds,
      strategy,
      reparentedChildCount,
      archivedIds: reshapeResult.deletedIds,
    }),
  });

  return {
    mergedCount: reshapeResult.applied.length,
    parentLabel,
    archivedIds: reshapeResult.deletedIds,
    strategy,
    reparentedChildCount,
  };
}
