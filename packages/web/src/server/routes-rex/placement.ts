/**
 * Inbox placement on a v2 project: read a change's shortlist, place it, or
 * propose a new home for it.
 *
 *   GET  /api/rex/changes/:id/placement → { layout: "v2", change, relation, tied, shortlist }
 *   GET  /api/rex/changes/placements    → { layout: "v2", placements: { [id]: placement | { error } } }
 *                                         every open change awaiting placement, from one model load
 *   POST /api/rex/changes/:id/place     → { change, target, relation, warnings? }
 *   POST /api/rex/changes/:id/propose   → { change, proposed: { target, under, title, type }, warnings? }
 *   POST /api/rex/changes/:id/unplace   → { change, target }
 *                                         takes back one touches ("Place & add another"'s Remove)
 *   POST /api/rex/changes/:id/placement/draft
 *                                       → { layout: "v2", change, relation, tied, shortlist, pick?, proposal?, model?, warnings }
 *                                         the `prd.place` model's draft; writes nothing. Spends tokens, so it
 *                                         answers 403 unless `rex.placementDraft` is on, read per call.
 *   POST /api/rex/changes/:id/placement/check
 *                                       → { layout: "v2", change, check }
 *                                         rex's dry run of `{ target, relation?, … }` or `{ propose: { type, under, title, … } }`
 *                                         on the loaded tree: what it would record, or the refusal kind. Writes nothing.
 *
 * Rex decides everything (`suggestPlacements`, `recordPlacement`,
 * `recordProposal`, `recordUnplacement`); this module enriches the shortlist with what the viewer
 * shows and writes through rex's v2 transaction, as `place_change` does.
 * {@link writePlacement} is the one write: the two POST routes and an
 * approved Sidecar placement card (`sidecar/carry-out.ts`) all go through it.
 *
 * A v1 tree answers 409, an unknown change 404, and any other rex refusal 422
 * `{ error, kind }`. The wire types mirror `viewer/views/product-model.ts`;
 * `tests/unit/server/routes-rex-product.test.ts` fails to compile if they drift.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../types.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { jsonResponse, errorResponse, readBody, errorMessage } from "../response-utils.js";
import { refreshPRDCache } from "../prd-io.js";
import { appendLog, sidecarDecisionFields, type SidecarDecision } from "./rex-route-helpers.js";
import { isFeatureEnabled } from "../routes-features.js";
import { featureDisabledBody } from "../route-feature-gates.js";
import {
  draftChangePlacement,
  prdLayout,
  loadPrdModel,
  indexTree,
  isInboxChange,
  isAppliedChange,
  resolveStore,
  suggestPlacements,
  recordPlacement,
  recordProposal,
  recordUnplacement,
  ChangePlacementError,
  placementStrength,
  withPrdModelTransaction,
} from "../rex-gateway.js";
import type { RuleNode, TreeIndex, V2Tree, RecordPlacementInput, RecordProposalInput } from "../rex-gateway.js";

/** One change's rex suggestion, read off `suggestPlacements` so the gateway carries no extra type for it. */
type PlacementSuggestion = Extract<
  ReturnType<typeof suggestPlacements> extends Map<string, infer R> ? R : never,
  { suggestion: unknown }
>["suggestion"];
import type { SidecarPlacementCheck, SidecarPlacementRequest } from "../../shared/index.js";

// ── Wire types (mirror viewer/views/product-model.ts) ────────────────

export type PlacementRelationWire = "touches" | "amends";
export type PlacementStrengthWire = "strong" | "possible" | "weak";

export interface PlacementCandidateWire {
  target: string;
  type: "capability" | "constraint";
  title: string;
  area: string;
  statement?: string;
  criteria: Array<{ id: string; text: string }>;
  score: number;
  strength: PlacementStrengthWire;
  reasons: string[];
  /** Other open changes that already amend this candidate; apply refuses an amends placement here once one of them applies. */
  amendedBy?: string[];
}

