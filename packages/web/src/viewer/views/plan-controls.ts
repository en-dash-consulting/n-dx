/**
 * Plan's filter controls, shared by the product areas and the Inbox panel:
 * For me / Everyone (whose work the page shows) and the stage chips (which
 * stage it focuses on). Both write the shared view (`plan-view-state.ts`), so
 * setting one anywhere sets it everywhere.
 *
 * @module viewer/views/plan-controls
 */

import { h } from "preact";
import { setPlanView, usePlanView } from "./plan-view-state.js";
import type { OpenChangeStage } from "./product-model.js";

/** The stages a chip can focus, in the order work moves through them. */
export const STAGE_CHIPS: ReadonlyArray<{ stage: OpenChangeStage; label: string }> = [
  { stage: "proposed", label: "Proposed" },
  { stage: "ready", label: "Ready" },
  { stage: "in-progress", label: "In progress" },
  { stage: "awaiting-apply", label: "Awaiting apply" },
];

/** For me / Everyone: two toggle buttons. Hidden in Solo, where all work is yours. */
export function ScopeToggle() {
  const view = usePlanView();
  if (view.mode === "solo") return null;
  const button = (scope: "me" | "all", label: string) =>
    h("button", {
      type: "button",
      class: view.scope === scope ? "plan-seg plan-seg--on" : "plan-seg",
      "aria-pressed": String(view.scope === scope),
      "data-scope": scope,
      onClick: () => setPlanView({ scope }),
    }, label);
  return h("div", { class: "plan-segmented", role: "group", "aria-label": "Whose work" },
    button("me", "For me"),
    button("all", "Everyone"),
  );
}

/** One chip per stage with its count; pressing the focused one again clears it, as Show all does. */
export function StageChips({ counts }: { counts: Readonly<Record<OpenChangeStage, number>> }) {
  const view = usePlanView();
  return h("div", { class: "plan-stage-chips", role: "group", "aria-label": "Focus on a stage" },
    STAGE_CHIPS.map(({ stage, label }) => {
      const on = view.stage === stage;
      return h("button", {
        key: stage,
        type: "button",
        class: on ? "plan-stage-chip plan-stage-chip--on" : "plan-stage-chip",
        "aria-pressed": String(on),
        "data-stage": stage,
        onClick: () => setPlanView({ stage: on ? null : stage }),
      },
        h("span", { class: "plan-stage-chip-label" }, label),
        h("span", { class: "plan-stage-chip-count" }, String(counts[stage] ?? 0)),
      );
    }),
    view.stage
      ? h("button", { type: "button", class: "plan-show-all", onClick: () => setPlanView({ stage: null }) }, "Show all")
      : null,
  );
}
