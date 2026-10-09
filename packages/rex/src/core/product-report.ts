/**
 * Read-only reports over a v2 tree, the shapes the rex MCP read tools return:
 *
 * - {@link productReport}: the product layer as areas → capabilities and
 *   constraints, each with its computed status and health (`get_product`).
 * - {@link capabilityReport}: one capability or constraint with its parent
 *   chain, status, and the changes and constraints related to it
 *   (`get_capability`).
 * - {@link prdStatusReport}: product status per area and change counts per
 *   release (`get_prd_status` on a v2 tree).
 *
 * Pure: every value is derived from the tree passed in. Nothing reads git, so
 * `realizedBy` is not reported here.
 *
 * @module rex/core/product-report
 */

import type { ItemStatus } from "../schema/v1.js";
import type { ChangeNode } from "../schema/v2.js";
import { indexTree, isAppliedChange, isOpenChange, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { compareReleases } from "./change-selection.js";
import { computeEdges, productIndex, type CoChange } from "./product-edges.js";
import { computeProductStatus, type Health, type IntentStatus, type ProductStatus } from "./product-status.js";

// ── get_product ──────────────────────────────────────────────────

/** A product node as the product report lists it. Areas carry no status. */
export interface ProductReportNode {
  id: string;
  displayId?: string;
  type: "area" | "capability" | "constraint";
  title: string;
  /** An area's summary. */
  summary?: string;
  /** A capability's or constraint's statement. */
  statement?: string;
  status?: IntentStatus;
  health?: Health;
  children?: ProductReportNode[];
}

/** The live product layer, areas first as stored, with each capability's and constraint's status and health. */
export function productReport(tree: V2Tree): ProductReportNode[] {
  const status = computeProductStatus(tree);
  const visit = (node: RuleNode): ProductReportNode[] => {
    if (node.status === "deleted") return [];
    if (node.type !== "area" && node.type !== "capability" && node.type !== "constraint") return [];
    const children = (node.children ?? []).flatMap(visit);
    const row = status[node.id];
    return [{
      id: node.id,
      ...(node.displayId ? { displayId: node.displayId } : {}),
      type: node.type,
      title: node.title,
      ...(node.type === "area" && node.summary ? { summary: node.summary } : {}),
      ...(node.type !== "area" && node.statement ? { statement: node.statement } : {}),
      ...(row ?? {}),
      ...(children.length ? { children } : {}),
    }];
  };
  return tree.product.flatMap(visit);
}

// ── get_capability ───────────────────────────────────────────────

export class ProductReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductReportError";
  }
}

/** A change related to a product node, and how. */
export interface RelatedChange {
  id: string;
  displayId?: string;
  title: string;
  status: ItemStatus;
  /** `amends` when any of the change's amendments targets the node; otherwise `touches`. */
  relation: "amends" | "touches";
  /** Still acting on the product layer: not applied, cancelled or deleted. */
  open: boolean;
  applied: boolean;
  appliedAt?: string;
  /** `shippedIn` when set, else `plannedRelease`. */
  release?: string;
}

/** Which related changes `capabilityReport` lists. `recent` is the default. */
export type ChangeFilter = "recent" | "open" | "applied" | "all";

/** Applied changes `recent` keeps besides every open one. */
export const RECENT_APPLIED = 10;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface ChangePageOptions {
  /** `recent` (default): every open change plus the {@link RECENT_APPLIED} most recently applied. */
  status?: ChangeFilter;
  /** Keep changes whose release (shippedIn, else plannedRelease) is this one or later. */
  since?: string;
  /** `changesPage.nextCursor` of the previous page. */
  cursor?: string;
  /** Page size, 1 to {@link MAX_PAGE_SIZE}; default {@link DEFAULT_PAGE_SIZE}. */
  limit?: number;
}

export interface CapabilityReport {
  /** The node as stored (intent and state), without its children. */
  node: Omit<RuleNode, "children">;
  /** Ancestors, root first. */
  parentChain: Array<{ id: string; displayId?: string; title: string; type: string }>;
  /** Live sub-capabilities and constraints directly below. */
  children: Array<{ id: string; displayId?: string; title: string; type: string }>;
  status: ProductStatus;
  /** One page of the live changes that amend or touch the node: open ones first, then newest applied. */
  changes: RelatedChange[];
  /** Counts over every related change, whatever the page shows. */
  changeCounts: ChangeCounts;
  changesPage: {
    /** Changes matching the filter, across all pages. */
    matched: number;
    /** Pass as `cursor` for the next page; absent on the last. */
    nextCursor?: string;
  };
  /** Constraints that bind the node. */
  boundBy: Array<{ id: string; displayId?: string; title: string }>;
  /** Nodes the same changes also amend or touch, most shared first. */
  coChanges: CoChange[];
}