export interface ChangePlacementWire {
  layout: "v2";
  change: {
    id: string;
    title: string;
    intent?: string;
    status: string;
    taskCount: number;
    tags?: string[];
    /** When the change was first recorded (`createdAt`, else `lastModified` for a change older than that field); absent when neither is set. */
    createdAt?: string;
    /** Whole days from `createdAt` to the read, as `rex change inbox` reports it. */
    ageDays?: number;
  };
  relation: PlacementRelationWire;
  /** The rule that set `relation`, in rex's words. */
  relationRule: string;
  tied: boolean;
  shortlist: PlacementCandidateWire[];
}

export interface PlacementCriteriaDeltaWire {
  add?: Array<{ id: string; text: string }>;
  replace?: Array<{ id: string; text: string }>;
  remove?: string[];
}

export interface PlaceChangeRequestWire {
  target: string;
  relation?: PlacementRelationWire;
  summary?: string;
  proposed?: string;
  criteria?: PlacementCriteriaDeltaWire;
}

export interface PlaceChangeResultWire {
  change: string;
  target: string;
  relation: PlacementRelationWire;
  warnings?: string[];
}

export interface ProposeChangeRequestWire {
  type: "capability" | "constraint";
  under: string;
  title: string;
  summary?: string;
  proposed?: string;
  criteria?: { add: Array<{ id: string; text: string }> };
}

export interface ProposeChangeResultWire {
  change: string;
  proposed: { target: string; under: string; title: string; type: "capability" | "constraint" };
  warnings?: string[];
}

/** `POST /api/rex/changes/:id/placement/check`: rex's dry run of a placement, which writes nothing. */
export interface PlacementCheckWire {
  layout: "v2";
  change: string;
  check: SidecarPlacementCheck;
}

/** `POST /api/rex/changes/:id/placement/draft`: the model's draft, which fills the form and writes nothing. */
export interface PlacementDraftWire {
  layout: "v2";
  change: string;
  relation: PlacementRelationWire;
  tied: boolean;
  shortlist: PlacementCandidateWire[];
  /** The shortlist target the model picked. */
  pick?: string;
  /** A new node the model drafted; the body `/propose` takes. */
  proposal?: ProposeChangeRequestWire;
  /** The model asked; absent when `rex.placement.models` turns the text model off. */
  model?: string;
  warnings: string[];
}

// ── Shortlist ────────────────────────────────────────────────────────

/** The title of the area a node sits under, or "" when it sits under none or is unknown. */
function areaTitles(index: ReturnType<typeof indexTree>): (id: string) => string {
  const parentOf = new Map<string, RuleNode | undefined>(index.entries.map((e) => [e.node.id, e.parent]));
  return (id) => {
    for (let p = parentOf.get(id); p; p = parentOf.get(p.id)) {
      if (p.type === "area") return p.title;
    }
    return "";
  };
}

/** Rex's shortlist rows, each with the target's title, area, statement and criteria. */
function enrichShortlist(
  index: ReturnType<typeof indexTree>,
  areaOf: (id: string) => string,
  candidates: ReadonlyArray<{ target: string; score: number; strength: PlacementStrengthWire; reasons: string[]; amendedBy?: string[] }>,
): PlacementCandidateWire[] {
  return candidates.flatMap((candidate): PlacementCandidateWire[] => {
    const node = index.resolve(candidate.target);
    if (!node || (node.type !== "capability" && node.type !== "constraint")) return [];
    const criteria = node.type === "capability" ? node.criteria ?? [] : [];
    return [{
      target: node.id,
      type: node.type,
      title: node.title,
      area: areaOf(node.id),
      ...(typeof node.statement === "string" ? { statement: node.statement } : {}),
      criteria: criteria.map((c) => ({ id: c.id, text: c.text })),
      score: candidate.score,
      strength: candidate.strength,
      reasons: candidate.reasons,
      ...(candidate.amendedBy?.length ? { amendedBy: candidate.amendedBy } : {}),
    }];
  });
}

/** The shortlist for `changeRef`, with each candidate's title, area, statement and criteria. */
export function buildChangePlacement(tree: V2Tree, changeRef: string): ChangePlacementWire {
  const result = suggestPlacements(tree, [changeRef]).get(changeRef)!;
  if ("error" in result) throw result.error;
  const index = indexTree(tree);
  return placementWire(index, areaTitles(index), result.suggestion);
}

