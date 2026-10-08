/**
 * Placement ranking: which product nodes does a new change amend or touch?
 *
 * A placement is a target (a capability or constraint id) and a relation
 * (`touches` or `amends`). Tier 1 is rules, free and deterministic, and always
 * runs: it ranks the targets and alone decides the relation. Tier 2 is the
 * configured text model (task class `prd.place`), reached through an injected
 * seam so this module reads no env, config or network. The model picks a
 * target, never a relation. It is uncalibrated: its pick is reported, and
 * counts as agreement only when it is the rules' top candidate. Deciding what
 * to do with agreement (the `autoAccept` setting) is the caller's job.
 *
 * @module core/placement
 */

import { ADDED_NODE_TYPES, AmendmentSchema, type AddedNodeType, type Amendment } from "../schema/v2.js";
import { extractKeywords } from "./keywords.js";

/** A product-layer node (capability or constraint) as the ranker sees it. */
export interface PlacementNode {
  id: string;
  /** A capability when absent. */
  type?: AddedNodeType;
  title: string;
  statement?: string;
  tags?: string[];
  /** Package names the node lives in (e.g. `rex`, `@n-dx/web`). */
  packages?: string[];
  /** Path fragments that identify the node's code (`src/core/`). */
  paths?: string[];
  /** Files and directories its past changes touched (the derived "realized by" edge). */
  realizedBy?: string[];
}

/** The change being placed. */
export interface PlacementChange {
  title: string;
  intent?: string;
  /** Files the change is known to touch. */
  files?: string[];
  /** The change repairs what it touches without amending it. */
  fix?: boolean;
  /** The tag `code-health` marks a finding-derived change. Where a change came from says nothing about its kind. */
  tags?: string[];
}

/** How a change relates to its target: works on it, or edits its requirements. */
export type PlacementRelation = "touches" | "amends";

/** A placement: the node a change attaches to and how. */
export interface PlacementTarget {
  target: string;
  relation: PlacementRelation;
}

export interface PlacementCandidate extends PlacementTarget {
  score: number;
  /** Which rules fired, for display and audit. */
  reasons: string[];
}

/** An area a proposal can be placed under. Areas are not placement targets. */
export interface PlacementArea {
  id: string;
  title: string;
  statement?: string;
}

/**
 * A new product node a placement proposes instead of an existing target: an
 * `added` amendment with a type, placed under an area. Never auto-accepted.
 */
export type PlacementProposal = Amendment & { delta: "added"; type: AddedNodeType; under: string; title: string };

/**
 * Injected text-model seam: pick one target id from the shortlist, null for
 * none, or propose a new node when nothing on the shortlist fits.
 */
export type PlacementModel = (input: {
  change: PlacementChange;
  shortlist: readonly PlacementCandidate[];
  nodes: readonly PlacementNode[];
  /** Every area a proposal's `under` may name; any other id is dropped. */
  areas: readonly PlacementArea[];
}) => Promise<string | null | { propose: PlacementProposal }>;

export interface PlacementResult {
  /** Rules ranking, best first. Empty when no rule fired. */
  shortlist: PlacementCandidate[];
  /** Present only when a model was supplied; it runs on an empty shortlist too, to propose a new node. */
  model?: {
    /** The target the model picked; null when it declined or proposed. */
    pick: string | null;
    /**
     * The pick is the rules' top candidate. False when the top score is tied:
     * the rules named no single leader, and the id tiebreak is arbitrary.
     */
    agrees: boolean;
    /** A well-formed new-node proposal from the model. */
    proposal?: PlacementProposal;
  };
  warnings: string[];
}

export const PLACEMENT_SHORTLIST_SIZE = 5;

const CODE_HEALTH_TAG = "code-health";
const ARCHITECTURE = "architecture";

// File evidence and a code-health finding on the architecture constraint
// outrank a path mention, which outranks a package mention, which outranks a
// shared word.
const WEIGHT_FILE_EVIDENCE = 4;
const WEIGHT_CODE_HEALTH = 4;
const WEIGHT_PATH_MENTION = 3;
const WEIGHT_PACKAGE_MENTION = 2;
const WEIGHT_TOKEN = 1;

/** Leading verbs of a title that ask for behaviour the product does not have yet, or a different one. */
const AMENDING_VERBS = new Set([
  "add", "introduce", "support", "allow", "enable", "implement", "expose", "offer", "provide",
  "let", "extend", "change", "replace", "switch", "require",
]);

/** An intent line that states the relation outright: `Relation: amends` or `Relation: touches`. */
const RELATION_MARKER = /^\s*relation\s*:\s*(amends|touches)\b/im;

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** `fragment` appears in `file` as whole path segments (`src/store` is in `a/src/store/x.ts`, not `a/src/store-utils.ts`). */
function containsSegments(file: string, fragment: string): boolean {
  return `/${file}/`.includes(`/${fragment}/`);
}

