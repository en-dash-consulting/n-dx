/**
 * The placement card (story 29): what a `place_change_card` call proposes,
 * dry-run through rex before the card is raised, and the write an approval
 * makes.
 *
 * Before the card: {@link readPlacementCall} reads the call as the body
 * `POST /api/rex/changes/:id/placement/check` takes and dry-runs it through
 * rex's `recordPlacement` or `recordProposal` on the PRD as loaded, writing
 * nothing. A refusal goes on the card with its kind; only a call that names
 * no change, or that cannot be read at all, raises no card.
 *
 * On approval: {@link writePlacementCard} writes through `writePlacement`,
 * the function `POST …/place` and `…/propose` write through, under the PRD
 * model transaction, and only the placement the card's dry run described: if
 * its target, relation, area or the target's spec hash moved while the card
 * waited, nothing is written. A card raised with a refusal writes nothing at
 * all. An edited card is pinned to the dry run the operator reviewed
 * ({@link readPlacementEdit}). A proposed node is recorded only as the change's added
 * amendment: it reaches the product layer when the change is applied, and
 * nothing here applies it.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §5 Place (Q8).
 */

import { ChangePlacementError } from "../rex-gateway.js";
import { checkPlacementOnDisk, movedSince, parsePlacementRequest, PlacementMovedError, writePlacement } from "../routes-rex/placement.js";
import { errorMessage } from "../response-utils.js";
import type { ServerContext } from "../types.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import type { SidecarPlacement, SidecarPlacementCheck } from "../../shared/index.js";
import type { CarryOutResult } from "./carry-out.js";

/** The most reasons one card carries, and the longest each may be. */
export const PLACEMENT_MAX_REASONS = 10;
export const PLACEMENT_REASON_MAX_CHARS = 500;

/** A `place_change_card` call read and dry-run for its card, or why no card can be raised. */
export async function readPlacementCall(rexDir: string, input: Record<string, unknown>): Promise<SidecarPlacement | string> {
  const { change, reasons, ...rest } = input;
  if (typeof change !== "string" || !change.trim()) return "a placement needs the change to place (change)";
  if (!Array.isArray(reasons) || reasons.length === 0 || !reasons.every((r) => typeof r === "string" && r.trim())) {
    return "a placement needs your reasons (reasons: one or more lines)";
  }
  if (reasons.length > PLACEMENT_MAX_REASONS || reasons.some((r) => (r as string).length > PLACEMENT_REASON_MAX_CHARS)) {
    return `give at most ${PLACEMENT_MAX_REASONS} reasons of at most ${PLACEMENT_REASON_MAX_CHARS} characters each`;
  }
  const request = parsePlacementRequest(rest);
  if (typeof request === "string") return request;
  let check: SidecarPlacement["check"];
  try {
    check = await checkPlacementOnDisk(rexDir, change.trim(), request);
  } catch (err) {
    return errorMessage(err);
  }
  // A card about no change has nothing for the operator to decide.
  if (!check.ok && check.kind === "no-such-change") return check.error;
  return { change: change.trim(), request, reasons: (reasons as string[]).map((r) => r.trim()), check };
}

type AcceptedCheck = Extract<SidecarPlacementCheck, { ok: true }>;

/** Why an edited placement cannot be approved: 400 for an unreadable or refused edit, 409 for one the PRD moved under. */
export interface PlacementEditRefusal {
  status: 400 | 409;
  error: string;
}

/** The accepted dry run the operator reviewed, as an approval sends it, or why it is unreadable. */
function parseReviewedCheck(reviewed: unknown): AcceptedCheck | string {
  const missing = "an edited placement's approval needs the dry run the operator reviewed (reviewed: the edit's accepted check)";
  if (!reviewed || typeof reviewed !== "object" || Array.isArray(reviewed)) return missing;
  const r = reviewed as Record<string, unknown>;
  const str = (k: string) => typeof r[k] === "string";
  if (r.ok !== true || !str("title")) return missing;
  if (r.action === "place" && str("target") && (r.relation === "touches" || r.relation === "amends") && (r.base === undefined || str("base"))) {
    return { ok: true, action: "place", target: r.target as string, title: r.title as string, relation: r.relation, ...(r.base !== undefined && { base: r.base as string }), warnings: [] };
  }
  if (r.action === "propose" && str("under") && (r.type === "capability" || r.type === "constraint")) {
    return { ok: true, action: "propose", type: r.type, under: r.under as string, title: r.title as string, warnings: [] };
  }
  return missing;
}