/** The wire shape of rex's `suggestion`, with each candidate's title, area, statement and criteria. Age is rex's. */
function placementWire(index: TreeIndex, areaOf: (id: string) => string, suggestion: PlacementSuggestion): ChangePlacementWire {
  const change = index.resolve(suggestion.change)!;
  const tasks = (change.children ?? []).filter((c) => c.type === "task" && c.status !== "deleted");
  const shortlist = enrichShortlist(index, areaOf, suggestion.shortlist);

  return {
    layout: "v2",
    change: {
      id: change.id,
      title: change.title,
      ...(change.type === "change" && change.intent ? { intent: change.intent } : {}),
      // Rex reads an absent status as pending (`isOpenChange`).
      status: change.status ?? "pending",
      taskCount: tasks.length,
      ...(change.tags?.length ? { tags: change.tags } : {}),
      ...(suggestion.createdAt !== undefined ? { createdAt: suggestion.createdAt, ageDays: suggestion.ageDays } : {}),
    },
    relation: suggestion.relation,
    relationRule: suggestion.relationRule,
    tied: suggestion.tied,
    shortlist,
  };
}

// ── Quick Add preview ────────────────────────────────────────────────

/** A Quick Add preview candidate: rex's row, with the strength, reasons and area a choice needs. */
export interface PreviewPlacementCandidateWire {
  target: string;
  /** Absent when the target could not be read from the project's tree. */
  type?: "capability" | "constraint";
  relation?: PlacementRelationWire;
  title?: string;
  displayId?: string;
  score: number;
  strength: PlacementStrengthWire;
  reasons: string[];
  /** The area the target sits under; "" when none or the tree could not be read. */
  area: string;
}

/** A preview change's placement, with `tied` as the detail panel's shortlist carries it. */
export interface PreviewPlacementWire {
  relation: PlacementRelationWire;
  /** The top two candidates score the same, so the rules name no single leader. */
  tied: boolean;
  shortlist: PreviewPlacementCandidateWire[];
}

/**
 * Complete the placement `rex add` previewed for one change. Rex's rows carry
 * score and reasons, and strength when rex is current; strength comes from
 * rex's own band when it is absent, the area from `tree` (the project's tree:
 * the shortlisted targets exist there even though the change does not yet).
 * With `only`, rows whose target is not in it are dropped first (an area's
 * targets), so the tie is read from what the person is offered.
 * Anything that is not a placement passes through untouched.
 */
export function completePreviewPlacement(placement: unknown, tree: V2Tree | null, only?: ReadonlySet<string>): unknown {
  const p = placement as { relation?: unknown; shortlist?: unknown } | null;
  if (!p || typeof p !== "object" || !Array.isArray(p.shortlist)) return placement;
  const index = tree ? indexTree(tree) : null;
  const areaOf = index ? areaTitles(index) : () => "";
  const rows = (p.shortlist as Array<Record<string, unknown>>)
    .filter((c) => !only || (typeof c.target === "string" && only.has(index?.resolve(c.target)?.id ?? c.target)));
  const shortlist = rows.map((c): PreviewPlacementCandidateWire => {
    const score = typeof c.score === "number" ? c.score : 0;
    const type = typeof c.target === "string" ? index?.resolve(c.target)?.type : undefined;
    return {
      ...(c as unknown as PreviewPlacementCandidateWire),
      ...(type === "capability" || type === "constraint" ? { type } : {}),
      score,
      strength: (c.strength as PlacementStrengthWire | undefined) ?? placementStrength(score),
      reasons: Array.isArray(c.reasons) ? (c.reasons as string[]) : [],
      area: typeof c.target === "string" ? areaOf(c.target) : "",
    };
  });
  return {
    ...p,
    tied: shortlist.length > 1 && shortlist[0].score === shortlist[1].score,
    shortlist,
  };
}

/** `GET /api/rex/changes/placements`: every open change awaiting placement and every applied change never placed, keyed by change id. */
export interface ChangePlacementsWire {
  layout: "v2";
  /** A change whose shortlist could not be built carries `{ error }` instead. */
  placements: Record<string, ChangePlacementWire | { error: string }>;
}

