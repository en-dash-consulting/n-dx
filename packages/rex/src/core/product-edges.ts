/**
 * Computed edges between the product layer and the change layer, and the kind
 * of a change. Nothing here is stored: every value is derived from the loaded
 * tree (and, for `realizedBy`, from git), so it cannot drift from its source.
 *
 * - `changedBy`: product node → the changes that amend or touch it (inverse of
 *   `amends` and `touches`).
 * - `boundBy`: product node → the constraints that bind it (inverse of `appliesTo`;
 *   a constraint on an area or capability also binds its descendant capabilities).
 * - `coChanges`: product node → the other nodes changed or touched by the same
 *   changes, with how many changes they share.
 * - `realizedBy`: capability → the commits, files and zones of the changes that
 *   amended it. Commits are found by `N-DX-Item` trailer (`change-commits.ts`).
 * - {@link deriveChangeKind}: a change's kind, read from how it relates to the map.
 *
 * Cancelled and deleted changes contribute no edge of any kind: a change that
 * will never land must not steer placement through `coChanges` or `realizedBy`.
 *
 * Every ref (`amends[].target`, `touches`, `appliesTo`) goes through the tree
 * index, so an alias of a folded id lands on the node it was folded into. A
 * ref that resolves to nothing is skipped here; the tree rules report it.
 *
 * ## Cache
 *
 * The edges are cheap and pure, so they are recomputed on demand. What costs
 * is git: the files per commit are cached under `<rexDir>/.cache` (gitignored
 * by `rex init`) and rebuilt when missing; see `loadCommitFiles`.
 *
 * @module rex/core/product-edges
 */

import { indexTree, type RuleNode, type TreeIndex, type V2Tree } from "../schema/v2-rules.js";
import type { ChangeNode, ConstraintNode } from "../schema/v2.js";
import { loadCommitFiles, loadTrailerCommits, type ChangeCommitsOptions } from "./change-commits.js";

// ── Kind ─────────────────────────────────────────────────────────

export const CHANGE_KINDS = ["feature", "enhancement", "retirement", "fix", "refactor", "policy-change", "spike"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export interface ChangeKindOptions {
  /**
   * Ids of capabilities that went from failing to met. Passing the ids a
   * touching change fixed is the caller's job: that needs status history this
   * module does not read. A touch of any of them makes the change a fix.
   */
  fixed?: ReadonlySet<string>;
}

/**
 * A change's kind, from its relationship to the map (the design's table):
 *
 * | Relationship                              | Kind          |
 * |-------------------------------------------|---------------|
 * | amends a constraint                       | policy-change |
 * | amends, delta `added`                     | feature       |
 * | amends, delta `modified`                  | enhancement   |
 * | amends, delta `removed`                   | retirement    |
 * | touches, a capability went failing → met  | fix           |
 * | touches, no status change                 | refactor      |
 * | neither, `spike: true`                    | spike         |
 *
 * When one change carries several, the first row above wins: amendments
 * outrank touches, and a constraint outranks the rest. A change that relates to
 * the map in none of these ways (an inbox change) has no kind yet.
 */
export function deriveChangeKind(
  change: ChangeNode,
  index: Pick<TreeIndex, "resolve">,
  options: ChangeKindOptions = {},
): ChangeKind | undefined {
  const amends = change.amends ?? [];
  if (amends.some((a) => index.resolve(a.target)?.type === "constraint")) return "policy-change";
  for (const [delta, kind] of [["added", "feature"], ["modified", "enhancement"], ["removed", "retirement"]] as const) {
    if (amends.some((a) => a.delta === delta)) return kind;
  }
  const touched = (change.touches ?? []).map((ref) => index.resolve(ref)).filter((n): n is RuleNode => n !== undefined);
  if (touched.length > 0) return touched.some((n) => options.fixed?.has(n.id)) ? "fix" : "refactor";
  return change.spike === true ? "spike" : undefined;
}

// ── Edges ────────────────────────────────────────────────────────

export interface CoChange {
  /** The other product node's id. */
  id: string;
  /** How many changes amend or touch both nodes. */
  changes: number;
}

export interface ProductEdges {
  /** Product node id → ids of the live changes that amend or touch it, in tree order. */
  changedBy: Record<string, string[]>;
  /** Product node id → ids of the constraints that bind it, in tree order. */
  boundBy: Record<string, string[]>;
  /** Product node id → nodes it shares changes with, most shared first, then by id. */
  coChanges: Record<string, CoChange[]>;
}

/** Every live capability below a node. */
function descendantCapabilities(node: RuleNode): RuleNode[] {
  return (node.children ?? []).flatMap((child) =>
    child.status === "deleted" ? [] : [...(child.type === "capability" ? [child] : []), ...descendantCapabilities(child)],
  );
}

function push(map: Record<string, string[]>, key: string, value: string): void {
  const list = (map[key] ??= []);
  if (!list.includes(value)) list.push(value);
}

/** Compute `changedBy`, `boundBy` and `coChanges` for every live product node. */
export function computeEdges(tree: V2Tree): ProductEdges {
  const index = indexTree(tree);
  const live = index.entries.filter((e) => e.root === "product");
  const edges: ProductEdges = { changedBy: {}, boundBy: {}, coChanges: {} };

  for (const { node } of live) {
    if (node.type !== "constraint") continue;
    const { appliesTo } = node as ConstraintNode;
    const bound =
      appliesTo === "all"
        ? live.map((e) => e.node).filter((n) => n.type === "capability")
        : (appliesTo ?? []).flatMap((ref) => {
            const target = index.resolve(ref);
            return target ? [target, ...descendantCapabilities(target)] : [];
          });
    for (const target of bound) if (target && target.id !== node.id) push(edges.boundBy, target.id, node.id);
  }

  const shared = new Map<string, Map<string, number>>();
  for (const { node } of index.entries) {
    if (node.type !== "change") continue;
    if (node.status === "cancelled") continue;
    const change = node as ChangeNode;
    const resolved = (refs: readonly string[]) => refs.map((ref) => index.resolve(ref)).filter((n): n is RuleNode => n !== undefined);
    const related = [...resolved((change.amends ?? []).map((a) => a.target)), ...resolved(change.touches ?? [])];
    for (const target of related) push(edges.changedBy, target.id, change.id);

    const ids = new Set(related.map((n) => n.id));
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const row = shared.get(a) ?? new Map<string, number>();
        row.set(b, (row.get(b) ?? 0) + 1);
        shared.set(a, row);
      }
    }
  }
  for (const [id, row] of shared) {
    edges.coChanges[id] = [...row].map(([other, changes]) => ({ id: other, changes })).sort((x, y) => y.changes - x.changes || x.id.localeCompare(y.id));
  }
  return edges;
}

