/**
 * Plan's Inbox side panel: the whole Inbox under Plan's For me / Everyone
 * (in place of the Inbox page's own assignee filter) and Solo / Team, each row
 * draggable onto a product area and offering its best guess
 * (`plan-placement.ts`) as "Accept → <area>" in Team, where an owner accepts
 * work in, or "Plan in <area>" in Solo, where it goes straight onto the map.
 *
 * It follows How work moves (`plan-flow.ts`): focused on the Inbox it lists
 * every row as usual; focused on a later stage it lists nothing, since no
 * Inbox change has reached it, and offers Show all.
 *
 * @module viewer/views/plan-inbox
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import type { NavigateTo } from "../types.js";
import { InboxPage } from "./inbox.js";
import type { InboxRow } from "./inbox-read.js";
import { ScopeToggle, ShowAll, flowStageLabel } from "./plan-controls.js";
import { placeTouches } from "./plan-placement.js";
import { usePlanView, type PlanMode } from "./plan-view-state.js";
import type { PlacementCandidate } from "./product-model.js";
import type { StageSidePanel } from "./stages.js";

/**
 * Plan's heading for one of its side panels: the Inbox is "Your inbox" in Solo,
 * where all the work is yours; every other heading is the panel's own.
 */
export function planSidePanelTitle(panel: StageSidePanel, mode: PlanMode): string {
  return panel.id === "inbox" && mode === "solo" ? "Your inbox" : panel.title;
}

/** The hint over the list, in the design's words for each mode. */
export const PLAN_INBOX_HINT = {
  team: "Sorted by priority automatically. Owners accept and assign; critical findings rise to the top.",
  solo: "Sorted by priority. Plan anything straight onto the map — no hand-offs.",
} as const;

export function PlanInbox({ navigateTo }: { navigateTo: NavigateTo }) {
  const view = usePlanView();
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const solo = view.mode === "solo";
  const laterStage = view.stage !== null && view.stage !== "inbox" ? view.stage : null;

  const planIn = async (row: InboxRow, candidate: PlacementCandidate) => {
    const answer = await placeTouches(row.change.id, candidate.target);
    setNote(answer.ok
      ? { text: `${solo ? "Planned" : "Accepted"} "${row.change.title}" in ${candidate.area} (${candidate.title}).`, error: false }
      : { text: `Could not ${solo ? "plan" : "accept"} "${row.change.title}": ${answer.message}`, error: true });
  };

  return h("div", { class: "plan-inbox" },
    h("div", { class: "plan-inbox-toolbar" },
      h(ScopeToggle, null),
      h("p", { class: "plan-inbox-hint" }, solo ? PLAN_INBOX_HINT.solo : PLAN_INBOX_HINT.team),
    ),
    note ? h("p", { class: note.error ? "plan-areas-note plan-areas-note--error" : "plan-areas-note", role: note.error ? "alert" : "status" }, note.text) : null,
    laterStage
      ? h("div", { class: "empty-state inbox-empty plan-inbox-stage-empty", role: "status" },
          h("p", null, `Nothing in the Inbox is at ${flowStageLabel(laterStage)}: Inbox work has not been placed yet.`),
          h(ShowAll, null))
      : h(InboxPage, {
          navigateTo,
          plan: {
            scope: solo ? "all" : view.scope,
            hideAssignees: solo,
            dragToPlan: true,
            onPlanIn: (row, candidate) => void planIn(row, candidate),
            planInVerb: solo ? "plan" : "accept",
          },
        }),
  );
}
