/**
 * Plan's Inbox side panel: the whole Inbox under Plan's For me / Everyone
 * (in place of the Inbox page's own assignee filter) and Solo / Team, each row
 * draggable onto a product area and offering "Plan in <area>" for its best
 * guess (`plan-placement.ts`).
 *
 * @module viewer/views/plan-inbox
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import type { NavigateTo } from "../types.js";
import { InboxPage } from "./inbox.js";
import type { InboxRow } from "./inbox-read.js";
import { ScopeToggle } from "./plan-controls.js";
import { placeTouches } from "./plan-placement.js";
import { usePlanView } from "./plan-view-state.js";
import type { PlacementCandidate } from "./product-model.js";

export function PlanInbox({ navigateTo }: { navigateTo: NavigateTo }) {
  const view = usePlanView();
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const solo = view.mode === "solo";

  const planIn = async (row: InboxRow, candidate: PlacementCandidate) => {
    const answer = await placeTouches(row.change.id, candidate.target);
    setNote(answer.ok
      ? { text: `Planned "${row.change.title}" in ${candidate.area} (${candidate.title}).`, error: false }
      : { text: `Could not plan "${row.change.title}": ${answer.message}`, error: true });
  };

  return h("div", { class: "plan-inbox" },
    h("div", { class: "plan-inbox-toolbar" },
      h(ScopeToggle, null),
      h("p", { class: "plan-inbox-hint" },
        solo
          ? "Sorted by priority. Plan anything straight onto the map: drag it onto an area, or press Plan in."
          : "Sorted by priority. Drag an item onto a product area, or press Plan in, to place it there."),
    ),
    note ? h("p", { class: note.error ? "plan-areas-note plan-areas-note--error" : "plan-areas-note", role: note.error ? "alert" : "status" }, note.text) : null,
    h(InboxPage, {
      navigateTo,
      plan: {
        scope: solo ? "all" : view.scope,
        hideAssignees: solo,
        dragToPlan: true,
        onPlanIn: (row, candidate) => void planIn(row, candidate),
      },
    }),
  );
}
