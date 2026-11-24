/**
 * Placing an Inbox change from Plan in one move: by an Inbox row's "Plan in
 * <area>" button, or by dragging the row onto a product-area box.
 *
 * Both record a `touches` placement through the same route placement mode
 * uses (`POST /api/rex/changes/:id/place`); an `amends` needs the statement or
 * criteria it changes, which only the placement form can collect. A drop on an
 * area the change's shortlist has no candidate in opens placement mode
 * instead. The server announces `rex:prd-changed`, so the Inbox and the area
 * boxes read again on their own.
 *
 * A drag carries the change in the event (`PLAN_DRAG_TYPE`) and in a
 * module-level note of the row being dragged, whose shortlist the drop reads;
 * `plan-drag` window events tell the side panel to step aside meanwhile.
 *
 * @module viewer/views/plan-placement
 */

import type { InboxRow } from "./inbox-read.js";
import type { PlacementCandidate } from "./product-model.js";

/** The data type a dragged Inbox row carries: the change id. */
export const PLAN_DRAG_TYPE = "application/x-ndx-change";

/** The window event a drag start and end dispatch; `detail.active` says which. */
export const PLAN_DRAG_EVENT = "ndx:plan-drag";

export type PlaceAnswer = { ok: true } | { ok: false; message: string };

/** Record a `touches` placement of `changeId` on `target`. */
export async function placeTouches(changeId: string, target: string): Promise<PlaceAnswer> {
  try {
    const res = await fetch(`/api/rex/changes/${encodeURIComponent(changeId)}/place`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, relation: "touches" }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => null) as { error?: unknown } | null;
    return { ok: false, message: typeof body?.error === "string" ? body.error : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** The shortlist a row has read, best first; empty while it loads or when it failed. */
export function rowCandidates(row: InboxRow): readonly PlacementCandidate[] {
  return row.shortlist && "placement" in row.shortlist ? row.shortlist.placement.shortlist : [];
}

/** The best candidate that sits in the named area, or null when the shortlist has none there. */
export function candidateInArea(candidates: readonly PlacementCandidate[], areaTitle: string): PlacementCandidate | null {
  return candidates.find((c) => c.area === areaTitle) ?? null;
}

/** The row being dragged from the Inbox, while a drag is in flight. */
let dragged: InboxRow | null = null;

export function draggedRow(): InboxRow | null {
  return dragged;
}

function announce(active: boolean): void {
  window.dispatchEvent(new CustomEvent(PLAN_DRAG_EVENT, { detail: { active } }));
}

/** A row's drag starts: note it, carry its id, and tell the page. */
export function startPlanDrag(row: InboxRow, e: DragEvent): void {
  dragged = row;
  try {
    e.dataTransfer?.setData(PLAN_DRAG_TYPE, row.change.id);
    e.dataTransfer?.setData("text/plain", row.change.title);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  } catch { /* a synthetic event without a data transfer still drags by the note */ }
  announce(true);
}

/** The drag ends, dropped or not. */
export function endPlanDrag(): void {
  dragged = null;
  announce(false);
}

/** Whether a drag event carries an Inbox row (its data types are readable before the drop). */
export function carriesInboxRow(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  return dragged !== null || (!!types && Array.from(types).includes(PLAN_DRAG_TYPE));
}
