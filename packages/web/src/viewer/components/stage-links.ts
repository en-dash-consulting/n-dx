/**
 * The two small vertical buttons on the page edges that step around the loop:
 * Analysis → Plan → Work → Analysis. Shown on every page that belongs to a
 * stage, so the next move is always one click away. On a scoped viewer with a
 * single stage there is nowhere to step to, and nothing is shown.
 */

import { h } from "preact";
import type { ViewId, StageId } from "../api.js";
import { STAGES, visibleStages } from "../api.js";

export interface StageLinksProps {
  stage: StageId | null;
  validViews: ReadonlySet<ViewId>;
  onNavigate: (view: ViewId) => void;
}

export function StageLinks({ stage, validViews, onNavigate }: StageLinksProps) {
  if (!stage) return null;
  // Step only through the stages this viewer has; wrap within them.
  const stages = visibleStages(validViews);
  if (stages.length < 2 || !stages.includes(stage)) return null;
  const i = stages.indexOf(stage);
  const prev = stages[(i + stages.length - 1) % stages.length];
  const next = stages[(i + 1) % stages.length];

  const link = (dir: "prev" | "next", target: StageId) =>
    h("button", {
      type: "button",
      class: `stage-link stage-link-${dir}`,
      "data-stage": target,
      onClick: () => onNavigate(target),
      title: `${dir === "prev" ? "Previous" : "Next"} stage: ${STAGES[target].label}`,
      "aria-label": `${dir === "prev" ? "Previous" : "Next"} stage: ${STAGES[target].label}`,
    },
      dir === "prev" ? h("span", { class: "stage-link-arrow", "aria-hidden": "true" }, "←") : null,
      h("span", { class: "stage-link-dir", "aria-hidden": "true" }, dir),
      h("span", { class: "stage-link-name", "aria-hidden": "true" }, STAGES[target].label),
      dir === "next" ? h("span", { class: "stage-link-arrow", "aria-hidden": "true" }, "→") : null,
    );

  return h("div", { class: "stage-links", role: "group", "aria-label": "Stage navigation" },
    link("prev", prev),
    link("next", next),
  );
}