/** The shortlist of every open change awaiting placement and every applied change never placed, keyed by change id. */
export function buildAwaitingPlacements(tree: V2Tree): ChangePlacementsWire["placements"] {
  const index = indexTree(tree);
  const waiting = index.entries.flatMap(({ node }) =>
    node.type === "change" && (isInboxChange(node) || (isAppliedChange(node) && !!node.needsPlacement)) ? [node.id] : [],
  );
  // One batch: rex builds its placement inputs once, not once per change.
  const areaOf = areaTitles(index);
  const out: ChangePlacementsWire["placements"] = {};
  for (const [id, result] of suggestPlacements(tree, waiting)) {
    out[id] = "error" in result ? { error: errorMessage(result.error) } : placementWire(index, areaOf, result.suggestion);
  }
  return out;
}

// ── Body parsing ─────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function parseJson(raw: string): Json | string {
  try {
    const body = JSON.parse(raw || "{}") as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Json) : "Request body must be a JSON object.";
  } catch {
    return "Request body must be JSON.";
  }
}

const isCriterion = (c: unknown): boolean =>
  !!c && typeof c === "object" && typeof (c as Json).id === "string" && typeof (c as Json).text === "string";
const isCriterionList = (v: unknown): boolean => Array.isArray(v) && v.every(isCriterion);

/** A string field when present, or a refusal naming it. */
function optionalStrings(body: Json, keys: string[]): string | undefined {
  const bad = keys.find((k) => body[k] !== undefined && typeof body[k] !== "string");
  return bad ? `${bad} must be a string` : undefined;
}

function parsePlaceBody(body: Json): PlaceChangeRequestWire | string {
  if (typeof body.target !== "string" || !body.target) return "Missing required field: target";
  if (body.relation !== undefined && body.relation !== "touches" && body.relation !== "amends") {
    return "relation must be touches or amends";
  }
  const bad = optionalStrings(body, ["summary", "proposed"]);
  if (bad) return bad;
  const criteria = body.criteria as Json | undefined;
  if (criteria !== undefined) {
    const ok = !!criteria && typeof criteria === "object"
      && (criteria.add === undefined || isCriterionList(criteria.add))
      && (criteria.replace === undefined || isCriterionList(criteria.replace))
      && (criteria.remove === undefined || (Array.isArray(criteria.remove) && criteria.remove.every((r) => typeof r === "string")));
    if (!ok) return "criteria must be { add?: [{id, text}], replace?: [{id, text}], remove?: [id] }";
  }
  return body as unknown as PlaceChangeRequestWire;
}

function parseProposeBody(body: Json): ProposeChangeRequestWire | string {
  if (body.type !== "capability" && body.type !== "constraint") return "type must be capability or constraint";
  if (typeof body.under !== "string" || !body.under) return "Missing required field: under";
  if (typeof body.title !== "string") return "Missing required field: title";
  const bad = optionalStrings(body, ["summary", "proposed"]);
  if (bad) return bad;
  const criteria = body.criteria as Json | undefined;
  if (criteria !== undefined && !(criteria && typeof criteria === "object" && isCriterionList(criteria.add))) {
    return "criteria must be { add: [{id, text}] }";
  }
  return body as unknown as ProposeChangeRequestWire;
}

/** Only these fields of a body reach rex, so an extra key (an agent's `reasons`) never does. */
const PLACE_FIELDS = ["target", "relation", "summary", "proposed", "criteria"] as const;
const PROPOSE_FIELDS = ["type", "under", "title", "summary", "proposed", "criteria"] as const;

function pick<K extends string>(body: Json, keys: readonly K[]): Partial<Record<K, unknown>> {
  return Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])) as Partial<Record<K, unknown>>;
}

/**
 * A placement as one body: `{ target, relation?, summary?, proposed?, criteria? }`
 * places the change on an existing node, `{ propose: { type, under, title, … } }`
 * proposes a new one. The Sidecar card and `POST …/placement/check` take it.
 */