/** The capability or constraint `ref` names (id, display id or alias; a retired one too). */
export function capabilityReport(tree: V2Tree, ref: string, page: ChangePageOptions = {}): CapabilityReport {
  const index = productIndex(tree);
  const node = index.resolve(ref);
  if (!node || (node.type !== "capability" && node.type !== "constraint")) {
    const what = node ? `is ${article(node.type)} ${node.type}, not a capability or constraint` : "names no product node";
    throw new ProductReportError(`"${ref}" ${what}. Use get_product to see the product layer.`);
  }
  const status = computeProductStatus(tree)[node.id];
  if (!status) throw new ProductReportError(`"${ref}" is deleted and no applied change retired it, so it has no status.`);

  const parentOf = new Map(index.entries.map((e) => [e.node, e.parent]));
  const parentChain: CapabilityReport["parentChain"] = [];
  for (let p = parentOf.get(node); p; p = parentOf.get(p)) parentChain.unshift({ ...brief(p), type: p.type });

  const edges = computeEdges(tree);
  const related = (edges.changedBy[node.id] ?? []).flatMap((id) => {
    const change = index.resolve(id) as ChangeNode | undefined;
    if (!change) return [];
    const amends = (change.amends ?? []).some((a) => index.resolve(a.target)?.id === node.id);
    return [{
      ...brief(change),
      status: change.status ?? "pending",
      relation: amends ? ("amends" as const) : ("touches" as const),
      applied: isAppliedChange(change),
      open: isOpenChange(change),
      ...(change.appliedAt ? { appliedAt: change.appliedAt } : {}),
      ...((change.shippedIn ?? change.plannedRelease) ? { release: (change.shippedIn ?? change.plannedRelease)! } : {}),
    }];
  });
  const changeCounts = countChanges(related.map((c) => index.resolve(c.id)!));
  const { changes, matched, nextCursor } = pageChanges(related, page);

  const { children: kids, ...stored } = node;
  return {
    node: stored,
    parentChain,
    children: (kids ?? []).filter((c) => c.status !== "deleted").map((c) => ({ ...brief(c), type: c.type })),
    status,
    changes,
    changeCounts,
    changesPage: { matched, ...(nextCursor ? { nextCursor } : {}) },
    boundBy: (edges.boundBy[node.id] ?? []).flatMap((id) => {
      const constraint = index.resolve(id);
      return constraint ? [brief(constraint)] : [];
    }),
    coChanges: edges.coChanges[node.id] ?? [],
  };
}

/** Filter, order (open first, then newest applied) and slice related changes. A cancelled or deleted change is never related, so is never listed. */
function pageChanges(related: RelatedChange[], opts: ChangePageOptions): { changes: RelatedChange[]; matched: number; nextCursor?: string } {
  const status = opts.status ?? "recent";
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
  const open = related.filter((c) => c.open);
  const applied = related.filter((c) => c.applied).sort((a, b) => (b.appliedAt ?? "").localeCompare(a.appliedAt ?? ""));

  let matching: RelatedChange[];
  switch (status) {
    case "open": matching = open; break;
    case "applied": matching = applied; break;
    case "all": matching = [...open, ...applied]; break;
    default: matching = [...open, ...applied.slice(0, RECENT_APPLIED)];
  }
  if (opts.since !== undefined) {
    const since = opts.since;
    matching = matching.filter((c) => c.release !== undefined && compareReleases(c.release, since) >= 0);
  }

  let start = 0;
  if (opts.cursor !== undefined) {
    const at = matching.findIndex((c) => c.id === opts.cursor);
    if (at < 0) throw new ProductReportError(`Cursor "${opts.cursor}" is not in this result. Restart without a cursor, keeping the same status and since.`);
    start = at + 1;
  }
  const changes = matching.slice(start, start + limit);
  const more = start + limit < matching.length;
  return { changes, matched: matching.length, ...(more ? { nextCursor: changes[changes.length - 1].id } : {}) };
}

// ── get_prd_status ───────────────────────────────────────────────

/** Change counts: by status, plus how many are open and how many applied. */
export interface ChangeCounts {
  total: number;
  /** Not applied, cancelled or deleted: still acting on the product layer. */
  open: number;
  applied: number;
  byStatus: Partial<Record<ItemStatus, number>>;
}

export interface AreaStatus {
  id: string;
  displayId?: string;
  title: string;
  capabilities: number;
  constraints: number;
  /** Capabilities and constraints per intent status. Retired nodes are not counted. */
  status: Partial<Record<IntentStatus, number>>;
  defective: number;
  /** Open changes that amend or touch a node in the area. */
  openChanges: number;
}

