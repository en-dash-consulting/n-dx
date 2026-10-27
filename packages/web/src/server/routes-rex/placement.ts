/**
 * Inbox placement on a v2 project: read a change's shortlist, place it, or
 * propose a new home for it.
 *
 *   GET  /api/rex/changes/:id/placement → { layout: "v2", change, relation, tied, shortlist }
 *   GET  /api/rex/changes/placements    → { layout: "v2", placements: { [id]: placement | { error } } }
 *                                         every open change awaiting placement, from one model load
 *   POST /api/rex/changes/:id/place     → { change, target, relation, warnings? }
 *   POST /api/rex/changes/:id/propose   → { change, proposed: { target, under, title, type }, warnings? }
 *
 * Rex decides everything (`suggestPlacement`, `recordPlacement`,
 * `recordProposal`); this module enriches the shortlist with what the viewer
 * shows and writes through rex's v2 transaction, as `place_change` does.
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
import { appendLog } from "./rex-route-helpers.js";
import {
  prdLayout,
  loadPrdModel,
  indexTree,
  isOpenChange,
  awaitsPlacement,
  resolveStore,
  suggestPlacement,
  recordPlacement,
  recordProposal,
  ChangePlacementError,
  withPrdModelTransaction,
} from "../rex-gateway.js";
import type { RuleNode, V2Tree, RecordPlacementInput, RecordProposalInput } from "../rex-gateway.js";

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
}

export interface ChangePlacementWire {
  layout: "v2";
  change: { id: string; title: string; intent?: string; status: string; taskCount: number; tags?: string[] };
  relation: PlacementRelationWire;
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

// ── Shortlist ────────────────────────────────────────────────────────

/** The shortlist for `changeRef`, with each candidate's title, area, statement and criteria. */
export function buildChangePlacement(tree: V2Tree, changeRef: string): ChangePlacementWire {
  const suggestion = suggestPlacement(tree, changeRef);
  const index = indexTree(tree);
  const parentOf = new Map<string, RuleNode | undefined>(index.entries.map((e) => [e.node.id, e.parent]));
  const areaOf = (node: RuleNode): string => {
    for (let p = parentOf.get(node.id); p; p = parentOf.get(p.id)) {
      if (p.type === "area") return p.title;
    }
    return "";
  };

  const change = index.resolve(suggestion.change)!;
  const tasks = (change.children ?? []).filter((c) => c.type === "task" && c.status !== "deleted");
  const shortlist = suggestion.shortlist.flatMap((candidate): PlacementCandidateWire[] => {
    const node = index.resolve(candidate.target);
    if (!node || (node.type !== "capability" && node.type !== "constraint")) return [];
    const criteria = node.type === "capability" ? node.criteria ?? [] : [];
    return [{
      target: node.id,
      type: node.type,
      title: node.title,
      area: areaOf(node),
      ...(typeof node.statement === "string" ? { statement: node.statement } : {}),
      criteria: criteria.map((c) => ({ id: c.id, text: c.text })),
      score: candidate.score,
      strength: candidate.strength,
      reasons: candidate.reasons,
    }];
  });

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
    },
    relation: suggestion.relation,
    tied: suggestion.tied,
    shortlist,
  };
}

/** The shortlist of every open change awaiting placement, keyed by change id. */
export function buildAwaitingPlacements(tree: V2Tree): Record<string, ChangePlacementWire | { error: string }> {
  const index = indexTree(tree);
  const out: Record<string, ChangePlacementWire | { error: string }> = {};
  for (const { node } of index.entries) {
    if (node.type !== "change" || !isOpenChange(node) || !awaitsPlacement(index, node)) continue;
    try {
      out[node.id] = buildChangePlacement(tree, node.id);
    } catch (err) {
      out[node.id] = { error: errorMessage(err) };
    }
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
async function publish(ctx: ServerContext, entry: { timestamp: string; event: string; itemId: string; detail: string }, broadcast?: WebSocketBroadcaster): Promise<void> {
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
    jsonResponse(res, 200, { layout: "v2", placements: buildAwaitingPlacements(tree) });
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
    const now = new Date();
    const timestamp = now.toISOString();
    if (action === "place") {
      const { criteria, ...rest } = parsed as PlaceChangeRequestWire;
      const input: RecordPlacementInput = { ...rest, ...(criteria !== undefined ? { criteria: { ...criteria } } : {}) };
      const { result } = await withPrdModelTransaction(ctx.rexDir, (model) => {
        const placed = recordPlacement(model.tree, changeRef, input, now);
        return { tree: placed.tree, result: placed };
      });
      const { change, placement, warnings } = result;
      await publish(ctx, { timestamp, event: "change_placed", itemId: change, detail: `${placement.relation} ${placement.target} (via web)` }, broadcast);
      const answer: PlaceChangeResultWire = { change, target: placement.target, relation: placement.relation, ...(warnings.length ? { warnings } : {}) };
      jsonResponse(res, 200, answer);
    } else {
      const input: RecordProposalInput = parsed as ProposeChangeRequestWire;
      const { result } = await withPrdModelTransaction(ctx.rexDir, (model) => {
        const recorded = recordProposal(model.tree, changeRef, input, now);
        return { tree: recorded.tree, result: recorded };
      });
      const { change, proposal, warnings } = result;
      await publish(ctx, {
        timestamp,
        event: "change_proposed",
        itemId: change,
        detail: `${proposal.type} under ${proposal.under}: ${proposal.title} (via web)`,
      }, broadcast);
      const answer: ProposeChangeResultWire = {
        change,
        proposed: { target: proposal.target, under: proposal.under, title: proposal.title, type: proposal.type },
        ...(warnings.length ? { warnings } : {}),
      };
      jsonResponse(res, 200, answer);
    }
  } catch (err) {
    refuse(res, err);
  }
  return true;
}

// ── Router ───────────────────────────────────────────────────────────

const PLACEMENT_PATH = /^changes\/([^/]+)\/(placement|place|propose)$/;

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
  return handlePlacementWrite(action as "place" | "propose", changeRef, req, res, ctx, broadcast);
}
