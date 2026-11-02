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
 * waited, nothing is written. A proposed node is recorded only as the change's added
 * amendment: it reaches the product layer when the change is applied, and
 * nothing here applies it.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §5 Place (Q8).
 */

import { ChangePlacementError } from "../rex-gateway.js";
import { checkPlacementOnDisk, parsePlacementRequest, PlacementMovedError, writePlacement } from "../routes-rex/placement.js";
import { errorMessage } from "../response-utils.js";
import type { ServerContext } from "../types.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import type { SidecarPlacement } from "../../shared/index.js";
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

/**
 * The operator's edit of a placement card, as the body `POST …/placement/check`
 * takes, read and dry-run on the PRD as loaded. Approval writes this placement
 * in place of the card's own; a string says why the edit cannot be approved
 * (unreadable, or refused by rex), and nothing is changed.
 */
export async function readPlacementEdit(
  rexDir: string,
  change: string,
  edits: unknown,
): Promise<Pick<SidecarPlacement, "request" | "check"> | string> {
  if (!edits || typeof edits !== "object" || Array.isArray(edits)) return "a placement card's edit must be a placement object";
  const request = parsePlacementRequest(edits as Record<string, unknown>);
  if (typeof request === "string") return request;
  let check: SidecarPlacement["check"];
  try {
    check = await checkPlacementOnDisk(rexDir, change, request);
  } catch (err) {
    return errorMessage(err);
  }
  if (!check.ok) return `Rex would refuse the edited placement (kind: ${check.kind}): ${check.error}`;
  return { request, check };
}

/** An approved placement card's write and its tool result. Never throws. */
export async function writePlacementCard(
  ctx: ServerContext,
  placement: SidecarPlacement,
  broadcast?: WebSocketBroadcaster,
): Promise<CarryOutResult> {
  try {
    // The operator approved the dry run on the card: write only that placement, never one the PRD has moved to since.
    const expect = placement.check.ok ? placement.check : undefined;
    const { change, check } = await writePlacement(ctx, placement.change, placement.request, "Sidecar", broadcast, expect);
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
