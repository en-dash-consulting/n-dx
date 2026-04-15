/**
 * Health and reorganize routes: structure health score, reorganization proposals.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../types.js";
import { jsonResponse, errorResponse, readBody } from "../response-utils.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { loadPRD, savePRD } from "./rex-route-helpers.js";

import {
  computeHealthScore,
  detectReorganizations,
  applyProposals,
  applyReshape,
  type ReshapeProposal,
} from "../rex-gateway.js";

/** Health and reorganize routes. */
export function routeHealthReorganize(
  path: string, method: string,
  req: IncomingMessage, res: ServerResponse, ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  // GET /api/rex/health — structure health score
  if (path === "health" && method === "GET") {
    const doc = loadPRD(ctx);
    if (!doc) {
      errorResponse(res, 404, "No PRD data found");
      return true;
    }
    const health = computeHealthScore(doc.items);
    jsonResponse(res, 200, health);
    return true;
  }

  // GET /api/rex/reorganize — detect reorganization proposals
  // Query params: mode=fast|full (default: full)
  if (path === "reorganize" && method === "GET") {
    return (async () => {
      const doc = loadPRD(ctx);
      if (!doc) {
        errorResponse(res, 404, "No PRD data found");
        return true;
      }
      if (doc.items.length === 0) {
        jsonResponse(res, 200, { structural: { proposals: [], stats: {} }, llm: [] });
        return true;
      }

      const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const mode = urlObj.searchParams.get("mode") ?? "full";

      const plan = detectReorganizations(doc.items);
      const structural = {
        proposals: plan.proposals.map((p) => ({
          id: p.id,
          type: p.type,
          description: p.description,
          risk: p.risk,
          confidence: p.confidence,
          items: p.items,
        })),
        stats: plan.stats,
      };

      let llm: Array<{ id: string; action: string; reason: string }> = [];
      if (mode !== "fast") {
        try {
          const { reasonForReshape } = await import("../rex-gateway.js");
          const { proposals } = await reasonForReshape(doc.items, { dir: ctx.projectDir });
          llm = proposals.map((p: ReshapeProposal) => ({
            id: p.id,
            action: p.action.action,
            reason: p.action.reason,
          }));
        } catch {
          // LLM unavailable — return structural only
        }
      }

      jsonResponse(res, 200, { structural, llm });
      return true;
    })();
  }

  // POST /api/rex/reorganize/apply — apply selected proposals
  // Body: { proposalIds?: number[], llmProposalIds?: string[] }
  if (path === "reorganize/apply" && method === "POST") {
    return (async () => {
      const doc = loadPRD(ctx);
      if (!doc) {
        errorResponse(res, 404, "No PRD data found");
        return true;
      }

      const body = await readBody(req);
      let proposalIds: number[];
      let llmProposalIds: string[];
      try {
        const parsed = JSON.parse(body);
        proposalIds = parsed.proposalIds ?? [];
        llmProposalIds = parsed.llmProposalIds ?? [];
      } catch {
        errorResponse(res, 400, "Invalid JSON body");
        return true;
      }

      let structuralApplied = 0;
      let structuralFailed = 0;

      // Apply structural proposals
      if (proposalIds.length > 0 || (llmProposalIds.length === 0 && proposalIds.length === 0)) {
        const plan = detectReorganizations(doc.items);
        const toApply = proposalIds.length > 0
          ? plan.proposals.filter((p) => proposalIds.includes(p.id))
          : plan.proposals.filter((p) => p.risk === "low");

        if (toApply.length > 0) {
          const result = applyProposals(doc.items, toApply);
          structuralApplied = result.applied;
          structuralFailed = result.failed;
        }
      }

      // Apply LLM proposals
      let llmApplied = 0;
      let llmFailed = 0;
      if (llmProposalIds.length > 0) {
        try {
          const { reasonForReshape } = await import("../rex-gateway.js");
          const { proposals } = await reasonForReshape(doc.items, { dir: ctx.projectDir });
          const toApply = proposals.filter((p: ReshapeProposal) => llmProposalIds.includes(p.id));
          if (toApply.length > 0) {
            const reshapeResult = applyReshape(doc.items, toApply);
            llmApplied = reshapeResult.applied.length;
            llmFailed = reshapeResult.errors.length;
          }
        } catch {
          // LLM unavailable
        }
      }

      const totalApplied = structuralApplied + llmApplied;
      if (totalApplied > 0) {
        savePRD(ctx, doc);
        if (broadcast) broadcast({ type: "rex:prd-changed", source: "reorganize" });
      }
      jsonResponse(res, 200, {
        applied: totalApplied,
        failed: structuralFailed + llmFailed,
        structuralApplied,
        llmApplied,
      });
      return true;
    })();
  }

  return false;
}