// ── Realized by ──────────────────────────────────────────────────

export interface Realization {
  /** Commit SHAs of the amending changes' work, newest first. */
  commits: string[];
  /** Files those commits changed, sorted. */
  files: string[];
  /** Zones of those files, sorted; empty when no `zoneOf` was given. */
  zones: string[];
}

export interface RealizedByOptions extends ChangeCommitsOptions {
  /** Maps a repository-relative file to its zone id (sourcevision's zones); omit to skip zones. */
  zoneOf?: (file: string) => string | undefined;
}

/** A node's own ids and aliases plus those of every descendant: the ids its commits' trailers may name. */
function trailerIds(node: RuleNode): string[] {
  return [node.id, ...(node.aliases ?? []), ...(node.children ?? []).flatMap(trailerIds)];
}

/**
 * For each capability amended by at least one change, the commits, files and
 * zones of those changes. A change's commits are those whose `N-DX-Item`
 * trailer names the change, one of its tasks or subtasks, or an alias of any.
 * Throws when the ref does not resolve, like `computeChangeCommits`.
 */
export async function computeRealizedBy(
  tree: V2Tree,
  edges: ProductEdges,
  options: RealizedByOptions,
): Promise<Record<string, Realization>> {
  const index = indexTree(tree);
  const trailerCommits = await loadTrailerCommits(options);
  const out: Record<string, Realization> = {};

  // `changedBy` also holds touching changes; only amendments realize a capability.
  const namedBy = new Map<string, Set<string>>();
  for (const [id, changeIds] of Object.entries(edges.changedBy)) {
    if (index.resolve(id)?.type !== "capability") continue;
    const amending = changeIds
      .map((changeId) => index.resolve(changeId) as ChangeNode | undefined)
      .filter((change): change is ChangeNode => change?.amends?.some((a) => index.resolve(a.target)?.id === id) === true);
    if (amending.length > 0) namedBy.set(id, new Set(amending.flatMap(trailerIds)));
  }
  const capabilities = [...namedBy.keys()];
  const commitsOf = new Map<string, string[]>();
  for (const [id, named] of namedBy) {
    commitsOf.set(id, trailerCommits.filter((c) => c.items.some((item) => named.has(item))).map((c) => c.hash));
  }

  const filesOf = await loadCommitFiles(options.repoDir, options.cacheDir, [...commitsOf.values()].flat());
  for (const id of capabilities) {
    const commits = commitsOf.get(id) ?? [];
    const files = [...new Set(commits.flatMap((hash) => filesOf.get(hash) ?? []))].sort();
    const zones = options.zoneOf ? [...new Set(files.map(options.zoneOf).filter((z): z is string => z !== undefined))].sort() : [];
    out[id] = { commits, files, zones };
  }
  return out;
}

// ── Lookup ───────────────────────────────────────────────────────

/**
 * The node a ref names: by id, display id, or an alias, so the id of a folded
 * item returns the node it was folded into. Deleted nodes do not resolve.
 */
export function resolveNode(tree: V2Tree, ref: string): RuleNode | undefined {
  return indexTree(tree).resolve(ref);
}
