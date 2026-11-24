/**
 * Plan › Create's How work moves band: the Inbox, then the stages a placed
 * open change moves through, each with its count under For me / Everyone, and
 * each a button that focuses the product areas and the Inbox panel on it
 * (`plan-controls.ts`, `plan-view-state.ts`).
 *
 * The stage counts come from Plan's one change summary; the Inbox count from
 * the change list, whose rows carry the assignees For me needs. An applied
 * change still flagged for placement is history, not Inbox work, and is not
 * counted (`isAppliedUnplaced`).
 *
 * @module viewer/views/plan-flow
 */

import { h } from "preact";
import { isMine, usePeople } from "../components/index.js";
import { useProductRead } from "../hooks/index.js";
import { useChangesSummary } from "./changes-summary-context.js";
import { isAppliedUnplaced } from "./inbox-read.js";
import { HowWorkMoves } from "./plan-controls.js";
import { filterForView, stageCounts } from "./plan-areas.js";
import { usePlanView, type PlanStage, type PlanViewState } from "./plan-view-state.js";
import { changeAssignees, type ChangeRow } from "./product-model.js";

/** Open Inbox changes the view lets through: yours under For me (Team), all of them otherwise. */
export function inboxInScope(
  changes: readonly ChangeRow[],
  view: Pick<PlanViewState, "scope" | "mode">,
  me: string | null,
): ChangeRow[] {
  return changes.filter((c) =>
    c.inbox && !isAppliedUnplaced(c)
    && (view.mode === "solo" || view.scope !== "me" || changeAssignees(c).some((a) => isMine(a, me))));
}

export function PlanFlow() {
  const summary = useChangesSummary();
  const changes = useProductRead("/api/rex/changes", (body) => body.changes as ChangeRow[]);
  const view = usePlanView();
  const people = usePeople();
  const me = people?.me ?? null;
  // The tile is v2-only; a v1 answer is a race with a migration.
  if (summary.state === "v1" || changes.state === "v1") return null;
  const counts: Record<PlanStage, number> | null = summary.state === "ready" && changes.state === "ready"
    ? {
        inbox: inboxInScope(changes.data, view, me).length,
        ...stageCounts(filterForView(summary.data.open, { ...view, stage: null }, me)),
      }
    : null;
  // A failed read says so; the stages still focus the page without their counts.
  const error = summary.state === "error"
    ? `Could not read the stage counts: ${summary.message}`
    : changes.state === "error"
      ? `Could not read the Inbox count: ${changes.message}`
      : null;
  return h(HowWorkMoves, { counts, error });
}
