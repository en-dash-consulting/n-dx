/**
 * Apply a v2 change awaiting apply from its detail panel.
 *
 *   POST /api/rex/changes/:id/apply/preview → { layout: "v2", change, appliedAt, applied, hash }
 *                                             what applying would do; writes nothing
 *   POST /api/rex/changes/:id/apply  { hash } → { layout: "v2", change, appliedAt, applied, hash }
 *                                             applies, logs `change_applied` and broadcasts
 *
 * Rex decides everything: both routes run rex's `applyChange`, the entry MCP
 * `apply_change` runs, which previews on the loaded tree or applies inside
 * rex's v2 transaction. A preview has the same refusals as the apply.
 *
 * The apply carries the preview's `hash` (the change's amends and the specs of
 * the nodes they target). Rex compares it inside its transaction, so an edit
 * by another writer between preview and Apply answers 409 `{ error, moved }`
 * and writes nothing: the operator approved a preview that is no longer what
 * would be applied. The pattern is the Inbox placement card's pinned dry run.
 *
 * A missing hash answers 400, a v1 tree 409, a held PRD lock 409, and rex's
 * refusal 422 `{ error, problems }` with rex's own message. The wire types mirror
 * `viewer/views/product-model.ts`; `tests/unit/server/routes-rex-apply.test.ts`
 * fails to compile if they drift.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../types.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { jsonResponse, errorResponse, errorMessage, readBody } from "../response-utils.js";
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
  /** What the preview was judged on; the apply sends it back. */
  hash: string;
}

// ── Routes ───────────────────────────────────────────────────────────

const APPLY_PATH = /^changes\/([^/]+)\/(apply|apply\/preview)$/;

const V1_REFUSAL = "This project's PRD uses the v1 layout, which has no product layer to apply changes to. Migrate it first.";

export function routeApply(
  path: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  const match = APPLY_PATH.exec(path);
  if (!match || method !== "POST") return false;
  return handleApply(decodeURIComponent(match[1]), match[2] === "apply/preview", req, res, ctx, broadcast);
}

/** The apply body's `hash`, or why the body is refused. */
function expectedHash(raw: string): { hash: string } | { error: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return { error: "Request body must be JSON." };
  }
  const hash = body && typeof body === "object" ? (body as { hash?: unknown }).hash : undefined;
  return typeof hash === "string" && hash ? { hash } : { error: "Apply needs the hash of the preview it was approved on: preview the change first." };
}

async function handleApply(changeRef: string, preview: boolean, req: IncomingMessage, res: ServerResponse, ctx: ServerContext, broadcast?: WebSocketBroadcaster): Promise<boolean> {
  const raw = preview ? "" : await readBody(req, res);
  if ((await prdLayout(ctx.rexDir)) !== "v2") {
    errorResponse(res, 409, V1_REFUSAL);
    return true;
  }
  const expected = preview ? undefined : expectedHash(raw);
  if (expected && "error" in expected) {
    errorResponse(res, 400, expected.error);
    return true;
  }
  try {
    const outcome = await applyChange(ctx.rexDir, changeRef, { preview, ...(expected ? { expectHash: expected.hash } : {}) });
    if (!outcome.ok) {
      if (outcome.moved) jsonResponse(res, 409, { error: outcome.message, moved: true });
      else jsonResponse(res, 422, { error: outcome.message, problems: outcome.problems });
      return true;
    }
    const { change, appliedAt, hash } = outcome;
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
    const body: ChangeApplyWire = { layout: "v2", change, appliedAt, applied, hash };
    jsonResponse(res, 200, body);
  } catch (err) {
    const message = errorMessage(err);
    errorResponse(res, message.includes("Could not acquire PRD lock") ? 409 : 500, message);
  }
  return true;
}
