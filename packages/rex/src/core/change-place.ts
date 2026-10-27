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
 *   spec moves first, carrying the caller's `proposed` text and `criteria`
 *   delta (apply needs one of them to modify the target, so an amends
 *   placement with neither is refused). The change is
 *   dry-run through apply (`applyAmendmentsProblems`), and a problem the new
 *   amendment brings refuses the placement in apply's words, since nothing
 *   edits the amendment afterwards. Either clears `needsPlacement`, which moves
 *   the change out of the reserved `changes/inbox/` folder on the next write,
 *   keeping its id and its slug (`store/prd-model-writer.ts`).
 * - {@link recordProposal} records a new node when nothing on the map fits: an
 *   `added` capability or constraint under a live area, with a freshly minted
 *   id as its `target`. It is a proposal only; the node reaches the product
 *   layer when the change is applied. It clears `needsPlacement` too, and is
 *   dry-run through apply the same way.
 *
 * Only an open change is placed. The result is checked against the v2 rules;
 * an error finding about the change refuses the placement.
 *
 * Pure: works on a copy and leaves writing to the caller.
 *
 * @module rex/core/change-place
 */

import { randomUUID } from "node:crypto";
import type { AddedNodeType, Amendment, ChangeNode, CriteriaDelta, Criterion } from "../schema/v2.js";
import { applyAmendmentsProblems, NOTHING_TO_MODIFY, pendingWarnings } from "./apply-amendments.js";
import { checkV2Rules, indexTree, isOpenChange, nodeSpec, specHash, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import {
  asProposal,
  PLACEMENT_SHORTLIST_SIZE,
  placementRelation,
  placementStrength,
  rankPlacementCandidates,
  type PlacementCandidate,
  type PlacementStrength,
  type PlacementChange,
  type PlacementNode,
  type PlacementProposal,
  type PlacementRelation,
  type PlacementTarget,
} from "./placement.js";

/** Why a placement was refused. Each surface words its own hint by kind; the message is the MCP wording. */
export type ChangePlacementErrorKind =
  | "not-a-target"
  | "content-needs-amends"
  | "already-amends"
  | "rule-errors"
  | "nothing-to-modify"
  | "apply-problems"
  | "no-such-change"
  | "change-not-open"
  | "not-an-area"
  | "empty-title"
  | "invalid-proposal";

export class ChangePlacementError extends Error {
  /**
   * @param message MCP-facing text (may name MCP tools or parameters).
   * @param kind Which refusal this is.
   * @param plain The message without MCP-only wording; defaults to `message`.
   */
  constructor(
    message: string,
    readonly kind: ChangePlacementErrorKind,
    readonly plain: string = message,
  ) {
    super(message);
    this.name = "ChangePlacementError";
  }
}

/** Refusal for `proposed` or `criteria` on a placement that is not an amendment. */
export const PLACEMENT_CONTENT_NEEDS_AMENDS = "proposed and criteria describe an amendment: pass them with target and relation amends";

/** Suffix of the MCP-facing refusal for an amends placement with nothing to modify. */
const NOTHING_TO_MODIFY_PLACE_HINT = ". Pass proposed or criteria, or use relation touches";

/** A ranked candidate with its score's band (`placementStrength`). */
export interface SuggestedPlacementCandidate extends PlacementCandidate {
  strength: PlacementStrength;
}

export interface PlacementSuggestion {
  /** Id of the change placed. */
  change: string;
  /** The rules' relation for this change; every candidate carries it. */
  relation: PlacementRelation;
  /**
   * The top two candidates share a score: their order is the id tiebreak, not
   * the rules, so the first is no better a pick than the second.
   */
  tied: boolean;
  /** Rules ranking, best first. Empty when no rule fired. */
  shortlist: SuggestedPlacementCandidate[];
}

/** Rank the live capabilities and constraints the open change `changeRef` could amend or touch. */
export function suggestPlacement(tree: V2Tree, changeRef: string, shortlistSize = PLACEMENT_SHORTLIST_SIZE): PlacementSuggestion {
  const change = openChange(tree, changeRef);
  const input = placementInput(change);
  // Rank at least two, so a tie shows even when the caller asks for one.
  const ranked = rankPlacementCandidates(input, placementNodes(tree), Math.max(shortlistSize, 2));
  const [top, next] = ranked;
  return {
    change: change.id,
    relation: placementRelation(input),
    tied: top !== undefined && next !== undefined && top.score === next.score,
    shortlist: ranked.slice(0, shortlistSize).map((c) => ({ ...c, strength: placementStrength(c.score) })),
  };
}

export interface RecordPlacementInput {
  /** Id, display id or alias of a live capability or constraint. */
  target: string;
  /** Default: the rules' relation for the change. */
  relation?: PlacementRelation;
  /** An amendment's summary. Default: the change's title. */
  summary?: string;
  /** An amendment's replacement statement. Relation amends only. */
  proposed?: string;
  /** An amendment's criteria delta. Relation amends only. */
  criteria?: CriteriaDelta;
}

export interface RecordPlacementResult {
  /** The new tree; the input is not modified. */
  tree: V2Tree;
  change: string;
  placement: PlacementTarget;
  /** Problems only other open changes cause: apply refuses until they close, and the placement is stored anyway. */
  warnings: string[];
  /** The problems behind `warnings`, unworded, for a caller that words them itself. Empty when `warnings` is. */
  pending: string[];
  /** The open changes (display id or id) in the way of `pending`; empty when `pending` is. */
  blockedBy: string[];
}

/** Record that the open change `changeRef` amends or touches `input.target`. */
export function recordPlacement(tree: V2Tree, changeRef: string, input: RecordPlacementInput, now: Date): RecordPlacementResult {
  const next = structuredClone(tree);
  const index = indexTree(next);
  const change = openChange(next, changeRef) as ChangeNode & RuleNode;
  const target = index.resolve(input.target);
  if (!target || (target.type !== "capability" && target.type !== "constraint")) {
    const plain = `"${input.target}" is not a live capability or constraint; a change is placed on one`;
    throw new ChangePlacementError(`${plain} (see get_product)`, "not-a-target", plain);
  }
  const relation = input.relation ?? placementRelation(placementInput(change));
  if (relation !== "amends" && (input.proposed !== undefined || input.criteria !== undefined)) {
    throw new ChangePlacementError(PLACEMENT_CONTENT_NEEDS_AMENDS, "content-needs-amends");
  }
  const label = change.displayId ?? change.id;
  const amends = (change.amends ?? []).some((a) => index.resolve(a.target) === target);
  const touches = (change.touches ?? []).some((ref) => index.resolve(ref) === target);

  // An amendment is the stronger relation; edit the amendment rather than downgrading it here.
  if (amends) throw new ChangePlacementError(`Change ${label} already amends "${target.title}"`, "already-amends");
  if (relation === "touches") {
    if (!touches) change.touches = [...(change.touches ?? []), target.id];
  } else {
    // Amending a node supersedes touching it.
    const rest = (change.touches ?? []).filter((ref) => index.resolve(ref) !== target);
    if (rest.length) change.touches = rest;
    else delete change.touches;
    const amendment: Amendment = {
      target: target.id,
      delta: "modified",
      summary: input.summary ?? change.title,
      ...(input.proposed !== undefined ? { proposed: input.proposed } : {}),
      ...(input.criteria !== undefined ? { criteria: input.criteria } : {}),
      base: specHash(nodeSpec(target)),
    };
    change.amends = [...(change.amends ?? []), amendment];
  }
  delete change.needsPlacement;

  refuseRuleErrors(next, change, now);
  if (relation === "touches") {
    return { tree: next, change: change.id, placement: { target: target.id, relation }, warnings: [], pending: [], blockedBy: [] };
  }
  // The pending branch is defensive here: place writes only `modified` amendments, pending comes only from
  // removals, and pending that existed before this placement is filtered out. So it is empty today; the
  // code goes live if place ever writes a removal. Pinned by the "recordPlacement pending and blockedBy"
  // tests in tests/unit/core/change-place.test.ts (modify on a capability another change removes: no
  // problems; modify under a pending removal: refused).
  const { problems, pending, blockedBy } = novelApplyProblems(tree, next, change.id, now);
  if (problems.length) {
    const plain = `Cannot place change ${label}: ${problems.join("; ")}`;
    if (problems.some((p) => p.endsWith(NOTHING_TO_MODIFY))) {
      throw new ChangePlacementError(`${plain}${NOTHING_TO_MODIFY_PLACE_HINT}`, "nothing-to-modify", plain);
    }
    throw new ChangePlacementError(plain, "apply-problems");
  }
  return { tree: next, change: change.id, placement: { target: target.id, relation }, warnings: pendingWarnings(pending, blockedBy), pending, blockedBy };
}

export interface RecordProposalInput {
  /** The kind of node proposed. */
  type: AddedNodeType;
  /** Id, display id or alias of the live area the new node goes under. */
  under: string;
  /** The new node's title. */
  title: string;
  /** The amendment's summary. Default: the change's title. */
  summary?: string;
  /** The new node's statement. */
  proposed?: string;
  /** The new node's capability criteria. A constraint has none; apply refuses them on one. */
  criteria?: { add: Criterion[] };
}

export interface RecordProposalOptions {
  /** Id for the proposed node. Default `randomUUID`, as for every node rex creates. */
  newId?: () => string;
}

export interface RecordProposalResult {
  /** The new tree; the input is not modified. */
  tree: V2Tree;
  change: string;
  /** The `added` amendment appended to the change; `under` is the area's id, `target` the new node's. */
  proposal: PlacementProposal;
  /** Problems only other open changes cause: apply refuses until they close, and the proposal is stored anyway. */
  warnings: string[];
  /** The problems behind `warnings`, unworded. Empty when `warnings` is. */
  pending: string[];
  /** The open changes (display id or id) in the way of `pending`; empty when `pending` is. */
  blockedBy: string[];
}

/**
 * Record that the open change `changeRef` adds a new capability or constraint
 * under a live area. Never auto-accepted: the node reaches the product layer
 * only when the change is applied.
 */
export function recordProposal(
  tree: V2Tree,
  changeRef: string,
  input: RecordProposalInput,
  now: Date,
  options: RecordProposalOptions = {},
): RecordProposalResult {
  const next = structuredClone(tree);
  const index = indexTree(next);
  const change = openChange(next, changeRef) as ChangeNode & RuleNode;
  const label = change.displayId ?? change.id;
  const area = index.resolve(input.under);
  if (!area || area.type !== "area") {
    const plain = `"${input.under}" is not a live area; a new capability or constraint is proposed under one`;
    throw new ChangePlacementError(`${plain} (see get_product)`, "not-an-area", plain);
  }
  const title = input.title.trim();
  if (!title) throw new ChangePlacementError("A proposed capability or constraint needs a title", "empty-title");

  const checked = asProposal({
    target: (options.newId ?? randomUUID)(),
    delta: "added",
    type: input.type,
    under: area.id,
    title,
    summary: input.summary ?? change.title,
    ...(input.proposed !== undefined ? { proposed: input.proposed } : {}),
    ...(input.criteria !== undefined ? { criteria: input.criteria } : {}),
  });
  if ("reason" in checked) throw new ChangePlacementError(`The proposal ${checked.reason}`, "invalid-proposal");
  const { proposal } = checked;
  change.amends = [...(change.amends ?? []), proposal];
  delete change.needsPlacement;

  refuseRuleErrors(next, change, now);
  const { problems, pending, blockedBy } = novelApplyProblems(tree, next, change.id, now);
  if (problems.length) throw new ChangePlacementError(`Cannot propose for change ${label}: ${problems.join("; ")}`, "apply-problems");
  return { tree: next, change: change.id, proposal, warnings: pendingWarnings(pending, blockedBy), pending, blockedBy };
}

/** Refuse when the v2 rules find an error on `change` in `tree`. */
function refuseRuleErrors(tree: V2Tree, change: RuleNode, now: Date): void {
  const errors = checkV2Rules(tree, { now }).filter((f) => f.nodeId === change.id && f.severity === "error");
  if (errors.length) {
    throw new ChangePlacementError(`Cannot place change ${change.displayId ?? change.id}: ${errors.map((f) => f.message).join("; ")}`, "rule-errors");
  }
}

/**
 * What apply would refuse `changeId` with in `after` that it did not in
 * `before`: only what the new amendment brings, since the change's earlier
 * amendments were judged when they were stored.
 */
function novelApplyProblems(before: V2Tree, after: V2Tree, changeId: string, now: Date): { problems: string[]; pending: string[]; blockedBy: string[] } {
  const was = applyAmendmentsProblems(before, changeId, now);
  const is = applyAmendmentsProblems(after, changeId, now);
  const novel = (all: readonly string[], known: readonly string[]): string[] => all.filter((p) => !known.includes(p));
  const pending = novel(is.pending, was.pending);
  return { problems: novel(is.always, was.always), pending, blockedBy: pending.length ? [...is.blockedBy] : [] };
}

/** The open change `ref` names, or a refusal naming why it cannot be placed. */
function openChange(tree: V2Tree, ref: string): RuleNode {
  const node = indexTree(tree).resolve(ref);
  if (!node || node.type !== "change") throw new ChangePlacementError(`No live change "${ref}"`, "no-such-change");
  if (!isOpenChange(node)) {
    const state = node.appliedAt ? `applied at ${node.appliedAt}` : node.status;
    throw new ChangePlacementError(`Change ${node.displayId ?? node.id} is ${state}; only an open change is placed`, "change-not-open");
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