export function parsePlacementRequest(body: Json): SidecarPlacementRequest | string {
  if (body.propose !== undefined) {
    if (body.target !== undefined) return "Give either target or propose, not both";
    const propose = body.propose;
    if (!propose || typeof propose !== "object" || Array.isArray(propose)) return "propose must be { type, under, title }";
    const parsed = parseProposeBody(pick(propose as Json, PROPOSE_FIELDS));
    return typeof parsed === "string" ? parsed : { action: "propose", ...parsed };
  }
  const parsed = parsePlaceBody(pick(body, PLACE_FIELDS));
  return typeof parsed === "string" ? `${parsed} (or propose a new node with propose)` : { action: "place", ...parsed };
}

// ── Dry run and write ────────────────────────────────────────────────

/** Rex's answer to a placement: the new tree, and what the card and the routes report. */
interface RecordedPlacement {
  tree: V2Tree;
  change: string;
  check: Extract<SidecarPlacementCheck, { ok: true }>;
  /** A proposal's freshly minted node id; a dry run's is thrown away with its tree. */
  proposedTarget?: string;
}

/** What a written placement reports. */
export interface WrittenPlacement {
  change: string;
  check: Extract<SidecarPlacementCheck, { ok: true }>;
  /** The id a written proposal's new node will have once the change is applied. */
  proposedTarget?: string;
}

/** Record `request` on `tree` through rex's own rule; pure, and throws rex's refusal. */
function recordRequest(tree: V2Tree, changeRef: string, request: SidecarPlacementRequest, now: Date): RecordedPlacement {
  if (request.action === "place") {
    const { action: _action, criteria, ...rest } = request;
    const input: RecordPlacementInput = { ...rest, ...(criteria !== undefined ? { criteria: { ...criteria } } : {}) };
    const placed = recordPlacement(tree, changeRef, input, now);
    const index = indexTree(placed.tree);
    const target = index.resolve(placed.placement.target)!;
    const change = index.resolve(placed.change);
    const amendment = change?.type === "change" ? (change.amends ?? []).find((a) => a.target === target.id) : undefined;
    return {
      tree: placed.tree,
      change: placed.change,
      check: {
        ok: true,
        action: "place",
        target: target.id,
        title: target.title,
        relation: placed.placement.relation,
        ...(placed.placement.relation === "amends" && amendment?.base !== undefined ? { base: amendment.base } : {}),
        warnings: placed.warnings,
      },
    };
  }
  const { action: _action, ...input } = request;
  const recorded = recordProposal(tree, changeRef, input as RecordProposalInput, now);
  const { proposal } = recorded;
  return {
    tree: recorded.tree,
    change: recorded.change,
    check: { ok: true, action: "propose", type: proposal.type, under: proposal.under, title: proposal.title, warnings: recorded.warnings },
    proposedTarget: proposal.target,
  };
}

/**
 * Rex's dry run of `request` on `tree`: what it would record, or its refusal
 * kind and message. Writes nothing; any error other than rex's refusal throws.
 */
export function checkPlacement(tree: V2Tree, changeRef: string, request: SidecarPlacementRequest, now: Date = new Date()): SidecarPlacementCheck {
  try {
    return recordRequest(tree, changeRef, request, now).check;
  } catch (err) {
    if (err instanceof ChangePlacementError) return { ok: false, kind: err.kind, error: err.plain };
    throw err;
  }
}

/** The PRD as loaded, dry-run for `request`; a v1 tree throws {@link V1_REFUSAL}. */
export async function checkPlacementOnDisk(rexDir: string, changeRef: string, request: SidecarPlacementRequest): Promise<SidecarPlacementCheck> {
  if ((await prdLayout(rexDir)) !== "v2") throw new Error(V1_REFUSAL);
  const { tree } = await loadPrdModel(rexDir);
  return checkPlacement(tree, changeRef, request);
}

/** Who wrote a placement, as the log entry names it. */
export type PlacementVia = "web" | "Sidecar";

/** A write refused because the PRD moved since the dry run it was approved on; nothing was written. */
export class PlacementMovedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlacementMovedError";
  }
}

