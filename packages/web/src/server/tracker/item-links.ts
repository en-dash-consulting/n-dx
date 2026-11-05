/**
 * Link a rex item to a tracker work item, or remove the link.
 *
 * One write behind the dashboard's Link and Unlink controls
 * (`routes-rex/items.ts`) and the Sidecar's `propose_link` card, so the two
 * cannot disagree about where a link lives: a v2 tree holds it in the item's
 * `issues`, a v1 tree in its `links[]` (see `shared/tracker-link.ts`). It goes
 * through the store's transaction, under the PRD lock, like every other item
 * edit; rex itself is not extended.
 */

import { errorMessage } from "../response-utils.js";
import { findItem, isChangeLayerStore, resolveStore, updateInTree, type PRDItem } from "../rex-gateway.js";
import { refreshPRDCache } from "../prd-io.js";
import { itemLinkRefs, linkPatch, normalizeWorkRef, unlinkPatch, type LinkFields } from "./link-refs.js";

export type LinkAction = "link" | "unlink";

export type ItemLinkResult =
  | { ok: true; changed: boolean; title: string; refs: string[] }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** The work ref `value` names, or why it is none. */
export function linkRefProblem(value: unknown): { ref: string } | { error: string } {
  const ref = normalizeWorkRef(value);
  return ref ? { ref } : { error: `"ref" must be a tracker key (WM-2054) or an http(s) URL` };
}

/** Add or remove `ref` on the item. Linking a ref the item has, or unlinking one it lacks, writes nothing. */
export async function changeItemLink(
  rexDir: string,
  itemId: string,
  value: unknown,
  action: LinkAction,
): Promise<ItemLinkResult> {
  const checked = linkRefProblem(value);
  if ("error" in checked) return { ok: false, status: 400, error: checked.error };
  const { ref } = checked;
  try {
    const store = await resolveStore(rexDir);
    const v2 = isChangeLayerStore(store);
    let outcome: { changed: boolean; title: string; refs: string[] } | undefined;
    await store.withTransaction(async (doc) => {
      const entry = findItem(doc.items, itemId);
      if (!entry) return;
      const fields = entry.item as PRDItem & LinkFields;
      const patch = action === "link" ? linkPatch(fields, ref, v2) : unlinkPatch(fields, ref);
      if (patch && updateInTree(doc.items, itemId, patch as Partial<PRDItem>)) {
        outcome = { changed: true, title: entry.item.title, refs: itemLinkRefs({ ...fields, ...patch }) };
      } else {
        outcome = { changed: false, title: entry.item.title, refs: itemLinkRefs(fields) };
      }
    });
    if (!outcome) return { ok: false, status: 404, error: `Item "${itemId}" not found` };
    if (outcome.changed) refreshPRDCache(rexDir, await store.loadDocument());
    return { ok: true, ...outcome };
  } catch (err) {
    const message = errorMessage(err);
    // The PRD lock names its holder's PID: pass it through rather than retrying.
    return { ok: false, status: message.includes("Could not acquire PRD lock") ? 409 : 400, error: message };
  }
}
