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
 * - {@link draftPlacement} asks an injected text model (`prd.place`) for a
 *   pick or a proposal and returns it unwritten, for a person to accept
 *   through the two above.
 *
 * An open change is placed either way. An applied change (migrated history
 * still in the Inbox) is placed with `touches` only: its amendments already
 * reached the map, so amends and proposals are refused
 * (`applied-change-amends`). A cancelled or deleted change is not placed. The
 * result is checked against the v2 rules; an error finding about the change
 * refuses the placement.
 *
 * Pure: works on a copy and leaves writing to the caller.
 *
 * @module rex/core/change-place
 */

import { randomUUID } from "node:crypto";
import type { AddedNodeType, Amendment, ChangeNode, CriteriaDelta, Criterion } from "../schema/v2.js";
import { applyAmendmentsProblems, NOTHING_TO_MODIFY, pendingWarnings } from "./apply-amendments.js";
import { checkV2Rules, indexTree, isAppliedChange, isOpenChange, nodeSpec, specHash, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import {
  asProposal,
  PLACEMENT_SHORTLIST_SIZE,
  placeChange,
  placementRelation,
  placementStrength,
  rankPlacementCandidates,
  type PlacementArea,
  type PlacementCandidate,
  type PlacementModel,
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
  | "already-proposed"
  | "rule-errors"
  | "nothing-to-modify"
  | "apply-problems"
  | "no-such-change"
  | "change-not-open"
  | "applied-change-amends"
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

/**
 * Rank the live capabilities and constraints the change `changeRef` could
 * amend or touch. An applied change only touches, so every candidate carries
 * touches for one.
 */
export function suggestPlacement(tree: V2Tree, changeRef: string, shortlistSize = PLACEMENT_SHORTLIST_SIZE): PlacementSuggestion {
  const change = placeableChange(tree, changeRef);
  const input = placementInput(change);
  const relation = defaultRelation(change);
  // Rank at least two, so a tie shows even when the caller asks for one.
  const ranked = rankPlacementCandidates(input, placementNodes(tree), Math.max(shortlistSize, 2)).map((c) => ({ ...c, relation }));
  const [top, next] = ranked;
  return {
    change: change.id,
    relation,
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

/** Record that the change `changeRef` amends or touches `input.target`; an applied change only touches. */
export function recordPlacement(tree: V2Tree, changeRef: string, input: RecordPlacementInput, now: Date): RecordPlacementResult {
  const next = structuredClone(tree);
  const index = indexTree(next);
  const change = placeableChange(next, changeRef) as ChangeNode & RuleNode;
  if (isAppliedChange(change) && (input.relation === "amends" || input.proposed !== undefined || input.criteria !== undefined)) {
    throw appliedChangeAmends(change);
  }
  const target = index.resolve(input.target);
  if (!target || (target.type !== "capability" && target.type !== "constraint")) {
    const plain = `"${input.target}" is not a live capability or constraint; a change is placed on one`;
    throw new ChangePlacementError(`${plain} (see get_product)`, "not-a-target", plain);
  }
  const relation = input.relation ?? defaultRelation(change);
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
  const change = placeableChange(next, changeRef) as ChangeNode & RuleNode;
  // An added amendment on an applied change would never be applied.
  if (isAppliedChange(change)) throw appliedChangeAmends(change);
  const label = change.displayId ?? change.id;
  const area = index.resolve(input.under);
  if (!area || area.type !== "area") {
    const plain = `"${input.under}" is not a live area; a new capability or constraint is proposed under one`;
    throw new ChangePlacementError(`${plain} (see get_product)`, "not-an-area", plain);
  }
  const title = input.title.trim();
  if (!title) throw new ChangePlacementError("A proposed capability or constraint needs a title", "empty-title");

  // Each proposal mints a fresh target id, so apply cannot see a repeat: refuse it here.
  const wanted = title.toLowerCase();
  const existing = (change.amends ?? []).find(
    (a) => a.delta === "added" && a.type === input.type && a.under !== undefined && index.resolve(a.under) === area && a.title?.trim().toLowerCase() === wanted,
  );
  if (existing) {
    throw new ChangePlacementError(
      `Change ${label} already proposes ${input.type} "${existing.title}" under "${area.title}"`,
      "already-proposed",
    );
  }

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

/**
 * A new node the text model drafted, in the shape {@link recordProposal} takes.
 * It has no `target`: the model's slug is not a node id, and accepting the draft
 * through `recordProposal` mints one.
 */
export type DraftedProposal = RecordProposalInput;

export interface PlacementDraft {
  /** Id of the change drafted for. */
  change: string;
  /** The rules' relation for this change; every candidate carries it. */
  relation: PlacementRelation;
  /** The top two candidates share a score (see {@link PlacementSuggestion}). */
  tied: boolean;
  /** Rules ranking, best first. Empty when no rule fired. */
  shortlist: SuggestedPlacementCandidate[];
  /** The shortlist target the model picked. */
  pick?: string;
  /** A new node the model proposed under a live area. */
  proposal?: DraftedProposal;
  warnings: string[];
}

/**
 * Ask the text model where the open change `changeRef` belongs, over the
 * tree's live capabilities, constraints and areas. Writes nothing: a person
 * accepts the draft through {@link recordPlacement} or {@link recordProposal}.
 * A pick off the shortlist, a malformed proposal and one under an unknown area
 * are dropped with a warning. A model error propagates. Without a model the
 * draft is the rules shortlist alone.
 */
export async function draftPlacement(tree: V2Tree, changeRef: string, model?: PlacementModel): Promise<PlacementDraft> {
  const change = placeableChange(tree, changeRef);
  // A pick could only touch, and a proposal is refused outright: drafting is for open changes.
  if (isAppliedChange(change)) throw appliedChangeAmends(change);
  const input = placementInput(change);
  const result = await placeChange(input, placementNodes(tree), { model, areas: placementAreas(tree) });
  const warnings = [...result.warnings];
  const { shortlist } = result;
  const [top, next] = shortlist;

  let pick: string | undefined;
  const picked = result.model?.pick;
  if (picked != null) {
    if (shortlist.some((c) => c.target === picked)) pick = picked;
    else warnings.push(`text model picked "${picked}", which is not on the shortlist; ignoring it`);
  }

  return {
    change: change.id,
    relation: placementRelation(input),
    tied: top !== undefined && next !== undefined && top.score === next.score,
    shortlist: shortlist.map((c) => ({ ...c, strength: placementStrength(c.score) })),
    ...(pick !== undefined ? { pick } : {}),
    ...(result.model?.proposal ? { proposal: draftedProposal(result.model.proposal, warnings) } : {}),
    warnings,
  };
}

/** The fields of a model proposal a person may accept; the model's target is dropped. */
function draftedProposal(proposal: PlacementProposal, warnings: string[]): DraftedProposal {
  const { added, rest } = splitCriteria(proposal.criteria);
  if (rest.length) warnings.push(`text model proposed criteria ${rest.join(", ")} for a new node; only add applies, ignoring the rest`);
  const keepCriteria = added.length > 0 && proposal.type !== "constraint";
  if (added.length && !keepCriteria) warnings.push("text model proposed criteria for a constraint; only a capability has them, dropping them");
  return {
    type: proposal.type,
    under: proposal.under,
    title: proposal.title,
    ...(proposal.summary !== undefined ? { summary: proposal.summary } : {}),
    ...(proposal.proposed !== undefined ? { proposed: proposal.proposed } : {}),
    ...(keepCriteria ? { criteria: { add: added } } : {}),
  };
}

function splitCriteria(criteria: CriteriaDelta | undefined): { added: Criterion[]; rest: string[] } {
  if (!criteria) return { added: [], rest: [] };
  const { add, ...others } = criteria;
  return { added: add ?? [], rest: Object.keys(others) };
}

/** Every live area, as the placement model sees it. */
function placementAreas(tree: V2Tree): PlacementArea[] {
  return indexTree(tree).entries.flatMap(({ node, root }): PlacementArea[] =>
    root === "product" && node.type === "area"
      ? [{ id: node.id, title: node.title, ...(typeof node.statement === "string" ? { statement: node.statement } : {}) }]
      : [],
  );
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

/** The open or applied change `ref` names, or a refusal naming why it cannot be placed. */
function placeableChange(tree: V2Tree, ref: string): RuleNode {
  const node = indexTree(tree).resolve(ref);
  if (!node || node.type !== "change") throw new ChangePlacementError(`No live change "${ref}"`, "no-such-change");
  // A change cancelled after it was applied stays refused: abandoned, whatever appliedAt says.
  const abandoned = node.status === "cancelled" || node.status === "deleted";
  if (abandoned || (!isOpenChange(node) && !isAppliedChange(node))) {
    throw new ChangePlacementError(`Change ${node.displayId ?? node.id} is ${node.status}; only an open or applied change is placed`, "change-not-open");
  }
  return node;
}

/** Refusal for an amendment or a proposal on an applied change. */
function appliedChangeAmends(change: RuleNode): ChangePlacementError {
  return new ChangePlacementError(
    `Change ${change.displayId ?? change.id} is applied; its amendments already reached the map. Place it with touches.`,
    "applied-change-amends",
  );
}

/** The rules' relation for an open change; touches for an applied one. */
function defaultRelation(change: RuleNode): PlacementRelation {
  return isAppliedChange(change) ? "touches" : placementRelation(placementInput(change));
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