/**
 * Why `now` is not the placement `then` described (same node, same relation,
 * same spec hash), or undefined when it is. An approval read the earlier one.
 */
export function movedSince(then: Extract<SidecarPlacementCheck, { ok: true }>, now: Extract<SidecarPlacementCheck, { ok: true }>): string | undefined {
  if (then.action === "place" && now.action === "place") {
    if (now.target !== then.target) return `"${then.title}" (${then.target}) is no longer the node the placement names; it now resolves to ${now.target}`;
    if (now.relation !== then.relation) return `the relation is now ${now.relation}, not ${then.relation}`;
    if (now.base !== then.base) return `the spec of "${then.title}" changed since the card was raised, so its amendment was drafted against a statement and criteria that are no longer there`;
    return undefined;
  }
  if (then.action === "propose" && now.action === "propose") {
    return now.under === then.under ? undefined : `the area the proposal goes under now resolves to ${now.under}, not ${then.under}`;
  }
  return "the placement is no longer the one that was reviewed";
}

/**
 * Write `request` through rex's rule under the PRD model transaction, then
 * refresh the PRD cache, log and announce it. The routes `POST …/place` and
 * `…/propose` and an approved Sidecar placement card all write through here.
 * Throws rex's {@link ChangePlacementError} on a refusal, writing nothing.
 *
 * `expect` is the dry run an approval was given on: when the write would
 * record anything else (another node, relation, area or spec hash), it throws
 * {@link PlacementMovedError} inside the transaction and writes nothing.
 *
 * `decision` is set only for a placement a Sidecar card carries out: the log
 * entry then also names who decided it, who approved it and the agent's reasons.
 */
export async function writePlacement(
  ctx: ServerContext,
  changeRef: string,
  request: SidecarPlacementRequest,
  via: PlacementVia,
  broadcast?: WebSocketBroadcaster,
  expect?: Extract<SidecarPlacementCheck, { ok: true }>,
  decision?: SidecarDecision,
): Promise<WrittenPlacement> {
  if ((await prdLayout(ctx.rexDir)) !== "v2") throw new Error(V1_REFUSAL);
  const now = new Date();
  const { result } = await withPrdModelTransaction(ctx.rexDir, (model) => {
    const recorded = recordRequest(model.tree, changeRef, request, now);
    const moved = expect ? movedSince(expect, recorded.check) : undefined;
    if (moved) throw new PlacementMovedError(moved);
    return { tree: recorded.tree, result: recorded };
  }, { now: () => now });
  const { change, check, proposedTarget } = result;
  const entry = check.action === "place"
    ? { event: "change_placed", detail: `${check.relation} ${check.target} (via ${via})` }
    : { event: "change_proposed", detail: `${check.type} under ${check.under}: ${check.title} (via ${via})` };
  const decided = decision ? await sidecarDecisionFields(ctx.rexDir, change, decision, now) : {};
  await publish(ctx, { timestamp: now.toISOString(), itemId: change, ...entry, ...decided }, broadcast);
  return { change, check, ...(proposedTarget !== undefined ? { proposedTarget } : {}) };
}

// ── Responses ────────────────────────────────────────────────────────

const V1_REFUSAL = "This project's PRD uses the v1 layout, which has no product layer to place changes on. Migrate it first.";

/** Rex's refusal: an unknown change is 404, any other placement refusal 422; a held lock 409 naming its PID. */
function refuse(res: ServerResponse, err: unknown): void {
  if (err instanceof ChangePlacementError) {
    if (err.kind === "no-such-change") errorResponse(res, 404, err.plain);
    else jsonResponse(res, 422, { error: err.plain, kind: err.kind });
    return;
  }
  const message = errorMessage(err);
  errorResponse(res, message.includes("Could not acquire PRD lock") ? 409 : 500, message);
}

/** After a write: refresh the PRD cache, log, and tell connected clients. */
async function publish(ctx: ServerContext, entry: { timestamp: string; event: string; itemId: string; detail: string; [field: string]: unknown }, broadcast?: WebSocketBroadcaster): Promise<void> {
  refreshPRDCache(ctx.rexDir, await (await resolveStore(ctx.rexDir)).loadDocument());
  appendLog(ctx, entry);
  broadcast?.({ type: "rex:prd-changed", timestamp: entry.timestamp });
}

