/**
 * Plan's filter controls, shared by the product areas and the Inbox panel:
 * For me / Everyone (whose work the page shows) and How work moves (the stages
 * work passes through, each a button that focuses the page on it). Both write
 * the shared view (`plan-view-state.ts`), so setting one anywhere sets it
 * everywhere.
 *
 * @module viewer/views/plan-controls
 */

import { h } from "preact";
import { setPlanView, usePlanView, type PlanStage } from "./plan-view-state.js";

export interface FlowStage {
  stage: PlanStage;
  label: string;
  /** What happens to work at this stage, in a line. */
  sub: string;
  /** The line in Solo, where nobody hands work to anyone. */
  soloSub?: string;
}

/** The stages work moves through, in order: the Inbox, then a placed change's stages. */
export const FLOW_STAGES: readonly FlowStage[] = [
  { stage: "inbox", label: "Inbox", sub: "Bugs & requests come in", soloSub: "Your ideas & bugs" },
  { stage: "proposed", label: "Proposed", sub: "Placed, waiting for an owner to accept", soloSub: "Placed, waiting for you to accept" },
  { stage: "ready", label: "Ready", sub: "Accepted, ready for the agent" },
  { stage: "in-progress", label: "In progress", sub: "Task being executed" },
  { stage: "awaiting-apply", label: "Awaiting apply", sub: "Done, waiting to be applied" },
];

/** The label a stage is shown by. */
export function flowStageLabel(stage: PlanStage): string {
  return FLOW_STAGES.find((s) => s.stage === stage)?.label ?? stage;
}

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

/** Show all: clears the stage focus. Nothing while no stage is focused. */
export function ShowAll() {
  const view = usePlanView();
  return view.stage
    ? h("button", { type: "button", class: "plan-show-all", onClick: () => setPlanView({ stage: null }) }, "Show all")
    : null;
}

/**
 * How work moves: one button per stage with its count, an arrow between each;
 * pressing one focuses the areas and the Inbox panel on it, and pressing it
 * again, or Show all, clears the focus.
 */
export function HowWorkMoves({ counts, error }: { counts: Readonly<Record<PlanStage, number>> | null; error?: string | null }) {
  const view = usePlanView();
  const solo = view.mode === "solo";
  return h("div", { class: "plan-flow" },
    h("div", { class: "plan-flow-head" },
      h("h3", { class: "plan-flow-title", id: "plan-flow-title" }, "How work moves"),
      h("div", { class: "plan-flow-hint" },
        h("span", null, "Click a stage to focus on it"),
        h(ShowAll, null),
      ),
    ),
    h("ol", { class: "plan-flow-stages", "aria-labelledby": "plan-flow-title" },
      FLOW_STAGES.map(({ stage, label, sub, soloSub }, i) => {
        const on = view.stage === stage;
        return h("li", { key: stage, class: "plan-flow-step" },
          h("button", {
            type: "button",
            class: on ? "plan-flow-stage plan-flow-stage--on" : "plan-flow-stage",
            "aria-pressed": String(on),
            "data-stage": stage,
            onClick: () => setPlanView({ stage: on ? null : stage }),
          },
            h("span", { class: "plan-flow-stage-top" },
              h("span", { class: "plan-flow-stage-label" }, label),
              h("span", { class: "plan-flow-stage-count" }, counts ? String(counts[stage] ?? 0) : "…"),
            ),
            h("span", { class: "plan-flow-stage-sub" }, solo && soloSub ? soloSub : sub),
          ),
          i < FLOW_STAGES.length - 1 ? h("span", { class: "plan-flow-arrow", "aria-hidden": "true" }, "→") : null,
        );
      }),
    ),
    error ? h("p", { class: "plan-flow-error", role: "alert" }, error) : null,
  );
}
