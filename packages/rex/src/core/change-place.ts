/**
 * Place a v2 change on the product layer: rank where it belongs, or record
 * the placement a caller chose.
 *
 * - {@link suggestPlacement} runs the placement rules (`core/placement.ts`)
 *   over the tree's live capabilities and constraints. Rules only: the text
 *   model and Jev are seams a caller with a model supplies to
 *   `decidePlacement`; the caller of this module (an assistant) is the model.
 * - {@link recordPlacement} writes the choice: a `touches` target joins the
 *   change's `touches`; an `amends` target becomes a `modified` amendment with
 *   `base` set to the target's current spec hash, so apply refuses it if the
 *   spec moves first. Either clears `needsPlacement`.
 *
 * Only an open change is placed. The result is checked against the v2 rules;
 * an error finding about the change refuses the placement.
 *
 * Pure: works on a copy and leaves writing to the caller.
 *
 * @module rex/core/change-place
 */

import type { ChangeNode } from "../schema/v2.js";
import { checkV2Rules, indexTree, isOpenChange, nodeSpec, specHash, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import {
  placementRelation,
  rankPlacementCandidates,
  type PlacementCandidate,
  type PlacementChange,
  type PlacementNode,
  type PlacementRelation,
  type PlacementTarget,
} from "./placement.js";

export class ChangePlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangePlacementError";
  }
}

export interface PlacementSuggestion {
  /** Id of the change placed. */
  change: string;
  /** The rules' relation for this change; every candidate carries it. */
  relation: PlacementRelation;
  /** Rules ranking, best first. Empty when no rule fired. */
  shortlist: PlacementCandidate[];
}

/** Rank the live capabilities and constraints the open change `changeRef` could amend or touch. */
export function suggestPlacement(tree: V2Tree, changeRef: string, shortlistSize?: number): PlacementSuggestion {
  const change = openChange(tree, changeRef);
  const input = placementInput(change);
  return {
    change: change.id,
    relation: placementRelation(input),
    shortlist: rankPlacementCandidates(input, placementNodes(tree), shortlistSize),
  };
}

export interface RecordPlacementInput {
  /** Id, display id or alias of a live capability or constraint. */
  target: string;
  /** Default: the rules' relation for the change. */
  relation?: PlacementRelation;
  /** An amendment's summary. Default: the change's title. */
  summary?: string;
}

export interface RecordPlacementResult {
  /** The new tree; the input is not modified. */
  tree: V2Tree;
  change: string;
  placement: PlacementTarget;
}

/** Record that the open change `changeRef` amends or touches `input.target`. */
export function recordPlacement(tree: V2Tree, changeRef: string, input: RecordPlacementInput, now: Date): RecordPlacementResult {
  const next = structuredClone(tree);
  const index = indexTree(next);
  const change = openChange(next, changeRef) as ChangeNode & RuleNode;
  const target = index.resolve(input.target);
  if (!target || (target.type !== "capability" && target.type !== "constraint")) {
    throw new ChangePlacementError(`"${input.target}" is not a live capability or constraint; a change is placed on one (see get_product)`);
  }
  const relation = input.relation ?? placementRelation(placementInput(change));
  const label = change.displayId ?? change.id;
  const amends = (change.amends ?? []).some((a) => index.resolve(a.target) === target);
  const touches = (change.touches ?? []).some((ref) => index.resolve(ref) === target);

  // An amendment is the stronger relation; edit it with edit_item rather than downgrading it here.
  if (amends) throw new ChangePlacementError(`Change ${label} already amends "${target.title}"`);
  if (relation === "touches") {
    if (!touches) change.touches = [...(change.touches ?? []), target.id];
  } else {
    // Amending a node supersedes touching it.
    const rest = (change.touches ?? []).filter((ref) => index.resolve(ref) !== target);
    if (rest.length) change.touches = rest;
    else delete change.touches;
    change.amends = [
      ...(change.amends ?? []),
      { target: target.id, delta: "modified", summary: input.summary ?? change.title, base: specHash(nodeSpec(target)) },
    ];
  }
  delete change.needsPlacement;

  const errors = checkV2Rules(next, { now }).filter((f) => f.nodeId === change.id && f.severity === "error");
  if (errors.length) throw new ChangePlacementError(`Cannot place change ${label}: ${errors.map((f) => f.message).join("; ")}`);
  return { tree: next, change: change.id, placement: { target: target.id, relation } };
}

/** The open change `ref` names, or a refusal naming why it cannot be placed. */
function openChange(tree: V2Tree, ref: string): RuleNode {
  const node = indexTree(tree).resolve(ref);
  if (!node || node.type !== "change") throw new ChangePlacementError(`No live change "${ref}"`);
  if (!isOpenChange(node)) {
    const state = node.appliedAt ? `applied at ${node.appliedAt}` : node.status;
    throw new ChangePlacementError(`Change ${node.displayId ?? node.id} is ${state}; only an open change is placed`);
  }
  return node;
}

function placementInput(node: RuleNode): PlacementChange {
  const change = node as ChangeNode;
  return {
    title: change.title,
    ...(change.intent ? { intent: change.intent } : {}),
    ...(change.fix === true ? { fix: true } : {}),
    ...(change.tags?.length ? { tags: change.tags } : {}),
  };
}

/** Every live capability and constraint, as the ranker sees it. */
function placementNodes(tree: V2Tree): PlacementNode[] {
  return indexTree(tree).entries.flatMap(({ node, root }): PlacementNode[] => {
    if (root !== "product" || (node.type !== "capability" && node.type !== "constraint")) return [];
    return [{
      id: node.id,
      ...(node.type === "constraint" ? { type: "constraint" as const } : {}),
      title: node.title,
      ...(typeof node.statement === "string" ? { statement: node.statement } : {}),
      ...(node.tags?.length ? { tags: node.tags } : {}),
    }];
  });
}
