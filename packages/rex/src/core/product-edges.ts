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
 * - {@link computeAreaLinks}: area → the other areas its capabilities share
 *   changes (`coChanges`) or test files with. A roll-up, so no schema field.
 * - {@link deriveChangeKind}: a change's kind, read from how it relates to the map.
 *
 * Cancelled and deleted changes contribute no edge of any kind: a change that
 * will never land must not steer placement through `coChanges` or `realizedBy`.
 *
 * Every ref (`amends[].target`, `touches`, `appliesTo`) goes through
 * {@link productIndex}, so an alias of a folded id lands on the node it was
 * folded into, and a ref to a retired (deleted) node still lands on it: a later
 * retirement does not rewrite an earlier change's kind or erase the node's
 * history. A retired node binds nothing and is bound by nothing. A ref that
 * resolves to nothing is skipped here; the tree rules report it.
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
import type { Amendment, ChangeNode, ConstraintNode } from "../schema/v2.js";
import { loadCommitFiles, loadTrailerCommits, type ChangeCommitsOptions } from "./change-commits.js";

// ── Index ────────────────────────────────────────────────────────

/**
 * The index every reader here resolves refs against: tombstones included, so
 * retired nodes keep their history; live ids and aliases still win over them.
 */
export function productIndex(tree: V2Tree): TreeIndex {
  return indexTree(tree, { includeTombstones: true });
}

// ── Kind ─────────────────────────────────────────────────────────

export const CHANGE_KINDS = ["feature", "enhancement", "retirement", "fix", "refactor", "policy-change", "spike"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * A change's kind, from its relationship to the map (the design's table):
 *
 * | Relationship                                          | Kind          |
 * |-------------------------------------------------------|---------------|
 * | `fix: true`, no amendment `added` or `removed`        | fix           |
 * | amends a constraint                                   | policy-change |
 * | amends, delta `added`                                 | feature       |
 * | amends, delta `modified`                              | enhancement   |
 * | amends, delta `removed`                               | retirement    |
 * | touches                                               | refactor      |
 * | neither, `spike: true`                                | spike         |
 *
 * When one change carries several, the first row above wins: amendments
 * outrank touches, and a constraint outranks the rest. A fix is marked on the
 * change (`fix: true`), not read from history, so an open change already has
 * its kind; adding or removing a node is never a fix. A change that relates to
 * the map in none of these ways (an inbox change) has no kind yet.
 *
 * Pass {@link productIndex}: an index without tombstones loses a since-retired
 * target, turning an earlier policy change into an enhancement.
 */
