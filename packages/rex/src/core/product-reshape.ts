/**
 * Reshape on the product layer of a v2 tree: proposals become one drafted
 * change carrying amendments, and no product file moves.
 *
 * The product layer is the standing spec, edited only by applying a change,
 * so `rex reshape` drafts the change rather than restructuring files:
 *
 * | Proposal | Amendments                                                        |
 * |----------|-------------------------------------------------------------------|
 * | obsolete | `removed` for the node and each live descendant                   |
 * | reparent | `removed` for the node, `added` (a copy) under the new parent     |
 * | merge    | `removed` for each merged node; `modified` for the survivor when its statement or capability criteria change |
 * | split    | `removed` for the node, `added` for each piece under its parent   |
 * | update   | `modified` with the new statement, or the new capability criteria |
 *
 * A proposal no amendment can express (a group, a title-only update, moving
 * an area or a node with children) is skipped with the reason. Modified and
 * removed amendments carry `base`, the target's spec hash now, so applying
 * the change after someone else edited the node is refused rather than a
 * silent revert. The change is added through `addChangeNode`, which dry-runs
 * apply: a draft apply would refuse is refused here.
 *
 * Pure: works on a copy and leaves writing to the caller.
 *
 * @module rex/core/product-reshape
 */

import { randomUUID } from "node:crypto";
import type { Amendment, CriteriaDelta, Criterion } from "../schema/v2.js";
import type { RuleNode, V2Tree } from "../schema/v2-rules.js";
import type { ReshapeProposal } from "./reshape.js";
import { nodeSpecHash, resolve, upsertCriteriaDelta } from "./apply-amendments.js";
import { addChangeNode } from "./change-add.js";

export const PRODUCT_RESHAPE_TITLE = "Reshape the product layer";

export interface SkippedProposal {
  proposalId: string;
  reason: string;
}

export interface ProductReshapeDraft {
  amends: Amendment[];
  /** Ids of the proposals the amendments express. */
  drafted: string[];
  skipped: SkippedProposal[];
}

export interface ProductReshapeOptions {
  /** Id for each node an `added` amendment creates. Default `randomUUID`. */
  newId?: () => string;
}

/** The amendments `proposals` describe on `product`, and the proposals none can express. */
export function draftProductReshape(
  product: readonly RuleNode[],
  proposals: readonly ReshapeProposal[],
  options: ProductReshapeOptions = {},
): ProductReshapeDraft {
  const newId = options.newId ?? randomUUID;
  const draft: ProductReshapeDraft = { amends: [], drafted: [], skipped: [] };
  const claimed = new Set<string>();
  for (const proposal of proposals) {
    const outcome = amendmentsFor(product, proposal, newId);
    if (typeof outcome === "string") {
      draft.skipped.push({ proposalId: proposal.id, reason: outcome });
      continue;
    }
    const clash = outcome.find((a) => a.delta !== "added" && claimed.has(a.target));
    if (clash) {
      draft.skipped.push({ proposalId: proposal.id, reason: `an earlier proposal already amends ${label(product, clash.target)}` });
      continue;
    }
    outcome.filter((a) => a.delta !== "added").forEach((a) => claimed.add(a.target));
    draft.amends.push(...outcome);
    draft.drafted.push(proposal.id);
  }
  return draft;
}

export interface ProductReshapeChange {
  tree: V2Tree;
  change: RuleNode;
}

/** Add the drafted amendments to `tree` as one open change; `reasons` become its intent. */
export function addProductReshapeChange(
  tree: V2Tree,
  draft: ProductReshapeDraft,
  reasons: readonly string[],
  now: Date,
): ProductReshapeChange {
  const description = ["Drafted by rex reshape from proposals on the product layer.", "", ...reasons.map((r) => `- ${r}`)].join("\n");
  const { tree: next, node } = addChangeNode(
    tree,
    { type: "change", title: PRODUCT_RESHAPE_TITLE, description, amends: draft.amends, source: "reshape" },
    { now },
  );
  return { tree: next, change: node };
}

type Outcome = Amendment[] | string;