function mentions(text: string, needle: string): boolean {
  const escaped = needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_-])${escaped}($|[^a-z0-9_-])`).test(text.toLowerCase());
}

/** The change came from a code-health finding. */
export function isCodeHealthChange(change: PlacementChange): boolean {
  return (change.tags ?? []).includes(CODE_HEALTH_TAG);
}

function isArchitectureConstraint(node: PlacementNode): boolean {
  return node.type === "constraint" && ((node.tags ?? []).includes(ARCHITECTURE) || mentions(node.title, ARCHITECTURE));
}

/**
 * Rules decide the relation. A fix or a code-health finding always touches its
 * target. Otherwise an intent line `Relation: amends` or `Relation: touches`
 * decides outright, in either direction. Without one, a title that opens with
 * an amending verb amends; anything else touches. Prose in the intent never
 * decides it.
 */
export function placementRelation(change: PlacementChange): PlacementRelation {
  if (change.fix === true || isCodeHealthChange(change)) return "touches";
  const marked = RELATION_MARKER.exec(change.intent ?? "")?.[1]?.toLowerCase();
  if (marked === "amends" || marked === "touches") return marked;
  const lead = /^\s*([a-z]+)/i.exec(change.title)?.[1]?.toLowerCase();
  return lead !== undefined && AMENDING_VERBS.has(lead) ? "amends" : "touches";
}

function scoreNode(change: PlacementChange, node: PlacementNode, relation: PlacementRelation): PlacementCandidate {
  const text = `${change.title}\n${change.intent ?? ""}`;
  let score = 0;
  const reasons: string[] = [];

  if (isCodeHealthChange(change) && isArchitectureConstraint(node)) {
    score += WEIGHT_CODE_HEALTH;
    reasons.push("code-health finding: architecture constraint");
  }

  const files = (change.files ?? []).map(normalizePath);
  const evidence = (node.realizedBy ?? []).map(normalizePath).filter(Boolean);
  const hits = files.filter((f) => evidence.some((e) => f === e || f.startsWith(`${e}/`)));
  if (hits.length > 0) {
    score += WEIGHT_FILE_EVIDENCE * hits.length;
    reasons.push(`file evidence: ${hits.join(", ")}`);
  }

  for (const p of (node.paths ?? []).map(normalizePath).filter(Boolean)) {
    if (files.some((f) => containsSegments(f, p)) || mentions(text, p)) {
      score += WEIGHT_PATH_MENTION;
      reasons.push(`path: ${p}`);
    }
  }

  for (const pkg of (node.packages ?? []).filter(Boolean)) {
    if (mentions(text, pkg)) {
      score += WEIGHT_PACKAGE_MENTION;
      reasons.push(`package: ${pkg}`);
    }
  }

  const changeWords = new Set(extractKeywords(text));
  const shared = extractKeywords(`${node.title} ${node.statement ?? ""}`).filter((w) => changeWords.has(w));
  if (shared.length > 0) {
    score += WEIGHT_TOKEN * shared.length;
    reasons.push(`words: ${shared.join(", ")}`);
  }

  return { target: node.id, relation, score, reasons };
}

/** Rules only: rank capabilities and constraints for a change, best first, ties broken by id. */
export function rankPlacementCandidates(
  change: PlacementChange,
  nodes: readonly PlacementNode[],
  size: number = PLACEMENT_SHORTLIST_SIZE,
): PlacementCandidate[] {
  const relation = placementRelation(change);
  return nodes
    .map((node) => scoreNode(change, node, relation))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.target.localeCompare(b.target))
    .slice(0, size);
}

/**
 * The proposal when `value` is a valid amendment (shared schema) that is also an
 * added one with a type, an area and a title; otherwise why it was refused.
 */
function asProposal(value: unknown): { proposal: PlacementProposal } | { reason: string } {
  const parsed = AmendmentSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { reason: `is not a valid amendment (${issue.path.join(".") || "value"}: ${issue.message})` };
  }
  const p = parsed.data;
  const nonEmpty = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const ok =
    p.delta === "added" &&
    ADDED_NODE_TYPES.has(p.type as AddedNodeType) &&
    nonEmpty(p.target) &&
    nonEmpty(p.under) &&
    nonEmpty(p.title);
  return ok
    ? { proposal: p as PlacementProposal }
    : { reason: "is not an added amendment with type, under and title" };
}

/**
 * Rank with rules, then ask the text model when one is supplied, even on an
 * empty shortlist: with nothing to pick it may still propose a new node under
 * one of `areas`. A proposal under an unknown area is dropped. A model error
 * propagates; with no model the shortlist is returned alone.
 */
export async function placeChange(
  change: PlacementChange,
  nodes: readonly PlacementNode[],
  options: { model?: PlacementModel; shortlistSize?: number; areas?: readonly PlacementArea[] } = {},
): Promise<PlacementResult> {
  const warnings: string[] = [];
  const shortlist = rankPlacementCandidates(change, nodes, options.shortlistSize);
  if (!options.model) return { shortlist, warnings };

  const areas = options.areas ?? [];
  const answer = await options.model({ change, shortlist, nodes, areas });
  if (answer !== null && typeof answer === "object") {
    const checked = asProposal(answer.propose);
    let proposal: PlacementProposal | null = null;
    if ("reason" in checked) {
      warnings.push(`text model proposed a new node that ${checked.reason}; ignoring it`);
    } else if (!areas.some((a) => a.id === checked.proposal.under)) {
      warnings.push(`text model proposed a new node under "${checked.proposal.under}", which is not a known area; ignoring it`);
    } else {
      proposal = checked.proposal;
    }
    return { shortlist, model: { pick: null, agrees: false, ...(proposal ? { proposal } : {}) }, warnings };
  }
  const [top, runnerUp] = shortlist;
  const clearLeader = top !== undefined && (runnerUp === undefined || runnerUp.score < top.score);
  return { shortlist, model: { pick: answer, agrees: clearLeader && answer === top.target }, warnings };
}
