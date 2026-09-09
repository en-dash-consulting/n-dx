/**
 * POST /api/rex/apply-refinements — write accepted PRD refinements.
 *
 * This is the web server acting as a PRD writer, alongside `ndx work` and the
 * MCP tools, on content a model proposed. Two guarantees make that safe, and
 * both are load-bearing rather than decorative.
 *
 * ## Everything happens inside one transaction
 *
 * `store.withTransaction` holds the PRD file lock across load → mutate → save.
 * A bare read-modify-write here would race every other writer: hench finishing
 * a task, an MCP `edit_item`, a `rex reshape` in another terminal. Losing that
 * race silently overwrites their work, which is exactly the failure the
 * concurrency contract in CLAUDE.md exists to prevent. When the lock cannot be
 * taken the error names the holder's PID and this route reports it as a
 * conflict — a loud failure the user can act on.
 *
 * ## Staleness is re-checked inside the lock
 *
 * A proposal carries the `before` it was written against. It is checked here,
 * after the lock is held and the document freshly loaded — not when the
 * proposal was made, and not before the lock. Anything earlier is a
 * time-of-check/time-of-use gap: the item can change in the moment between the
 * check and the write, and the write would land on text the model never saw.
 *
 * A stale proposal is refused individually. The rest of the batch still
 * applies, because one item moving underneath the user is not a reason to
 * discard their other decisions.
 *
 * @module web/server/routes-rex-refinements
 * @see packages/web/src/server/ask-refinements.ts — where proposals come from
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "./types.js";
import type { WebSocketBroadcaster } from "./websocket.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";
import { refreshPRDCache } from "./prd-io.js";
import {
  resolveStore,
  findItem,
  updateInTree,
  removeFromTree,
  insertChild,
  mergeItems,
  isPriority,
} from "./rex-gateway.js";
import type { PRDItem, PRDDocument } from "./rex-gateway.js";
import { stalenessOf, currentValue } from "./ask-refinements.js";
import type { RefinementProposal } from "./ask-refinements.js";

const APPLY_PATH = "/api/rex/apply-refinements";

/** What happened to one accepted proposal. */
export interface RefinementOutcome {
  id: string;
  applied: boolean;
  /** Present when `applied` is false — why it was refused. */
  reason?: string;
}

/** An item's parent id, or undefined when it sits at the root. */
function parentIdOf(items: PRDItem[], childId: string): string | undefined {
  return findItem(items, childId)?.parents.at(-1)?.id;
}

/**
 * Apply one proposal to the in-memory document.
 *
 * The rex tree helpers mutate `doc.items` in place and report whether they
 * found their target, which suits a transaction: the callback hands the whole
 * mutated tree back and it is saved once, under the lock that is already held.
 * Calling the store's per-item helpers instead would take that lock again per
 * write, from inside the transaction that owns it.
 */
function applyOne(doc: PRDDocument, proposal: RefinementProposal): RefinementOutcome {
  const entry = findItem(doc.items, proposal.itemId);
  const item = entry?.item ?? null;
  const parentId = parentIdOf(doc.items, proposal.itemId);

  // Re-checked here, under the lock, against the document this transaction
  // loaded — not against whatever was on disk when the answer was written.
  const staleness = stalenessOf(proposal, item, parentId);
  if (staleness.stale) {
    return { id: proposal.id, applied: false, reason: staleness.reason };
  }
  if (!item) {
    return { id: proposal.id, applied: false, reason: `Item ${proposal.itemId} no longer exists.` };
  }

  switch (proposal.kind) {
    case "description":
      updateInTree(doc.items, proposal.itemId, { description: proposal.after.join("\n") });
      return { id: proposal.id, applied: true };

    case "acceptanceCriteria":
      updateInTree(doc.items, proposal.itemId, { acceptanceCriteria: [...proposal.after] });
      return { id: proposal.id, applied: true };

    case "priority": {
      const priority = proposal.after[0] ?? "";
      if (!isPriority(priority)) {
        return { id: proposal.id, applied: false, reason: `"${priority}" is not a valid priority.` };
      }
      updateInTree(doc.items, proposal.itemId, { priority });
      return { id: proposal.id, applied: true };
    }

    case "parent": {
      const newParentId = proposal.after[0] ?? "";
      if (!findItem(doc.items, newParentId)) {
        return { id: proposal.id, applied: false, reason: `Parent ${newParentId} does not exist.` };
      }
      // Moving an item under its own descendant would take the whole subtree
      // out of the document with it.
      if (findItem(item.children ?? [], newParentId)) {
        return {
          id: proposal.id,
          applied: false,
          reason: `Cannot move "${item.title}" under its own descendant.`,
        };
      }
      const detached = removeFromTree(doc.items, proposal.itemId);
      if (!detached) {
        return { id: proposal.id, applied: false, reason: `Item ${proposal.itemId} could not be detached.` };
      }
      if (!insertChild(doc.items, newParentId, detached)) {
        // Put it back rather than leave the tree short an item.
        doc.items.push(detached);
        return { id: proposal.id, applied: false, reason: `Parent ${newParentId} could not take the item.` };
      }
      return { id: proposal.id, applied: true };
    }

    case "merge": {
      const duplicateId = proposal.after[0] ?? "";
      if (!findItem(doc.items, duplicateId)) {
        return {
          id: proposal.id,
          applied: false,
          reason: `The duplicate ${duplicateId} is already gone — nothing to merge.`,
        };
      }
      try {
        // Sources first, target second: the proposal's item is the survivor.
        mergeItems(doc.items, [duplicateId], proposal.itemId);
        return { id: proposal.id, applied: true };
      } catch (err) {
        return {
          id: proposal.id,
          applied: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }
}

/** True when the error is the PRD lock refusing to hand over. */
function isLockConflict(err: unknown): boolean {
  return err instanceof Error && /could not acquire prd lock/i.test(err.message);
}

/**
 * Validate one proposal off the wire.
 *
 * The client sends back the proposals it was given, so this is not the model's
 * output — but it is still input, and a hand-rolled request must not be able to
 * reach the store with an unknown `kind` or a missing `before`.
 */
function parseProposal(raw: unknown): RefinementProposal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  const lines = (v: unknown): string[] | null =>
    Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]) : null;

  const before = lines(p.before);
  const after = lines(p.after);
  const kind = p.kind;
  if (typeof p.id !== "string" || typeof p.itemId !== "string") return null;
  if (typeof kind !== "string") return null;
  if (!["description", "acceptanceCriteria", "priority", "parent", "merge"].includes(kind)) return null;
  if (!before || !after) return null;

  return {
    id: p.id,
    kind: kind as RefinementProposal["kind"],
    itemId: p.itemId,
    itemTitle: typeof p.itemTitle === "string" ? p.itemTitle : "",
    rationale: typeof p.rationale === "string" ? p.rationale : "",
    before,
    after,
  };
}

