/**
 * PRD delta: how a worktree's tree differs from the anchor's.
 *
 * Each worktree carries its own `.rex/prd_tree`, so two checkouts of one
 * repository drift: tasks added on a branch, tasks the main line completed
 * since the branch was cut, statuses that moved on one side. The Workspaces
 * view answers "what is different here?" from this module, computed once on
 * the server rather than by shipping both trees to the browser.
 *
 * The diff is by item id, over the flattened trees:
 *
 * - `onlyHere`       ids in the workspace the anchor does not have
 * - `onlyAnchor`     ids in the anchor the workspace does not have
 * - `changed`        ids in both whose status, title, priority, description
 *                    or lastModified differ
 * - `completedHere`  ids completed in the workspace that the anchor has not
 *                    completed (absent from the anchor, or present and not
 *                    completed) — "what this branch finished that main lacks"
 *
 * The categories overlap by design (a task added and finished on the branch
 * is both `onlyHere` and `completedHere`); they are four questions, not a
 * partition. Id lists are capped at {@link PRD_DELTA_ID_CAP} with
 * `truncated` set; counts are always exact.
 *
 * ## Where the diff itself lives
 *
 * The id-indexing, field comparison and category assignment are rex's
 * {@link diffTrees} — the same function behind `rex tree-diff`. What stays
 * here is only this endpoint's projection of it: the anchor/workspace
 * naming, the id-list cap, and the cache. Two implementations of "how do
 * these trees differ" would be free to drift, and the dashboard's answer and
 * the CLI's answer disagreeing about the same pair of trees is exactly the
 * bug nobody would think to look for.
 *
 * rex's `moved` category is deliberately not surfaced here: this payload's
 * four id lists are a published shape the Workspaces board reads, and a
 * reparent already registers as nothing at all today. Adding it is a viewer
 * change, not a diff change.
 *
 * Results are cached per (anchor, workspace) pair and dropped when either
 * tree's watcher fires — start.ts calls {@link invalidatePrdDelta} from the
 * same debounced callback that refreshes the PRD cache.
 *
 * @module web/server/prd-delta
 */

import { diffTrees } from "./rex-gateway.js";
import type { PRDDocument } from "./rex-gateway.js";

/** Longest id list the response carries per category. */
export const PRD_DELTA_ID_CAP = 500;

/** Fields whose difference makes an item `changed`. */
export const PRD_DELTA_COMPARED_FIELDS = ["status", "title", "priority", "description", "lastModified"] as const;

export interface PrdDeltaCounts {
  onlyHere: number;
  onlyAnchor: number;
  changed: number;
  completedHere: number;
}

export interface PrdDelta {
  /** Key of the anchor workspace the diff is against. */
  anchor: string;
  /** Key of the workspace being compared. */
  workspace: string;
  /** Whether each side had a loadable PRD; a missing side diffs as empty. */
  sources: { anchor: boolean; workspace: boolean };
  /** Items in each tree (flattened). */
  totals: { anchor: number; workspace: number };
  counts: PrdDeltaCounts;
  onlyHere: string[];
  onlyAnchor: string[];
  changed: string[];
  completedHere: string[];
  /** True when any id list was cut to {@link PRD_DELTA_ID_CAP}. */
  truncated: boolean;
  /** True when every count is zero. */
  identical: boolean;
  computedAt: string;
}

function cap(ids: string[]): { ids: string[]; cut: boolean } {
  return ids.length > PRD_DELTA_ID_CAP ? { ids: ids.slice(0, PRD_DELTA_ID_CAP), cut: true } : { ids, cut: false };
}

/**
 * Diff `workspace` against `anchor`. Pure; sorted id lists so two runs over
 * the same trees produce the same payload.
 */
export function computePrdDelta(
  anchorDoc: PRDDocument | null,
  workspaceDoc: PRDDocument | null,
  keys: { anchor: string; workspace: string },
  now: () => Date = () => new Date(),
): PrdDelta {
  // The workspace is the "to" side: rex's `added` is what only this
  // workspace has, `removed` is what only the anchor has.
  const diff = diffTrees(anchorDoc?.items ?? [], workspaceDoc?.items ?? [], {
    comparedFields: PRD_DELTA_COMPARED_FIELDS,
  });

  const ids = (entries: { id: string }[]): string[] => entries.map((e) => e.id);
  const onlyHere = ids(diff.added);
  const onlyAnchor = ids(diff.removed);
  const changed = ids(diff.changed);
  const completedHere = ids(diff.completed);

  const counts: PrdDeltaCounts = {
    onlyHere: diff.counts.added,
    onlyAnchor: diff.counts.removed,
    changed: diff.counts.changed,
    completedHere: diff.counts.completed,
  };
  const capped = {
    onlyHere: cap(onlyHere),
    onlyAnchor: cap(onlyAnchor),
    changed: cap(changed),
    completedHere: cap(completedHere),
  };
  return {
    anchor: keys.anchor,
    workspace: keys.workspace,
    sources: { anchor: anchorDoc !== null, workspace: workspaceDoc !== null },
    totals: { anchor: diff.totals.from, workspace: diff.totals.to },
    counts,
    onlyHere: capped.onlyHere.ids,
    onlyAnchor: capped.onlyAnchor.ids,
    changed: capped.changed.ids,
    completedHere: capped.completedHere.ids,
    truncated: Object.values(capped).some((c) => c.cut),
    identical: Object.values(counts).every((n) => n === 0),
    computedAt: now().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Cache — one entry per (anchor rexDir, workspace rexDir), dropped by watchers
// ---------------------------------------------------------------------------

interface CacheEntry {
  anchorRexDir: string;
  workspaceRexDir: string;
  delta: PrdDelta;
}

const cache = new Map<string, CacheEntry>();

/** Paths never contain a newline, so it separates the pair unambiguously. */
function cacheKey(anchorRexDir: string, workspaceRexDir: string): string {
  return `${anchorRexDir}\n${workspaceRexDir}`;
}

/**
 * The cached delta for a pair, or compute and cache it. `load` is called for
 * each side only on a miss.
 */
export function cachedPrdDelta(
  pair: { anchorRexDir: string; workspaceRexDir: string; anchorKey: string; workspaceKey: string },
  load: (rexDir: string) => PRDDocument | null,
): PrdDelta {
  const key = cacheKey(pair.anchorRexDir, pair.workspaceRexDir);
  const hit = cache.get(key);
  if (hit) return hit.delta;
  const delta = computePrdDelta(
    load(pair.anchorRexDir),
    load(pair.workspaceRexDir),
    { anchor: pair.anchorKey, workspace: pair.workspaceKey },
  );
  cache.set(key, { anchorRexDir: pair.anchorRexDir, workspaceRexDir: pair.workspaceRexDir, delta });
  return delta;
}

/**
 * Drop every cached delta that involves `rexDir` — as anchor or as workspace.
 * Called from the rex tree watcher of each workspace, so a change on either
 * side of a pair invalidates it. With no argument, drops everything.
 */
export function invalidatePrdDelta(rexDir?: string): void {
  if (rexDir === undefined) {
    cache.clear();
    return;
  }
  for (const [key, entry] of cache) {
    if (entry.anchorRexDir === rexDir || entry.workspaceRexDir === rexDir) cache.delete(key);
  }
}

/** Number of cached pairs — for tests. */
export function prdDeltaCacheSize(): number {
  return cache.size;
}