export function deriveChangeKind(change: ChangeNode, index: Pick<TreeIndex, "resolve">): ChangeKind | undefined {
  const amends = change.amends ?? [];
  if (change.fix === true && !amends.some((a) => a.delta === "added" || a.delta === "removed")) return "fix";
  // An added amendment's target does not exist yet, so its `type` says what it creates.
  const amendsConstraint = (a: Amendment) => (a.delta === "added" ? a.type : index.resolve(a.target)?.type) === "constraint";
  if (amends.some(amendsConstraint)) return "policy-change";
  for (const [delta, kind] of [["added", "feature"], ["modified", "enhancement"], ["removed", "retirement"]] as const) {
    if (amends.some((a) => a.delta === delta)) return kind;
  }
  if ((change.touches ?? []).some((ref) => index.resolve(ref) !== undefined)) return "refactor";
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
  /** Product node id (retired included) → ids of the live changes that amend or touch it, in tree order. */
  changedBy: Record<string, string[]>;
  /** Live product node id → ids of the live constraints that bind it, in tree order. */
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

/** Compute `changedBy`, `boundBy` and `coChanges` for every product node, retired ones included. */
export function computeEdges(tree: V2Tree): ProductEdges {
  const index = productIndex(tree);
  const live = index.entries.filter((e) => e.root === "product" && !e.retired);
  const liveNodes = new Set(live.map((e) => e.node));
  const edges: ProductEdges = { changedBy: {}, boundBy: {}, coChanges: {} };

  for (const { node } of live) {
    if (node.type !== "constraint") continue;
    const { appliesTo } = node as ConstraintNode;
    const bound =
      appliesTo === "all"
        ? live.map((e) => e.node).filter((n) => n.type === "capability")
        : (appliesTo ?? []).flatMap((ref) => {
            const target = index.resolve(ref);
            return target && liveNodes.has(target) ? [target, ...descendantCapabilities(target)] : [];
          });
    for (const target of bound) if (target.id !== node.id) push(edges.boundBy, target.id, node.id);
  }

  const shared = new Map<string, Map<string, number>>();
  for (const { node, retired } of index.entries) {
    if (node.type !== "change" || retired) continue;
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

// ── Shared files ─────────────────────────────────────────────────

const TEST_FILE = /[._](?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * The test files a capability's requirements run: the test paths in each
 * requirement's `validationCommand`, and in a `Linked to: a, b` description
 * (how the migration records a requirement's linked tests). Sorted, unique.
 */
export function capabilityTestFiles(node: Pick<RuleNode, "requirements">): string[] {
  const files = new Set<string>();
  for (const req of (node.requirements as { description?: string; validationCommand?: string }[] | undefined) ?? []) {
    const linked = /^Linked to:\s*(.*)$/s.exec(req.description ?? "")?.[1]?.split(",") ?? [];
    for (const word of [...linked, ...(req.validationCommand ?? "").split(/\s+/)]) {
      const file = word.trim();
      if (TEST_FILE.test(file)) files.add(file);
    }
  }
  return [...files].sort();
}

export interface SharedFiles {
  /** The earlier of the two ids in the order the map was given. */
  a: string;
  /** The later id. */
  b: string;
  /** Files both list, sorted. */
  files: string[];
}

/**
 * Every pair of ids whose file lists overlap, with the files they share. Pairs
 * come in the map's order: `a` is always the id listed first, so a caller that
 * turns a pair into a direction gets one that cannot cycle.
 */
export function sharedFilePairs(filesById: ReadonlyMap<string, readonly string[]>): SharedFiles[] {
  const ids = [...filesById.keys()];
  const order = new Map(ids.map((id, i) => [id, i]));
  const holders = new Map<string, string[]>();
  for (const [id, files] of filesById) for (const file of new Set(files)) (holders.get(file) ?? holders.set(file, []).get(file)!).push(id);

  const pairs = new Map<string, SharedFiles>();
  for (const [file, owners] of holders) {
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const key = `${owners[i]}\u0000${owners[j]}`;
        const pair = pairs.get(key) ?? { a: owners[i]!, b: owners[j]!, files: [] };
        pair.files.push(file);
        pairs.set(key, pair);
      }
    }
  }
  return [...pairs.values()]
    .map((p) => ({ ...p, files: p.files.sort() }))
    .sort((x, y) => order.get(x.a)! - order.get(y.a)! || order.get(x.b)! - order.get(y.b)!);
}

// ── Area links ───────────────────────────────────────────────────

export interface AreaLink {
  /** The other area's id. */
  id: string;
  /** Summed over capability pairs across the two areas: how many changes amend or touch both. */
  coChanges: number;
  /** Test files run by a capability in each area, sorted. */
  sharedTests: string[];
}

/**
 * Area → the other areas its capabilities are tied to, rolled up from
 * capability `coChanges` and from test files capabilities in both areas run
 * ({@link capabilityTestFiles}). Computed, never stored: no schema field holds
 * it. Live capabilities only; a capability's area is its nearest area
 * ancestor, and pairs inside one area add nothing. Strongest link first (more
 * shared changes, then more shared tests), then by id. Areas tied to nothing
 * are absent.
 */
export function computeAreaLinks(tree: V2Tree, edges: ProductEdges = computeEdges(tree)): Record<string, AreaLink[]> {
  const index = productIndex(tree);
  const parentOf = new Map(index.entries.map((e) => [e.node, e.parent]));
  const areaOf = new Map<string, string>();
  const tests = new Map<string, string[]>();
  for (const { node, root, retired } of index.entries) {
    if (root !== "product" || retired || node.type !== "capability") continue;
    let up = parentOf.get(node);
    while (up && up.type !== "area") up = parentOf.get(up);
    if (!up) continue;
    areaOf.set(node.id, up.id);
    tests.set(node.id, capabilityTestFiles(node));
  }

  const links = new Map<string, Map<string, { coChanges: number; tests: Set<string> }>>();
  const link = (a: string, b: string) => {
    const row = links.get(a) ?? links.set(a, new Map()).get(a)!;
    return row.get(b) ?? row.set(b, { coChanges: 0, tests: new Set() }).get(b)!;
  };
  for (const [capability, area] of areaOf) {
    for (const { id, changes } of edges.coChanges[capability] ?? []) {
      const other = areaOf.get(id);
      if (other !== undefined && other !== area) link(area, other).coChanges += changes;
    }
  }
  for (const { a, b, files } of sharedFilePairs(tests)) {
    const [areaA, areaB] = [areaOf.get(a)!, areaOf.get(b)!];
    if (areaA === areaB) continue;
    for (const file of files) {
      link(areaA, areaB).tests.add(file);
      link(areaB, areaA).tests.add(file);
    }
  }

  const out: Record<string, AreaLink[]> = {};
  for (const [area, row] of links) {
    out[area] = [...row]
      .map(([id, { coChanges, tests: shared }]) => ({ id, coChanges, sharedTests: [...shared].sort() }))
      .sort((x, y) => y.coChanges - x.coChanges || y.sharedTests.length - x.sharedTests.length || x.id.localeCompare(y.id));
  }
  return out;
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
export function trailerIds(node: Pick<RuleNode, "id" | "aliases" | "children">): string[] {
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
  const index = productIndex(tree);
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
 * item returns the node it was folded into. A retired node resolves too, after
 * every live id and alias.
 */
export function resolveNode(tree: V2Tree, ref: string): RuleNode | undefined {
  return productIndex(tree).resolve(ref);
}
