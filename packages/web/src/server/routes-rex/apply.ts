/**
 * Apply a v2 change awaiting apply from its detail panel.
 *
 *   POST /api/rex/changes/:id/apply/preview → { layout: "v2", change, appliedAt, applied }
 *                                             what applying would do; writes nothing
 *   POST /api/rex/changes/:id/apply         → { layout: "v2", change, appliedAt, applied }
 *                                             applies, logs `change_applied` and broadcasts
 *
 * Rex decides everything: both routes run rex's `applyChange`, the entry MCP
 * `apply_change` runs, which previews on the loaded tree or applies inside
 * rex's v2 transaction. A preview has the same refusals as the apply.
 *
 * A v1 tree answers 409, a held PRD lock 409, and rex's refusal 422
 * `{ error, problems }` with rex's own message. The wire types mirror
 * `viewer/views/product-model.ts`; `tests/unit/server/routes-rex-apply.test.ts`
 * fails to compile if they drift.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../types.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { jsonResponse, errorResponse, errorMessage } from "../response-utils.js";
import { refreshPRDCache } from "../prd-io.js";
import { appendLog } from "./rex-route-helpers.js";
import { applyChange, prdLayout, resolveStore } from "../rex-gateway.js";

// ── Wire types (mirror viewer/views/product-model.ts) ────────────────

export interface AppliedAmendmentWire {
  delta: "added" | "modified" | "removed";
  summary: string;
  /** The product node the amendment creates, edits or retires. */
  node: { id: string; displayId?: string; title: string; type: string };
  /** Where an added node lands. */
  under?: { id: string; displayId?: string; title: string };
}

export interface ChangeApplyWire {
  layout: "v2";
  change: string;
  appliedAt: string;
  applied: AppliedAmendmentWire[];
}

// ── Routes ───────────────────────────────────────────────────────────

const APPLY_PATH = /^changes\/([^/]+)\/(apply|apply\/preview)$/;

const V1_REFUSAL = "This project's PRD uses the v1 layout, which has no product layer to apply changes to. Migrate it first.";

export function routeApply(
  path: string,
  method: string,
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  const match = APPLY_PATH.exec(path);
  if (!match || method !== "POST") return false;
  return handleApply(decodeURIComponent(match[1]), match[2] === "apply/preview", res, ctx, broadcast);
}

async function handleApply(changeRef: string, preview: boolean, res: ServerResponse, ctx: ServerContext, broadcast?: WebSocketBroadcaster): Promise<boolean> {
  if ((await prdLayout(ctx.rexDir)) !== "v2") {
    errorResponse(res, 409, V1_REFUSAL);
    return true;
  }
  try {
    const outcome = await applyChange(ctx.rexDir, changeRef, { preview });
    if (!outcome.ok) {
      jsonResponse(res, 422, { error: outcome.message, problems: outcome.problems });
      return true;
    }
    const { change, appliedAt } = outcome;
    const applied: AppliedAmendmentWire[] = outcome.applied.map(({ delta, summary, node, under }) => ({ delta, summary, node, ...(under ? { under } : {}) }));
    if (outcome.written) {
      refreshPRDCache(ctx.rexDir, await (await resolveStore(ctx.rexDir)).loadDocument());
      appendLog(ctx, {
        timestamp: appliedAt,
        event: "change_applied",
        itemId: change,
        detail: `${applied.length ? applied.map((a) => `${a.delta} ${a.node.id}`).join(", ") : "no amendments"} (via dashboard)`,
      });
      broadcast?.({ type: "rex:prd-changed", timestamp: appliedAt });
    }
    const body: ChangeApplyWire = { layout: "v2", change, appliedAt, applied };
    jsonResponse(res, 200, body);
  } catch (err) {
    const message = errorMessage(err);
    errorResponse(res, message.includes("Could not acquire PRD lock") ? 409 : 500, message);
  }
  return true;
}
