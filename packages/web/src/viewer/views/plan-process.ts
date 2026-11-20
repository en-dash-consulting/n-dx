/**
 * Plan's process band: how planning works, as five steps in order —
 * capture → place → ready → work → apply — each saying in one line what the
 * user does there and linking to where it is done.
 *
 * It reads the same change summary as the lifecycle strip beside it
 * (`ChangesSummaryProvider`) and marks the one step the project needs most
 * with a "Do this next" cue. The strip says how much sits in each stage; this
 * band says what to do about it, so it complements the counts rather than
 * repeating them. A v1 tree has no Inbox, placement or apply, so the band is
 * v2 only.
 *
 * @module viewer/views/plan-process
 */

import { h } from "preact";
import type { NavigateTo } from "../types.js";
import { stageFilter, storeFilter } from "./changes.js";
import { useChangesSummary } from "./changes-summary-context.js";
import type { ChangeSummary } from "./product-model.js";

export type ProcessStepId = "capture" | "place" | "ready" | "work" | "apply";

export interface ProcessStep {
  id: ProcessStepId;
  label: string;
  /** One line: what the user does at this step. */
  does: string;
}

/** The planning process, in order. */
export const PROCESS_STEPS: readonly ProcessStep[] = [
  { id: "capture", label: "Capture", does: "Describe an idea in the Describe a change tile; it lands in the Inbox" },
  { id: "place", label: "Place", does: "Put each Inbox change on the capability it touches" },
  { id: "ready", label: "Ready", does: "Mark a placed change ready: give it an automated requirement, then run rex ready" },
  { id: "work", label: "Work", does: "Run the next pick in Work" },
  { id: "apply", label: "Apply", does: "Apply a finished change to the product map" },
];

export interface ProcessFocus {
  step: ProcessStepId;
  /** The "Do this next" line, with the count that called for it. */
  cue: string;
}

const changes = (n: number): string => `${n.toLocaleString()} ${n === 1 ? "change" : "changes"}`;

/** The Ready cue: ask for a requirement only while some open change lacks one. */
function readyCue(summary: ChangeSummary): string {
  const placed = `${changes(summary.stages.proposed)} placed but not marked ready`;
  const { uncovered } = summary.requirements;
  return uncovered > 0
    ? `${placed}: add an automated requirement to the ${uncovered.toLocaleString()} without one, then run rex ready`
    : `${placed}: run rex ready`;
}

/**
 * The step the project needs most. Finishing beats starting: done work waiting
 * for a steward to apply it comes first (under `rex.applyOn: release` it waits
 * for the release instead, and ranks last), then Inbox changes waiting for a place, then work
 * — changes marked ready, work already running, or rex's next pick — and only
 * then placed changes not marked ready. With nothing open, the next thing to do
 * is capture an idea.
 *
 * Ready is informational: `ndx work` runs a Proposed change too, so it is rex's
 * next pick whenever one is free. Marking changes ready only ranks first when
 * there is nothing to run.
 *
 * Inbox changes also counted in a stage have no capability to go on yet, so
 * they do not call for placing.
 */
export function processFocus(summary: ChangeSummary): ProcessFocus {
  const { stages } = summary;
  const placeable = Math.max(0, summary.inbox - summary.inboxInStage);
  const awaiting = stages["awaiting-apply"];
  // Under `rex.applyOn: release` the next `rex release` applies them: nothing
  // to do by hand, so they rank last, ahead only of an empty project.
  const atRelease = summary.applyOn === "release";
  if (awaiting > 0 && !atRelease) {
    return { step: "apply", cue: `${changes(awaiting)} done: apply ${awaiting === 1 ? "it" : "them"} to the product map` };
  }
  if (placeable > 0) {
    return { step: "place", cue: `${changes(placeable)} in the Inbox waiting for a place on the map` };
  }
  if (stages.ready > 0) {
    return { step: "work", cue: `${changes(stages.ready)} ready to run: start the next pick in Work` };
  }
  if (stages["in-progress"] > 0) {
    return { step: "work", cue: `${changes(stages["in-progress"])} in progress: follow ${stages["in-progress"] === 1 ? "it" : "them"} in Work` };
  }
  if (summary.next) {
    return { step: "work", cue: `rex's next pick is waiting: start "${summary.next.title}" in Work` };
  }
  if (stages.proposed > 0) {
    return { step: "ready", cue: readyCue(summary) };
  }
  if (awaiting > 0) {
    return { step: "apply", cue: `${changes(awaiting)} done: ${awaiting === 1 ? "it applies" : "they apply"} to the product map at the next rex release` };
  }
  return { step: "capture", cue: "Nothing open: describe the next idea in the Describe a change tile" };
}

/** Where each step is done. Capture is the Describe a change tile's input on Plan. */
export function openStep(step: ProcessStepId, navigateTo: NavigateTo, summary: ChangeSummary): void {
  switch (step) {
    case "capture": {
      const input = typeof document !== "undefined" ? document.querySelector<HTMLTextAreaElement>(".smart-add-textarea") : null;
      if (input) {
        input.scrollIntoView?.({ block: "center" });
        input.focus();
      } else {
        navigateTo("analysis");
      }
      return;
    }
    case "place": navigateTo("inbox"); return;
    case "ready": storeFilter(stageFilter("proposed")); navigateTo("changes"); return;
    case "work": navigateTo("work", summary.next ? { taskId: summary.next.id } : undefined); return;
    case "apply": storeFilter(stageFilter("awaiting-apply")); navigateTo("changes"); return;
  }
}

function Steps({ summary, navigateTo }: { summary: ChangeSummary; navigateTo: NavigateTo }) {
  const focus = processFocus(summary);
  return h("div", { class: "plan-process" },
    h("ol", { class: "pp-steps", "aria-label": "How planning works" },
      PROCESS_STEPS.map((step, i) => {
        const next = step.id === focus.step;
        const doesId = `pp-does-${step.id}`;
        return h("li", {
          key: step.id,
          class: next ? "pp-step pp-step--next" : "pp-step",
          "data-step": step.id,
          "aria-current": next ? "step" : undefined,
        },
          h("button", {
            type: "button",
            role: "link",
            class: "pp-link",
            "aria-describedby": doesId,
            onClick: () => openStep(step.id, navigateTo, summary),
          },
            h("span", { class: "pp-num", "aria-hidden": "true" }, String(i + 1)),
            h("span", { class: "pp-label" }, step.label),
            next ? h("span", { class: "pp-next-tag" }, "Do this next") : null,
          ),
          h("span", { class: "pp-does", id: doesId }, step.does),
        );
      }),
    ),
    h("p", { class: "pp-cue", "data-step": focus.step },
      h("span", { class: "pp-cue-label" }, "Do this next"),
      h("span", { class: "pp-cue-text" }, focus.cue),
    ),
  );
}

export function PlanProcess({ navigateTo }: { navigateTo: NavigateTo }) {
  const load = useChangesSummary();
  // The lifecycle strip beside it reports loading and errors; this band only
  // draws once there is a summary to read.
  return load.state === "ready" ? h(Steps, { summary: load.data, navigateTo }) : null;
}
