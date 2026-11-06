/**
 * The status card: what a `propose_status` call proposes for an existing
 * item, read before the card is raised, and the write an approval makes.
 *
 * The card carries the item's status as read, the proposed status and rex's
 * own verdict on the move (`validateTransition`, the rule `update_task_status`
 * applies without `force`). A move rex refuses still raises a card, so the
 * operator sees the refusal; approving it fails with rex's message and writes
 * nothing. Approval writes through rex's `update_task_status` handler with the
 * same claims context the rex MCP server gives it, so completion checks, the
 * completion hold, claims and parent auto-completion are rex's. Never `force`.
 */

import {
  handleUpdateTaskStatus,
  openClaimsStore,
  resolveClaimHolder,
  resolveStore,
  validateTransition,
  type ItemStatus,
} from "../rex-gateway.js";
import { refreshPRDCache } from "../prd-io.js";
import { errorMessage } from "../response-utils.js";
import { findItemByRef } from "../tracker/item-links.js";
import type { SidecarStatusChange } from "../../shared/index.js";
import type { CarryOutResult } from "./carry-out.js";

/** The statuses a call may propose, as `update_task_status` lists them. */
export const PROPOSABLE_STATUSES = ["pending", "in_progress", "completed", "failing", "deferred", "blocked", "cancelled", "deleted"] as const;

const isStatus = (value: unknown): value is SidecarStatusChange["to"] => (PROPOSABLE_STATUSES as readonly unknown[]).includes(value);

/** A `propose_status` call read against the PRD for its card, or why no card can be raised. Writes nothing. */
export async function readStatusCall(rexDir: string, input: Record<string, unknown>): Promise<SidecarStatusChange | string> {
  const itemId = typeof input.id === "string" ? input.id.trim() : "";
  if (!itemId) return "a status change names the item (id)";
  if (!isStatus(input.status)) return `status must be one of ${PROPOSABLE_STATUSES.join(", ")}`;
  if (input.reason !== undefined && typeof input.reason !== "string") return "reason must be a string";
  const item = findItemByRef((await (await resolveStore(rexDir)).loadDocument()).items, itemId);
  if (!item) return `no item ${itemId}`;
  if (item.status === input.status) return `${item.id} is already ${item.status}`;
  const transition = validateTransition(item.status, input.status);
  return {
    itemId: item.id,
    itemTitle: item.title,
    from: item.status,
    to: input.status,
    ...(input.reason?.trim() && { reason: input.reason.trim() }),
    rule: transition.allowed ? { allowed: true } : { allowed: false, message: transition.message ?? "rex refuses this transition" },
  };
}

/** An approved status card's write through rex's `update_task_status`. Never throws. */
export async function writeStatusCard(ctx: { rexDir: string; projectDir: string }, change: SidecarStatusChange): Promise<CarryOutResult> {
  try {
    const store = await resolveStore(ctx.rexDir);
    const item = findItemByRef((await store.loadDocument()).items, change.itemId);
    if (!item) return { ok: false, text: `Nothing was written: item ${change.itemId} is no longer in the PRD.` };
    if (item.status !== change.from) {
      return { ok: false, text: `Nothing was written: ${item.id} is now ${item.status}, not ${change.from} as when the card was raised.` };
    }
    const result = await handleUpdateTaskStatus(
      store,
      ctx.projectDir,
      { id: item.id, status: change.to as ItemStatus, ...(change.reason && { reason: change.reason }) },
      { store: openClaimsStore(ctx.projectDir), worktreeRoot: resolveClaimHolder(ctx.projectDir).worktreeRoot },
    );
    const text = result.content.map((part) => ("text" in part ? part.text : "")).join("\n");
    if (result.isError) return { ok: false, text: `Nothing was written: ${text}` };
    refreshPRDCache(ctx.rexDir, await store.loadDocument());
    return { ok: true, text: `Status of ${item.id} (${item.title}): ${text}`, ids: [item.id] };
  } catch (err) {
    return { ok: false, text: `Nothing was written: ${errorMessage(err)}.` };
  }
}