async function handlePlacementRead(changeRef: string, res: ServerResponse, ctx: ServerContext): Promise<boolean> {
  if ((await prdLayout(ctx.rexDir)) !== "v2") {
    errorResponse(res, 409, V1_REFUSAL);
    return true;
  }
  try {
    const { tree } = await loadPrdModel(ctx.rexDir);
    jsonResponse(res, 200, buildChangePlacement(tree, changeRef));
  } catch (err) {
    refuse(res, err);
  }
  return true;
}

async function handlePlacementsRead(res: ServerResponse, ctx: ServerContext): Promise<boolean> {
  if ((await prdLayout(ctx.rexDir)) !== "v2") {
    errorResponse(res, 409, V1_REFUSAL);
    return true;
  }
  try {
    const { tree } = await loadPrdModel(ctx.rexDir);
    const body: ChangePlacementsWire = { layout: "v2", placements: buildAwaitingPlacements(tree) };
    jsonResponse(res, 200, body);
  } catch (err) {
    refuse(res, err);
  }
  return true;
}

async function handlePlacementWrite(
  action: "place" | "propose",
  changeRef: string,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const json = parseJson(await readBody(req, res));
  const parsed = typeof json === "string" ? json : action === "place" ? parsePlaceBody(json) : parseProposeBody(json);
  if (typeof parsed === "string") {
    errorResponse(res, 400, parsed);
    return true;
  }
  if ((await prdLayout(ctx.rexDir)) !== "v2") {
    errorResponse(res, 409, V1_REFUSAL);
    return true;
  }

  try {
    const request: SidecarPlacementRequest = action === "place"
      ? { action, ...pick(parsed as unknown as Json, PLACE_FIELDS) } as SidecarPlacementRequest
      : { action, ...pick(parsed as unknown as Json, PROPOSE_FIELDS) } as SidecarPlacementRequest;
    const { change, check, proposedTarget } = await writePlacement(ctx, changeRef, request, "web", broadcast);
    const warnings = check.warnings.length ? { warnings: check.warnings } : {};
    if (check.action === "place") {
      const answer: PlaceChangeResultWire = { change, target: check.target, relation: check.relation, ...warnings };
      jsonResponse(res, 200, answer);
    } else {
      const answer: ProposeChangeResultWire = {
        change,
        proposed: { target: proposedTarget!, under: check.under, title: check.title, type: check.type },
        ...warnings,
      };
      jsonResponse(res, 200, answer);
    }
  } catch (err) {
    refuse(res, err);
  }
  return true;
}

/** `POST /api/rex/changes/:id/placement/check`: rex's dry run of an edited placement; writes nothing. */
async function handlePlacementCheck(changeRef: string, req: IncomingMessage, res: ServerResponse, ctx: ServerContext): Promise<boolean> {
  const json = parseJson(await readBody(req, res));
  const request = typeof json === "string" ? json : parsePlacementRequest(json);
  if (typeof request === "string") {
    errorResponse(res, 400, request);
    return true;
  }
  if ((await prdLayout(ctx.rexDir)) !== "v2") {
    errorResponse(res, 409, V1_REFUSAL);
    return true;
  }
  try {
    const { tree } = await loadPrdModel(ctx.rexDir);
    const check = checkPlacement(tree, changeRef, request);
    // An unknown change is the route's 404, as on every placement route; any other refusal is the answer.
    if (!check.ok && check.kind === "no-such-change") {
      errorResponse(res, 404, check.error);
      return true;
    }
    const body: PlacementCheckWire = { layout: "v2", change: changeRef, check };
    jsonResponse(res, 200, body);
  } catch (err) {
    refuse(res, err);
  }
  return true;
}

/**
 * `POST /api/rex/changes/:id/unplace` `{ target }`: take back one touches a
 * "Place & add another" session added. Only a touches goes: an amendment is
 * edited, not removed here. A change left with no home returns to the Inbox.
 * Rex's `recordUnplacement` decides: it refuses a cancelled change
 * (`change-not-open`), a target the change does not touch (`not-touched`) and
 * a result its rules reject, as it does for a placement.
 */