function amendmentsFor(product: readonly RuleNode[], proposal: ReshapeProposal, newId: () => string): Outcome {
  const action = proposal.action;
  const find = (id: string) => resolve(product, id);
  const missing = (id: string) => `${id} is not a live product node`;
  switch (action.action) {
    case "obsolete": {
      const node = find(action.itemId);
      if (!node) return missing(action.itemId);
      return [node, ...liveDescendants(node)].map((n) => removed(n, action.reason));
    }
    case "reparent": {
      const node = find(action.itemId);
      if (!node) return missing(action.itemId);
      if (action.newParentId === undefined) return "a product node always has a parent; name the area or capability to move it under";
      const parent = find(action.newParentId);
      if (!parent) return missing(action.newParentId);
      const unmovable = cannotCopy(node);
      if (unmovable) return unmovable;
      if (node.type === "capability" && parent.type !== "area" && parent.type !== "capability") {
        return `a capability goes under an area or capability, not the ${parent.type} ${label(product, parent.id)}`;
      }
      return [removed(node, action.reason), added(node, parent, action.reason, newId)];
    }
    case "merge": {
      const survivor = find(action.survivorId);
      if (!survivor) return missing(action.survivorId);
      const merged = action.mergedIds.map((id) => find(id));
      const absent = action.mergedIds.find((_, i) => !merged[i]);
      if (absent) return missing(absent);
      const nodes = merged as RuleNode[];
      const nested = nodes.find((n) => liveDescendants(n).length > 0);
      if (nested) return `${label(product, nested.id)} has children; move them before merging it`;
      const carried = survivor.type === "capability" ? nodes.flatMap((n) => criteriaOf(n)) : [];
      const add = renumber(carried, criteriaOf(survivor));
      const modified: Amendment[] =
        add.length || action.description
          ? [
              {
                target: survivor.id,
                delta: "modified",
                summary: action.reason,
                ...(action.description ? { proposed: action.description } : {}),
                ...(add.length ? { criteria: { add } } : {}),
                base: nodeSpecHash(survivor),
              },
            ]
          : [];
      return [...nodes.map((n) => removed(n, action.reason)), ...modified];
    }
    case "split": {
      const node = find(action.sourceId);
      if (!node) return missing(action.sourceId);
      const unmovable = cannotCopy(node);
      if (unmovable) return unmovable;
      const parent = parentOf(product, node.id);
      if (!parent) return `${label(product, node.id)} has no parent to place its pieces under`;
      const pieces = action.children.map((child) =>
        added(
          { ...node, title: child.title, statement: child.description, criteria: (child.acceptanceCriteria ?? []).map((text, i) => ({ id: `c${i + 1}`, text })) } as RuleNode,
          parent,
          action.reason,
          newId,
        ),
      );
      return [removed(node, action.reason), ...pieces];
    }
    case "update": {
      const node = find(action.itemId);
      if (!node) return missing(action.itemId);
      const { description, acceptanceCriteria } = action.updates;
      if (acceptanceCriteria && node.type !== "capability") return `${label(product, node.id)} is not a capability; only a capability has capability criteria`;
      let criteria: CriteriaDelta | undefined;
      if (acceptanceCriteria) {
        // The new list, as c1..cn: ids the capability has are replaced, the rest added, and its others removed.
        const current = criteriaOf(node);
        const set = acceptanceCriteria.map((text, i) => ({ id: `c${i + 1}`, text }));
        criteria = upsertCriteriaDelta(current, set, current.map((c) => c.id).filter((id) => !set.some((c) => c.id === id)));
      }
      if (description === undefined && !criteria) {
        return "a title or priority edit is not an amendment; use rex product edit";
      }
      return [
        {
          target: node.id,
          delta: "modified",
          summary: action.reason,
          ...(description !== undefined ? { proposed: description } : {}),
          ...(criteria ? { criteria } : {}),
          base: nodeSpecHash(node),
        },
      ];
    }
    case "group":
      return "grouping is not an amendment; draft a change that adds the area or capability instead";
  }
}

function removed(node: RuleNode, summary: string): Amendment {
  return { target: node.id, delta: "removed", summary, base: nodeSpecHash(node) };
}

/** An `added` amendment recreating `node` (a capability or constraint) under `parent`. */
function added(node: RuleNode, parent: RuleNode, summary: string, newId: () => string): Amendment {
  const n = node as RuleNode & { statement?: string; requirements?: unknown[]; appliesTo?: unknown };
  const criteria = criteriaOf(node);
  return {
    target: newId(),
    delta: "added",
    summary,
    type: node.type === "constraint" ? "constraint" : "capability",
    under: parent.id,
    title: node.title,
    ...(n.statement !== undefined ? { proposed: n.statement } : {}),
    ...(node.type === "capability" && criteria.length ? { criteria: { add: criteria.map((c) => ({ ...c })) } } : {}),
    ...(node.type === "constraint" && n.requirements?.length ? { requirements: n.requirements } : {}),
    ...(node.type === "constraint" && n.appliesTo !== undefined ? { appliesTo: n.appliesTo } : {}),
  };
}

/** Why `node` cannot be recreated by an `added` amendment, or undefined. */
function cannotCopy(node: RuleNode): string | undefined {
  if (node.type !== "capability" && node.type !== "constraint") return `an ${node.type} cannot be moved by an amendment; only a capability or constraint can`;
  if (liveDescendants(node).length) return `${node.displayId ?? node.id} has children; move them first`;
  return undefined;
}

function criteriaOf(node: RuleNode): Criterion[] {
  return node.type === "capability" ? ((node as RuleNode & { criteria?: Criterion[] }).criteria ?? []) : [];
}

/** `criteria` with ids `c<n>` that none of `taken` uses. */
function renumber(criteria: readonly Criterion[], taken: readonly Criterion[]): Criterion[] {
  const used = new Set(taken.map((c) => c.id));
  let n = 0;
  return criteria.map((c) => {
    let id: string;
    do id = `c${++n}`;
    while (used.has(id));
    used.add(id);
    return { id, text: c.text };
  });
}

function liveDescendants(node: RuleNode): RuleNode[] {
  return (node.children ?? []).flatMap((child) => (child.status === "deleted" ? [] : [child, ...liveDescendants(child)]));
}

function parentOf(nodes: readonly RuleNode[], id: string, parent?: RuleNode): RuleNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return parent;
    const hit = parentOf(node.children ?? [], id, node);
    if (hit) return hit;
  }
  return undefined;
}

function label(product: readonly RuleNode[], id: string): string {
  const node = resolve(product, id, { includeDeleted: true });
  return node?.displayId ?? id;
}
