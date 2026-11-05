/**
 * The link card (story 44): what a `propose_link` call proposes, read before
 * the card is raised, and the write an approval makes.
 *
 * The agent names an item and a work ref. The card shows the item's title and
 * the ref as the tracker's label reads it; only Approve writes, through the
 * same `changeItemLink` the dashboard's Link control uses, so a v2 item gets
 * the ref in its `issues` and a v1 item in `links[]`. A call that cannot be
 * written (no such item, a ref that is no tracker key or URL, a ref the item
 * already has) raises no card.
 */

import type { CarryOutResult } from "../sidecar/carry-out.js";
import { workspaceConnectionService } from "../connections/connection-service.js";
import { resolveStore } from "../rex-gateway.js";
import type { SidecarLink } from "../../shared/index.js";
import type { ServerContext } from "../types.js";
import { changeItemLink, findItemByRef, linkRefProblem } from "./item-links.js";
import { itemLinkRefs } from "./link-refs.js";
import { connectionsTrackerLabel } from "./tracker-label.js";


/** A `propose_link` call read against the PRD for its card, or why no card can be raised. Writes nothing. */
export async function readLinkCall(ctx: Pick<ServerContext, "rexDir" | "projectDir">, input: Record<string, unknown>): Promise<SidecarLink | string> {
  const itemId = typeof input.itemId === "string" ? input.itemId.trim() : "";
  if (!itemId) return "a link names the item (itemId)";
  const checked = linkRefProblem(input.ref);
  if ("error" in checked) return checked.error;
  const item = findItemByRef((await (await resolveStore(ctx.rexDir)).loadDocument()).items, itemId);
  if (!item) return `no item ${itemId}`;
  if (itemLinkRefs(item as { issues?: unknown; links?: unknown }).includes(checked.ref)) return `${itemId} already links to ${checked.ref}`;
  return { itemId: item.id, title: item.title, ref: checked.ref, label: connectionsTrackerLabel(workspaceConnectionService(ctx.projectDir)) };
}

/** An approved link card's write. Never throws. */
export async function writeLinkCard(ctx: Pick<ServerContext, "rexDir">, link: SidecarLink): Promise<CarryOutResult> {
  const written = await changeItemLink(ctx.rexDir, link.itemId, link.ref, "link");
  if (!written.ok) return { ok: false, text: `Nothing was written: ${written.error}.` };
  return {
    ok: true,
    text: written.changed ? `Linked ${link.itemId} (${link.title}) to ${link.ref}.` : `${link.itemId} already linked to ${link.ref}; nothing changed.`,
    ids: [link.itemId],
  };
}
