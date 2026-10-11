/**
 * The requirements half: rex's PRD model as nodes and edges.
 *
 * One reader for both layouts. On a v1 tree rex reads epics and features as
 * changes with no product layer; unless told not to, this slice draws the
 * product layer rex's migration plan proposes for it instead (`./proposed.ts`:
 * areas, capabilities and constraints, the work placed on them), marking every
 * product node `proposed`, so an un-migrated checkout projects the map it
 * would get. Release nodes themselves are the builder's: it adds the releases
 * git says finished changes landed in before it counts what each holds.
 */
import {
  loadPrdModel,
  indexTree,
  computeEdges,
  computeProductStatus,
  deriveChangeKind,
  type PrdModel,
  type RuleNode,
  type ChangeNode,
  type ProductEdges,
  type V2Tree,
} from "../rex-gateway.js";
import { NODE_KINDS } from "../document.js";
import { proposeProductLayer } from "./proposed.js";
import type { SnapshotEdge, SnapshotNode, SourceSlice, Warn } from "../types.js";

export interface RequirementsSlice extends SourceSlice {
  model: PrdModel;
  /** The tree projected: rex's, or on a v1 layout the one its migration plan proposes. */
  tree: V2Tree;
  productEdges: ProductEdges;
  /** Every id the slice emitted a node for. */
  ids: Set<string>;
  /** Where the product layer came from. */
  productLayer: "stored" | "proposed" | "none";
}

export interface RequirementsOptions {
  /** On a v1 tree, draw the product layer rex's migration plan proposes. Default true. */
  proposeProductLayer?: boolean;
}

export const RELEASE_PREFIX = "release:";

export function releaseId(version: string): string {
  return `${RELEASE_PREFIX}${version}`;
}

export async function readRequirements(rexDir: string, warn: Warn, options: RequirementsOptions = {}): Promise<RequirementsSlice> {
  const model = await loadPrdModel(rexDir, { warn });
  const proposed = options.proposeProductLayer === false ? undefined : proposeProductLayer(model);
  const tree = proposed?.tree ?? model.tree;
  const index = indexTree(tree);
  const productEdges = computeEdges(tree);
  const status = computeProductStatus(tree);
  const nodes: SnapshotNode[] = [];
  const edges: SnapshotEdge[] = [];
  const ids = new Set<string>();

  const base = (node: RuleNode): Record<string, unknown> => ({
    title: node.title,
    slug: node.slug,
    displayId: node.displayId,
    status: node.status ?? "pending",
    tags: node.tags && node.tags.length > 0 ? [...node.tags] : undefined,
  });

  const walkProduct = (list: readonly RuleNode[], parent?: RuleNode): void => {
    for (const node of list) {
      if (node.status === "deleted") continue;
      const kind = NODE_KINDS[node.type];
      const standing = status[node.id];
      const fields: Record<string, unknown> = {
        ...base(node),
        intentStatus: standing?.status,
        health: standing?.health,
        proposed: proposed ? true : undefined,
      };
      if (node.type === "area") {
        fields.summary = node.summary;
        fields.stewards = node.stewards && node.stewards.length > 0 ? [...node.stewards] : undefined;
      } else if (node.type === "capability") {
        fields.statement = node.statement;
        fields.criteriaCount = node.criteria?.length ?? 0;
        fields.reviewed = node.reviewedHash !== undefined;
        for (const dep of node.dependsOn ?? []) edges.push({ kind: "dependsOn", from: node.id, to: dep });
      } else if (node.type === "constraint") {
        fields.statement = node.statement;
        fields.appliesToAll = node.appliesTo === "all";
        if (Array.isArray(node.appliesTo)) for (const target of node.appliesTo) edges.push({ kind: "appliesTo", from: node.id, to: target });
      }
      nodes.push({ id: node.id, kind, ...fields });
      ids.add(node.id);
      if (parent) edges.push({ kind: "under", from: node.id, to: parent.id });
      walkProduct(node.children ?? [], node);
    }
  };

  const walkChanges = (list: readonly RuleNode[], parent?: RuleNode): void => {
    for (const node of list) {
      if (node.status === "deleted") continue;
      const kind = NODE_KINDS[node.type];
      const fields: Record<string, unknown> = {
        ...base(node),
        assignee: node.assignee,
        startedAt: node.startedAt,
        completedAt: node.completedAt,
        // The version a two-way sync agrees on: rex stamps it on every write.
        lastModified: typeof node.lastModified === "string" ? node.lastModified : undefined,
        lastModifiedBy: typeof node.lastModifiedBy === "string" ? node.lastModifiedBy : undefined,
      };
      if (node.type === "change") {
        const change = node as RuleNode & ChangeNode;
        fields.intent = change.intent;
        fields.priority = change.priority;
        fields.changeKind = deriveChangeKind(change, index);
        fields.level = typeof node.level === "string" && (node.level === "epic" || node.level === "feature") ? node.level : "change";
        fields.fix = change.fix === true;
        fields.spike = change.spike === true;
        fields.inbox = change.needsPlacement === true;
        fields.plannedRelease = change.plannedRelease;
        fields.shippedIn = typeof change.shippedIn === "string" ? change.shippedIn : undefined;
        for (const a of change.amends ?? []) edges.push({ kind: "amends", from: node.id, to: a.target });
        for (const t of change.touches ?? []) edges.push({ kind: "touches", from: node.id, to: t });
        if (change.discoveredFrom?.item) edges.push({ kind: "discoveredFrom", from: node.id, to: change.discoveredFrom.item });
        if (change.discoveredFrom?.run) edges.push({ kind: "discoveredFrom", from: node.id, to: change.discoveredFrom.run });
        if (change.plannedRelease) edges.push({ kind: "plannedFor", from: node.id, to: releaseId(change.plannedRelease) });
        if (typeof change.shippedIn === "string") edges.push({ kind: "shippedWith", from: node.id, to: releaseId(change.shippedIn) });
      } else {
        fields.description = typeof node.description === "string" ? node.description : undefined;
        fields.priority = node.priority;
        fields.level = node.type === "subtask" ? "subtask" : "task";
      }
      for (const blocker of node.blockedBy ?? []) edges.push({ kind: "blockedBy", from: node.id, to: blocker });
      nodes.push({ id: node.id, kind, ...fields });
      ids.add(node.id);
      if (parent) edges.push({ kind: "under", from: node.id, to: parent.id });
      walkChanges(node.children ?? [], node);
    }
  };

  walkProduct(tree.product);
  walkChanges(tree.changes);

  const productLayer = tree.product.length === 0 ? "none" : proposed ? "proposed" : "stored";
  return { model, tree, productEdges, ids, nodes, edges, productLayer };
}