async function handleUnplace(changeRef: string, req: IncomingMessage, res: ServerResponse, ctx: ServerContext, broadcast?: WebSocketBroadcaster): Promise<boolean> {
  const json = parseJson(await readBody(req, res));
  const target = typeof json === "string" ? undefined : json.target;
  if (typeof json === "string" || typeof target !== "string" || !target.trim()) {
    errorResponse(res, 400, typeof json === "string" ? json : "target must be a capability or constraint id");
    return true;
  }
  if ((await prdLayout(ctx.rexDir)) !== "v2") {
    errorResponse(res, 409, V1_REFUSAL);
    return true;
  }
  try {
    const now = new Date();
    const { result } = await withPrdModelTransaction(ctx.rexDir, (model) => {
      const { tree, change, target: removed } = recordUnplacement(model.tree, changeRef, target, now);
      return { tree, result: { change, target: removed } };
    }, { now: () => now });
    await publish(ctx, { timestamp: now.toISOString(), itemId: result.change, event: "change_unplaced", detail: `touches ${result.target} (via web)` }, broadcast);
    jsonResponse(res, 200, result);
  } catch (err) {
    refuse(res, err);
  }
  return true;
}

/** The toggle "Draft with the model" sits behind, here and in the detail panel. */
export const PLACEMENT_DRAFT_FEATURE = "rex.placementDraft";

async function handlePlacementDraft(changeRef: string, res: ServerResponse, ctx: ServerContext): Promise<boolean> {
  // Read per call and fail closed: each draft spends tokens.
  if (!isFeatureEnabled(ctx.projectDir, PLACEMENT_DRAFT_FEATURE)) {
    jsonResponse(res, 403, featureDisabledBody(PLACEMENT_DRAFT_FEATURE, `/api/rex/changes/${encodeURIComponent(changeRef)}/placement/draft`));
    return true;
  }
  if ((await prdLayout(ctx.rexDir)) !== "v2") {
    errorResponse(res, 409, V1_REFUSAL);
    return true;
  }
  try {
    const { tree } = await loadPrdModel(ctx.rexDir);
    const draft = await draftChangePlacement(tree, changeRef, { rexDir: ctx.rexDir, projectDir: ctx.projectDir });
    const index = indexTree(tree);
    const body: PlacementDraftWire = {
      layout: "v2",
      change: draft.change,
      relation: draft.relation,
      tied: draft.tied,
      shortlist: enrichShortlist(index, areaTitles(index), draft.shortlist),
      ...(draft.pick !== undefined ? { pick: draft.pick } : {}),
      ...(draft.proposal ? { proposal: draft.proposal } : {}),
      ...(draft.model ? { model: draft.model } : {}),
      warnings: draft.warnings,
    };
    jsonResponse(res, 200, body);
  } catch (err) {
    refuse(res, err);
  }
  return true;
}

// ── Router ───────────────────────────────────────────────────────────

const PLACEMENT_PATH = /^changes\/([^/]+)\/(placement|place|propose|unplace|placement\/draft|placement\/check)$/;

/** Handle the placement routes. Returns false when the path is not one of them. */
export function routePlacement(
  path: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  if (path === "changes/placements") return method === "GET" ? handlePlacementsRead(res, ctx) : false;
  const match = PLACEMENT_PATH.exec(path);
  if (!match) return false;
  const changeRef = decodeURIComponent(match[1]);
  const action = match[2];
  if (action === "placement") return method === "GET" ? handlePlacementRead(changeRef, res, ctx) : false;
  if (method !== "POST") return false;
  if (action === "placement/draft") return handlePlacementDraft(changeRef, res, ctx);
  if (action === "placement/check") return handlePlacementCheck(changeRef, req, res, ctx);
  if (action === "unplace") return handleUnplace(changeRef, req, res, ctx, broadcast);
  return handlePlacementWrite(action as "place" | "propose", changeRef, req, res, ctx, broadcast);
}
