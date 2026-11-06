/**
 * Plan's lifecycle strip: where the work is, and what rex would pick next.
 *
 * On v2 it reads rex's change stages from `GET /api/rex/changes/summary`
 * (read once for the Plan grid by `ChangesSummaryProvider`) —
 * Inbox, Proposed, Ready, In progress, Awaiting apply — each a count that opens
 * the list it counts (Inbox: the Inbox page; the rest: Open changes filtered to
 * the stage). On v1, which has no stages, it reads Pending and In progress from
 * project status. Then the next pick: its title and rex's reason, linking to
 * Work with the item selected. Starting a run is Work's job, so the strip has
 * no Start or Run control.
 *
 * @module viewer/views/lifecycle-strip
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import { useProjectStatus } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";
import { stageFilter, storeFilter } from "./changes.js";
import { useChangesSummary } from "./changes-summary-context.js";
import type { ChangeSummary, NextPick, OpenChangeStage } from "./product-model.js";

/** Where a count opens. */
export type StripTarget =
  | { view: "inbox" }
  | { view: "changes"; stage: OpenChangeStage }
  | { view: "prd" };

export interface StripCell {
  key: string;
  label: string;
  count: number;
  target: StripTarget;
  /** Said under the count when it is zero. */
  hintWhenZero?: boolean;
}

/** The strip's short stage names; Open changes spells "awaiting-apply" out in full. */
const STAGE_CELLS: ReadonlyArray<{ stage: OpenChangeStage; label: string }> = [
  { stage: "proposed", label: "Proposed" },
  { stage: "ready", label: "Ready" },
  { stage: "in-progress", label: "In progress" },
  { stage: "awaiting-apply", label: "Awaiting apply" },
];

/** The five v2 counts, in lifecycle order. */
export function v2Cells(summary: ChangeSummary): StripCell[] {
  return [
    { key: "inbox", label: "Inbox", count: summary.inbox, target: { view: "inbox" } },
    ...STAGE_CELLS.map(({ stage, label }): StripCell => ({
      key: stage,
      label,
      count: summary.stages[stage],
      target: { view: "changes", stage },
      hintWhenZero: stage === "ready",
    })),
  ];
}

/** The v1 counts: a tree has no stages, only item statuses. */
export function v1Cells(pending: number, inProgress: number): StripCell[] {
  return [
    { key: "pending", label: "Pending", count: pending, target: { view: "prd" } },
    { key: "in-progress", label: "In progress", count: inProgress, target: { view: "prd" } },
  ];
}

function open(navigateTo: NavigateTo, target: StripTarget): void {
  if (target.view === "changes") storeFilter(stageFilter(target.stage));
  navigateTo(target.view);
}

function Count({ cell, navigateTo }: { cell: StripCell; navigateTo: NavigateTo }) {
  return h("li", { class: "ls-cell", "data-stage": cell.key },
    h("button", {
      type: "button",
      class: "ls-count",
      onClick: () => open(navigateTo, cell.target),
    },
      h("span", { class: "ls-number" }, cell.count.toLocaleString()),
      h("span", { class: "ls-label" }, cell.label),
    ),
    cell.hintWhenZero && cell.count === 0
      ? h("span", { class: "ls-hint" }, "needs an automated requirement · ", h("code", null, "rex ready"))
      : null,
  );
}

function Next({ pick, title, navigateTo }: {
  pick: NextPick | null;
  /** v1 only knows the title. */
  title?: string | null;
  navigateTo: NavigateTo;
}) {
  const shown = pick?.title ?? title ?? null;
  if (!shown) return h("div", { class: "ls-next ls-next-none" }, h("span", { class: "ls-next-label" }, "Next"), "Nothing to pick up");
  return h("div", { class: "ls-next" },
    h("span", { class: "ls-next-label" }, "Next"),
    h("button", {
      type: "button",
      class: "ls-next-link",
      onClick: () => navigateTo("work", pick ? { taskId: pick.id } : undefined),
    }, shown),
    pick ? h("span", { class: "ls-next-why" }, pick.summary) : null,
  );
}

function Strip({ cells, next, navigateTo }: { cells: StripCell[]; next: ComponentChild; navigateTo: NavigateTo }) {
  return h("div", { class: "lifecycle-strip" },
    h("ul", { class: "ls-cells" }, cells.map((cell) => h(Count, { key: cell.key, cell, navigateTo }))),
    next,
  );
}

export function LifecycleStrip({ navigateTo }: { navigateTo: NavigateTo }) {
  const load = useChangesSummary();
  const status = useProjectStatus();

  if (load.state === "ready") {
    return h(Strip, { cells: v2Cells(load.data), next: h(Next, { pick: load.data.next, navigateTo }), navigateTo });
  }
  if (load.state === "v1") {
    const stats = status?.rex.stats;
    if (!stats) return null;
    return h(Strip, {
      cells: v1Cells(stats.pending, stats.inProgress),
      next: h(Next, { pick: null, title: status?.rex.nextTaskTitle, navigateTo }),
      navigateTo,
    });
  }
  return load.state === "loading"
    ? h("div", { class: "lifecycle-strip lifecycle-strip-pending", role: "status" }, "Loading...")
    : h("div", { class: "lifecycle-strip", role: "alert" }, `Could not load the lifecycle: ${load.message}`);
}