/**
 * Handle the apply route.
 *
 * @returns true when this route handled the request
 */
export async function handleApplyRefinementsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  const routePath = (req.url || "/").split("?")[0];
  if (routePath !== APPLY_PATH) return false;

  if ((req.method || "GET") !== "POST") {
    errorResponse(res, 405, "Method not allowed — use POST.");
    return true;
  }

  let input: unknown;
  try {
    input = JSON.parse((await readBody(req)) || "{}");
  } catch {
    errorResponse(res, 400, "Request body is not valid JSON.");
    return true;
  }

  const rawProposals = (input as { proposals?: unknown }).proposals;
  if (!Array.isArray(rawProposals) || rawProposals.length === 0) {
    // An empty accept list is a client bug, not a no-op write: refusing it
    // keeps "nothing was accepted" from looking like "the write succeeded".
    errorResponse(res, 400, "`proposals` must be a non-empty array of accepted proposals.");
    return true;
  }

  const proposals: RefinementProposal[] = [];
  for (const raw of rawProposals) {
    const parsed = parseProposal(raw);
    if (!parsed) {
      errorResponse(res, 400, "One or more proposals are malformed.");
      return true;
    }
    proposals.push(parsed);
  }

  let outcomes: RefinementOutcome[] = [];
  let updatedDoc: PRDDocument | null = null;

  try {
    const store = await resolveStore(ctx.rexDir);
    updatedDoc = await store.withTransaction(async (doc) => {
      outcomes = proposals.map((proposal) => applyOne(doc, proposal));
      return doc;
    });
  } catch (err) {
    if (isLockConflict(err)) {
      // Loud, and naming the holder: the lock message carries the PID. Better
      // than a retry that would overwrite whoever holds it.
      jsonResponse(res, 409, {
        ok: false,
        error: `Another process is writing to the PRD — nothing was changed. ${String(err instanceof Error ? err.message : err)}`,
        applied: 0,
      });
      return true;
    }
    errorResponse(res, 500, `Failed to apply refinements: ${String(err instanceof Error ? err.message : err)}`);
    return true;
  }

  const applied = outcomes.filter((o) => o.applied).length;

  // Only when something changed: the PRD views pick it up from the refreshed
  // cache and the broadcast, so an applied refinement shows without a restart.
  if (applied > 0 && updatedDoc) {
    refreshPRDCache(ctx.rexDir, updatedDoc);
    if (broadcast) {
      broadcast({ type: "rex:prd-changed", timestamp: new Date().toISOString(), source: "sv-ask-refinement" });
    }
  }

  jsonResponse(res, 200, {
    ok: true,
    applied,
    refused: outcomes.length - applied,
    outcomes,
    items: outcomes
      .filter((o) => o.applied)
      .map((o) => {
        const proposal = proposals.find((p) => p.id === o.id)!;
        const item = updatedDoc ? findItem(updatedDoc.items, proposal.itemId)?.item ?? null : null;
        return {
          id: proposal.itemId,
          title: item?.title ?? proposal.itemTitle,
          kind: proposal.kind,
          value: item
            ? currentValue(item, proposal.kind, parentIdOf(updatedDoc!.items, proposal.itemId))
            : [],
        };
      }),
  });
  return true;
}
