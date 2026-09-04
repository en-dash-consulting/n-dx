/**
 * PRD refinement apply route — `POST /api/rex/apply-refinements`.
 *
 * The write half of the Ask panel's refine mode. The panel generates proposals
 * from an answer, renders each as a before/after diff, and posts only the ones
 * the user accepted; nothing reaches this route until then, and rejecting a
 * proposal issues no request at all.
 *
 * ## Why this route exists rather than reusing the item PATCH
 *
 * An `edit` proposal could be expressed as a PATCH per item, but three of the
 * guarantees this feature is built on cannot:
 *
 * - **One lock span for the batch.** Accepting three proposals must be three
 *   mutations of one document under one lock, not three independent
 *   read-modify-writes racing each other and any external writer.
 * - **Staleness.** The PATCH route takes whatever field values it is given; a
 *   refinement carries the fingerprint of the item it was generated against and
 *   is refused when that no longer matches (see `prd-refinement.ts`).
 * - **Merge and reparent in the same batch.** Those are separate endpoints with
 *   separate transactions, so a mixed set of accepted proposals could half-apply.
 *
 * ## Concurrency
 *
 * Everything happens inside `store.withTransaction`, which holds the PRD file
 * lock across load → mutate → write. This makes the dashboard a first-class PRD
 * writer alongside `ndx work` and the MCP tools: when another writer holds the
 * lock, `withTransaction` throws naming the holder's PID, and that message is
 * passed through to the panel verbatim rather than being flattened into a
 * generic failure. Overwriting the holder's work is not an option this route
 * has — see the concurrency contract in the root `CLAUDE.md`.
 *
 * @module web/server/routes-rex/refinements
 * @see ../prd-refinement.ts — proposal parsing, staleness, and the mutation itself
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../types.js";
import { jsonResponse, errorResponse, readBody } from "../response-utils.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { appendLog } from "./rex-route-helpers.js";
import { refreshPRDCache } from "../prd-io.js";
import { resolveStore } from "../rex-gateway.js";
import {
  MAX_REFINEMENT_PROPOSALS,
  applyRefinements,
  describeRefinement,
} from "../prd-refinement.js";
import type { RefinementOutcome, RefinementProposal } from "../prd-refinement.js";

/** Refinement routes. Returns false when the path is not ours. */
export function routeRefinements(
  path: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  if (path === "apply-refinements" && method === "POST") {
    return handleApplyRefinements(req, res, ctx, broadcast);
  }
  return false;
}

/**
 * Shape check on the posted proposals.
 *
 * Deliberately structural rather than a full re-derivation: the proposals were
 * built by this server from a document it loaded, and the authority that
 * matters — do the fingerprints still hold, is the mutation still legal — is
 * re-established under the lock by `applyRefinements`. What this guards is a
 * malformed body reaching the transaction at all.
 */
function isProposalShape(value: unknown): value is RefinementProposal {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record["op"] !== "edit" && record["op"] !== "reparent" && record["op"] !== "merge") {
    return false;
  }
  if (typeof record["id"] !== "string" || typeof record["itemId"] !== "string") return false;
  if (!Array.isArray(record["baseline"]) || record["baseline"].length === 0) return false;
  return record["baseline"].every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const b = entry as Record<string, unknown>;
    return typeof b["itemId"] === "string" && typeof b["fingerprint"] === "string";
  });
}

/**
 * Handle `POST /api/rex/apply-refinements`.
 *
 * Body: `{ proposals: RefinementProposal[] }` — the accepted subset.
 * 200:   `{ ok, applied, refused, outcomes }`.
 * 409:   the PRD lock was held by another writer; `error` names the holder.
 */
async function handleApplyRefinements(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  let input: { proposals?: unknown };
  try {
    input = JSON.parse((await readBody(req)) || "{}") as { proposals?: unknown };
  } catch {
    errorResponse(res, 400, "Request body must be JSON.");
    return true;
  }

  const raw = input.proposals;
  if (!Array.isArray(raw) || raw.length === 0) {
    // Not an error the user can see: the panel never sends an empty accept.
    // Refused rather than treated as a no-op write, because opening a
    // transaction would re-serialize the whole tree for no change.
    errorResponse(res, 400, "Missing required field: proposals (non-empty array)");
    return true;
  }
  if (raw.length > MAX_REFINEMENT_PROPOSALS) {
    errorResponse(res, 400, `At most ${MAX_REFINEMENT_PROPOSALS} proposals can be applied at once.`);
    return true;
  }
  if (!raw.every(isProposalShape)) {
    errorResponse(res, 400, "One or more proposals were not in the expected shape.");
    return true;
  }
  const proposals = raw as RefinementProposal[];

  let outcomes: RefinementOutcome[] = [];
  try {
    const store = await resolveStore(ctx.rexDir);
    // The whole read-modify-write sits inside the lock. Loading the document
    // outside it and mutating a snapshot is exactly the pattern the staleness
    // check exists to defend against, so this route must not use it.
    const updatedDoc = await store.withTransaction(async (doc) => {
      outcomes = applyRefinements(doc, proposals);
      return doc;
    });
    refreshPRDCache(ctx.rexDir, updatedDoc);
  } catch (err) {
    // The lock failure names the holder's PID. That is the single most useful
    // fact in the message, so it is passed through instead of being replaced
    // with wording of our own.
    const message = err instanceof Error ? err.message : String(err);
    const locked = message.includes("Could not acquire PRD lock");
    errorResponse(res, locked ? 409 : 500, message);
    return true;
  }

  const applied = outcomes.filter((outcome) => outcome.status === "applied");
  const refused = outcomes.filter((outcome) => outcome.status !== "applied");

  if (applied.length > 0) {
    const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "sv_ask_refine",
      detail: `Applied ${applied.length} PRD refinement${applied.length === 1 ? "" : "s"} via web: `
        + applied
          .map((outcome) => {
            const proposal = byId.get(outcome.id);
            return proposal ? describeRefinement(proposal) : outcome.itemId;
          })
          .join("; "),
    });

    // The PRD views re-read on this broadcast, which is what makes an applied
    // refinement visible without restarting the server.
    if (broadcast) {
      broadcast({ type: "rex:prd-changed", timestamp: new Date().toISOString() });
    }
  }

  jsonResponse(res, 200, {
    ok: refused.length === 0,
    applied: applied.length,
    refused: refused.length,
    outcomes,
  });
  return true;
}
