/**
 * An unsaved placement kept as a draft (WF10). Leaving placement mode with a
 * pick or an edit in the form (Esc, the breadcrumb, another tab) keeps it for
 * the browser session in `sessionStorage`, one draft per change id. Place
 * resumes it at the step it was left with, edits in place.
 *
 * A draft is viewer state only: nothing reaches the PRD until Place. It is
 * dropped when the change is placed, by this form or by any other route (the
 * Inbox read prunes drafts of changes it no longer lists).
 *
 * @module viewer/components/prd-tree/placement-draft
 */

import type { PlacementRelation } from "../../views/product-model.js";
import type { CriterionDraft, PlacementTarget } from "./change-placement.js";

/** The place form as it was left: the chosen target, relation and amendment edits. */
export interface PlaceStepDraft {
  step: "place";
  target: PlacementTarget;
  relation: PlacementRelation | null;
  summary: string;
  proposed: string;
  criteria: CriterionDraft[];
}

/** The "Nothing fits" proposal form as it was left. */
export interface ProposeStepDraft {
  step: "propose";
  type: "capability" | "constraint";
  under: string;
  title: string;
  statement: string;
  criteria: string;
}

export type PlacementDraftState = PlaceStepDraft | ProposeStepDraft;

const PREFIX = "ndx.placement-draft.";
const key = (changeId: string) => `${PREFIX}${changeId}`;

/** `sessionStorage`, or null where it is blocked (a private window, site data off). */
function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The draft kept for `changeId`, or null. A value that does not parse is no draft. */
export function loadPlacementDraft(changeId: string): PlacementDraftState | null {
  const raw = store()?.getItem(key(changeId));
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as PlacementDraftState;
    return draft && (draft.step === "place" || draft.step === "propose") ? draft : null;
  } catch {
    return null;
  }
}

/** Keep `draft` for `changeId`; null drops it. Storage that is full or blocked keeps nothing. */
export function savePlacementDraft(changeId: string, draft: PlacementDraftState | null): void {
  const storage = store();
  if (!storage) return;
  try {
    if (draft) storage.setItem(key(changeId), JSON.stringify(draft));
    else storage.removeItem(key(changeId));
  } catch {
    // Quota or a blocked write: the draft is a convenience, so the form carries on without it.
  }
}

/** Drop the draft of `changeId` (it was placed). */
export function dropPlacementDraft(changeId: string): void {
  savePlacementDraft(changeId, null);
}

/** Drop every draft whose change is not in `waiting`: it was placed by some other route. */
export function prunePlacementDrafts(waiting: ReadonlySet<string>): void {
  const storage = store();
  if (!storage) return;
  const stale: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const name = storage.key(i);
    if (name?.startsWith(PREFIX) && !waiting.has(name.slice(PREFIX.length))) stale.push(name.slice(PREFIX.length));
  }
  for (const id of stale) dropPlacementDraft(id);
}

/** What an Inbox row says about a draft: "draft · amends Refunds", "draft · proposes Gift cards". */
export function placementDraftLabel(draft: PlacementDraftState): string {
  if (draft.step === "propose") return `draft · proposes ${draft.title.trim() || "a new home"}`;
  return `draft · ${draft.relation ? `${draft.relation} ` : ""}${draft.target.title}`;
}

/** The label of `changeId`'s draft, or null when it has none. */
export function placementDraftNote(changeId: string): string | null {
  const draft = loadPlacementDraft(changeId);
  return draft ? placementDraftLabel(draft) : null;
}
