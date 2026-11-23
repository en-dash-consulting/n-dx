/**
 * Plan's three glance cards, the questions the page exists for: what you are
 * working on, what matters most right now, and what is next for the product.
 *
 * All three read Plan's one change summary (`useChangesSummary`): the placed
 * open changes with their stage, priority, release and assignees, and rex's
 * next pick. "You" is the current user as `ndx work --mine` resolves them
 * (`usePeople`). Each card's title opens its change in the Tasks tree.
 *
 * @module viewer/views/plan-glance
 */

import { h } from "preact";
import type { NavigateTo } from "../types.js";
import { displayTitle, isMine, personLabel, titleTooltip, usePeople } from "../components/index.js";
import { useChangesSummary } from "./changes-summary-context.js";
import { usePlanView } from "./plan-view-state.js";
import {
  CHANGE_STAGE_LABELS,
  UNSCHEDULED_RELEASE_LABEL,
  groupGlanceByRelease,
  orderChanges,
  type ChangeSummary,
  type GlanceChange,
} from "./product-model.js";

export interface PlanGlanceModel {
  /** Your change in progress, else your next open one; null when nothing open is yours. */
  mine: { change: GlanceChange; active: boolean } | null;
  /** The open change that leads by `compareChangeOrder`. */
  top: GlanceChange | null;
  /** The release the next work ships in, and how much is still open in it. */
  release: { label: string; open: number; inProgress: number } | null;
  /** How many placed changes are open, and in how many releases. */
  openCount: number;
  next: ChangeSummary["next"];
}

/** Whether the change, or one of its open tasks, is assigned to `me`. */
export function isMyChange(change: GlanceChange, me: string | null): boolean {
  return isMine(change.assignee, me) || (change.taskAssignees ?? []).some((a) => isMine(a, me));
}

/** The cards' content, from the summary and the current user. */
export function planGlanceModel(summary: ChangeSummary, me: string | null): PlanGlanceModel {
  const ordered = orderChanges(summary.open);
  const mineAll = ordered.filter((c) => isMyChange(c, me));
  const active = mineAll.find((c) => c.stage === "in-progress");
  const first = active ?? mineAll[0];
  const group = groupGlanceByRelease(summary.open).find((g) => g.label !== UNSCHEDULED_RELEASE_LABEL);
  return {
    mine: first ? { change: first, active: !!active } : null,
    top: ordered[0] ?? null,
    release: group
      ? { label: group.label, open: group.changes.length, inProgress: group.changes.filter((c) => c.stage === "in-progress").length }
      : null,
    openCount: summary.open.length,
    next: summary.next,
  };
}

function ChangeLine({ change }: { change: GlanceChange }) {
  return h("div", { class: "plan-glance-meta" },
    change.displayId ? h("span", { class: "plan-glance-id" }, change.displayId) : null,
    h("span", { class: `plan-glance-stage plan-glance-stage--${change.stage}` }, CHANGE_STAGE_LABELS[change.stage]),
    change.priority ? h("span", { class: `prd-priority-badge prd-priority-${change.priority}` }, change.priority) : null,
  );
}

function ChangeTitle({ change, onOpen }: { change: GlanceChange; onOpen: () => void }) {
  return h("button", { type: "button", class: "plan-glance-title", title: titleTooltip(change), onClick: onOpen }, displayTitle(change));
}

export function PlanGlance({ navigateTo }: { navigateTo: NavigateTo }) {
  const load = useChangesSummary();
  const people = usePeople();
  // Solo: everything is yours, so the cards name nobody.
  const solo = usePlanView().mode === "solo";
  if (load.state === "loading") return h("p", { class: "plan-glance-empty", role: "status" }, "Loading…");
  if (load.state === "error") return h("p", { class: "plan-glance-empty" }, `Could not read the open changes: ${load.message}`);
  // The band is v2-only; a v1 tree has no changes to glance at.
  if (load.state === "v1") return null;
  const me = people?.me ?? null;
  const model = planGlanceModel(load.data, me);
  // As the open-changes glance does: the change, selected in the Tasks tree.
  const openChange = (change: GlanceChange) => navigateTo("prd", { taskId: change.id });

  return h("div", { class: "plan-glance", role: "list" },
    h("article", { class: "plan-glance-card", role: "listitem", "aria-labelledby": "plan-glance-mine" },
      h("h3", { class: "plan-glance-label", id: "plan-glance-mine" }, model.mine?.active === false ? "Next for you" : "You're working on"),
      model.mine
        ? [
            h(ChangeTitle, { key: "t", change: model.mine.change, onOpen: () => openChange(model.mine!.change) }),
            h(ChangeLine, { key: "m", change: model.mine.change }),
            model.next && model.next.changeId === model.mine.change.id && model.next.type !== "change"
              ? h("p", { key: "n", class: "plan-glance-note" }, `Next task: ${model.next.title}`)
              : null,
          ]
        : h("p", { class: "plan-glance-note" },
            me ? "Nothing open is assigned to you." : "n-dx could not tell who you are; set your git user to see your work."),
    ),
    h("article", { class: "plan-glance-card plan-glance-card--top", role: "listitem", "aria-labelledby": "plan-glance-top" },
      h("h3", { class: "plan-glance-label", id: "plan-glance-top" }, "Highest priority"),
      model.top
        ? [
            h(ChangeTitle, { key: "t", change: model.top, onOpen: () => openChange(model.top!) }),
            h(ChangeLine, { key: "m", change: model.top }),
            h("p", { key: "w", class: "plan-glance-note" },
              model.top.prioritized
                ? "Marked prioritized, so it leads the queue."
                : solo
                  ? "Sorted to the top by priority."
                  : model.top.assignee
                  ? `Sorted to the top by priority. Assigned to ${personLabel(model.top.assignee)}.`
                  : "Sorted to the top by priority. Nobody is assigned yet."),
          ]
        : h("p", { class: "plan-glance-note" }, "No open changes."),
    ),
    h("article", { class: "plan-glance-card plan-glance-card--next", role: "listitem", "aria-labelledby": "plan-glance-next" },
      h("h3", { class: "plan-glance-label", id: "plan-glance-next" }, "What's next for the product"),
      h("p", { class: "plan-glance-headline" }, model.release ? model.release.label : "No release planned"),
      h("p", { class: "plan-glance-note" },
        model.release
          ? `${model.release.open} open ${model.release.open === 1 ? "change" : "changes"} in it, ${model.release.inProgress} in progress · ${model.openCount} open in all`
          : `${model.openCount} open ${model.openCount === 1 ? "change" : "changes"}; set a planned release to see a target here.`),
      model.next
        ? h("p", { class: "plan-glance-next" },
            h("span", { class: "plan-glance-next-label" }, "Next up"),
            h("span", { class: "plan-glance-next-title", title: model.next.summary }, model.next.title),
          )
        : null,
    ),
  );
}