/**
 * The operator's edit of a placement card, as the body `POST …/placement/check`
 * takes, read and dry-run on the PRD as loaded. Approval writes this placement
 * in place of the card's own, pinned to the re-check made here. A refusal says
 * why the edit cannot be approved, and nothing is changed:
 *
 * - 400: the edit or `reviewed` is unreadable, or rex refuses the edit;
 * - 409: the re-check is not the dry run the operator `reviewed` (target,
 *   relation or spec hash moved since), or the edit keeps the card's target
 *   and relation but the target's spec is no longer the one the card was
 *   raised on.
 */
export async function readPlacementEdit(
  rexDir: string,
  card: SidecarPlacement,
  edits: unknown,
  reviewed: unknown,
): Promise<Pick<SidecarPlacement, "request" | "check"> | PlacementEditRefusal> {
  const bad = (error: string): PlacementEditRefusal => ({ status: 400, error });
  if (!edits || typeof edits !== "object" || Array.isArray(edits)) return bad("a placement card's edit must be a placement object");
  const request = parsePlacementRequest(edits as Record<string, unknown>);
  if (typeof request === "string") return bad(request);
  let check: SidecarPlacementCheck;
  try {
    check = await checkPlacementOnDisk(rexDir, card.change, request);
  } catch (err) {
    return bad(errorMessage(err));
  }
  if (!check.ok) return bad(`Rex would refuse the edited placement (kind: ${check.kind}): ${check.error}`);
  const seen = parseReviewedCheck(reviewed);
  if (typeof seen === "string") return bad(seen);
  const moved = movedSince(seen, check) ?? movedFromCard(card.check, check);
  if (moved) return { status: 409, error: `Nothing was written: ${moved}. Check the placement again before approving.` };
  return { request, check };
}

/** An edit that keeps the card's target and relation still answers the card's spec hash. */
function movedFromCard(cardCheck: SidecarPlacementCheck, now: AcceptedCheck): string | undefined {
  if (!cardCheck.ok || cardCheck.action !== "place" || now.action !== "place") return undefined;
  if (cardCheck.target !== now.target || cardCheck.relation !== now.relation) return undefined;
  return movedSince(cardCheck, now);
}

/** An approved placement card's write and its tool result. Never throws. */
export async function writePlacementCard(
  ctx: ServerContext,
  placement: SidecarPlacement,
  sessionId: string,
  broadcast?: WebSocketBroadcaster,
): Promise<CarryOutResult> {
  // A card raised with a refusal writes nothing, even if rex would accept it now: the operator never saw that placement.
  if (!placement.check.ok) {
    return { ok: false, text: `Rex refused the placement (kind: ${placement.check.kind}): ${placement.check.error}. Nothing was written.` };
  }
  try {
    // The operator approved the dry run on the card: write only that placement, never one the PRD has moved to since.
    const { change, check } = await writePlacement(ctx, placement.change, placement.request, "Sidecar", broadcast, placement.check, { sessionId, reasons: placement.reasons });
    const warnings = check.warnings.length ? ` Warnings: ${check.warnings.join(" ")}` : "";
    const text = check.action === "place"
      ? `Placed change ${change}: it ${check.relation} ${check.title} (${check.target}).${warnings}`
      : `Recorded a proposed ${check.type} "${check.title}" under ${check.under} on change ${change}, as the change's added amendment. It reaches the product map only when the change is applied.${warnings}`;
    return { ok: true, text, ids: [change] };
  } catch (err) {
    if (err instanceof ChangePlacementError) {
      return { ok: false, text: `Rex refused the placement (kind: ${err.kind}): ${err.plain}. Nothing was written.` };
    }
    if (err instanceof PlacementMovedError) {
      return { ok: false, text: `Nothing was written: ${err.message}. Read the change's placement again and raise a new card.` };
    }
    return { ok: false, text: `Nothing was written: ${errorMessage(err)}.` };
  }
}