export interface ReleaseStatus {
  /** `shippedIn` when set, else `plannedRelease`; null for a change with neither. */
  release: string | null;
  changes: ChangeCounts;
}

export interface PrdStatusReport {
  /** Every live change, nested changes included; a change under a deleted one is not live. */
  changes: ChangeCounts;
  /** Open changes waiting for a person to confirm their targets. */
  inbox: number;
  areas: AreaStatus[];
  /** Nearest release first; unscheduled last. Default: every release with an open change, the unscheduled one, and the {@link RECENT_RELEASES} newest of the rest. */
  releases: ReleaseStatus[];
  /** Releases left out of `releases`; `changes` still counts theirs. `allReleases` lists them. */
  releasesOmitted: number;
}

/** Fully closed releases `prdStatusReport` lists besides those with open changes. */
export const RECENT_RELEASES = 5;

/** Product status per area and change counts per release. */
export function prdStatusReport(tree: V2Tree, options: { allReleases?: boolean } = {}): PrdStatusReport {
  const status = computeProductStatus(tree);
  const index = indexTree(tree);
  // Every live change, nested ones included: add_item takes a change as a change's parent.
  const changes = index.entries.filter((e) => e.root === "changes" && e.node.type === "change").map((e) => e.node);

  const areaOf = new Map<string, RuleNode>();
  for (const { node, parent } of index.entries) {
    if (node.type === "area") areaOf.set(node.id, node);
    else if (parent && areaOf.has(parent.id)) areaOf.set(node.id, areaOf.get(parent.id)!);
  }

  const openByArea = new Map<string, Set<string>>();
  for (const change of changes) {
    if (!isOpenChange(change)) continue;
    const c = change as ChangeNode;
    for (const ref of [...(c.amends ?? []).map((a) => a.target), ...(c.touches ?? [])]) {
      const area = areaOf.get(index.resolve(ref)?.id ?? "");
      if (!area) continue;
      const ids = openByArea.get(area.id) ?? new Set<string>();
      ids.add(change.id);
      openByArea.set(area.id, ids);
    }
  }

  const areas = tree.product.filter((n) => n.type === "area" && n.status !== "deleted").map((area): AreaStatus => {
    const row: AreaStatus = { ...brief(area), capabilities: 0, constraints: 0, status: {}, defective: 0, openChanges: openByArea.get(area.id)?.size ?? 0 };
    for (const { node } of index.entries) {
      if (areaOf.get(node.id) !== area || (node.type !== "capability" && node.type !== "constraint")) continue;
      const s = status[node.id];
      if (!s) continue;
      row[node.type === "capability" ? "capabilities" : "constraints"]++;
      row.status[s.status] = (row.status[s.status] ?? 0) + 1;
      if (s.health === "defective") row.defective++;
    }
    return row;
  });

  const byRelease = new Map<string | null, RuleNode[]>();
  for (const change of changes) {
    const c = change as ChangeNode;
    const release = c.shippedIn ?? c.plannedRelease ?? null;
    byRelease.set(release, [...(byRelease.get(release) ?? []), change]);
  }
  const everyRelease = [...byRelease]
    .sort(([a], [b]) => compareReleases(a ?? undefined, b ?? undefined))
    .map(([release, list]): ReleaseStatus => ({ release, changes: countChanges(list) }));
  const closed = everyRelease.filter((r) => r.release !== null && r.changes.open === 0);
  const dropped = new Set(options.allReleases ? [] : closed.slice(0, Math.max(closed.length - RECENT_RELEASES, 0)));
  const releases = everyRelease.filter((r) => !dropped.has(r));

  return {
    changes: countChanges(changes),
    inbox: changes.filter((c) => isOpenChange(c) && c.needsPlacement).length,
    areas,
    releases,
    releasesOmitted: dropped.size,
  };
}

function countChanges(changes: readonly RuleNode[]): ChangeCounts {
  const counts: ChangeCounts = { total: changes.length, open: 0, applied: 0, byStatus: {} };
  for (const c of changes) {
    const s = c.status ?? "pending";
    counts.byStatus[s] = (counts.byStatus[s] ?? 0) + 1;
    if (isOpenChange(c)) counts.open++;
    if (isAppliedChange(c)) counts.applied++;
  }
  return counts;
}

// ── Helpers ──────────────────────────────────────────────────────

function brief(node: RuleNode): { id: string; displayId?: string; title: string } {
  return { id: node.id, ...(node.displayId ? { displayId: node.displayId } : {}), title: node.title };
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}
