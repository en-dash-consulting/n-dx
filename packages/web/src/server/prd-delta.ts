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
 * Results are cached per (anchor, workspace) pair and dropped when either
 * tree's watcher fires — start.ts calls {@link invalidatePrdDelta} from the
 * same debounced callback that refreshes the PRD cache.
 *
 * @module web/server/prd-delta
 */

import { walkTree } from "./rex-gateway.js";
import type { PRDDocument, PRDItem } from "./rex-gateway.js";

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

/** Flatten a tree into an id → item map. A repeated id keeps its first occurrence. */
function indexById(doc: PRDDocument | null): Map<string, PRDItem> {
  const byId = new Map<string, PRDItem>();
  if (!doc) return byId;
  for (const { item } of walkTree(doc.items ?? [])) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return byId;
}

function fieldsDiffer(a: PRDItem, b: PRDItem): boolean {
  for (const field of PRD_DELTA_COMPARED_FIELDS) {
    if ((a[field] ?? null) !== (b[field] ?? null)) return true;
  }
  return false;
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
  const anchor = indexById(anchorDoc);
  const here = indexById(workspaceDoc);

  const onlyHere: string[] = [];
  const changed: string[] = [];
  const completedHere: string[] = [];
  for (const [id, item] of here) {
    const other = anchor.get(id);
    if (!other) onlyHere.push(id);
    else if (fieldsDiffer(item, other)) changed.push(id);
    if (item.status === "completed" && other?.status !== "completed") completedHere.push(id);
  }
  const onlyAnchor: string[] = [];
  for (const id of anchor.keys()) {
    if (!here.has(id)) onlyAnchor.push(id);
  }
  for (const list of [onlyHere, onlyAnchor, changed, completedHere]) list.sort();

  const counts: PrdDeltaCounts = {
    onlyHere: onlyHere.length,
    onlyAnchor: onlyAnchor.length,
    changed: changed.length,
    completedHere: completedHere.length,
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
    totals: { anchor: anchor.size, workspace: here.size },
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
