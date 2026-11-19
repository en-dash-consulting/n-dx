/**
 * The Analyze dashboard's Recommended fixes tile: every item the analysis
 * recommends fixing — next steps, readiness gaps, problems, suggestions,
 * architecture findings and files to move — each with its fix and "+ PRD".
 *
 * The list is filtered by what was pressed in the visuals tile beside it (a
 * stat card or a "!" zone) and highlights what is hovered there; the filter
 * chip clears it. Hovering an item lights its zones on the codebase map.
 * Opened, every item shows its fix, with "Add all", "Copy next steps" and
 * links to the Problems and Suggestions views.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import type { LoadedData, NavigateTo } from "../types.js";
import { ActionItemList } from "./action-items.js";
import { WithAnalyzeActions, useAnalyzeActions } from "./analyze-actions-context.js";

interface RecommendationsPanelProps {
  data: LoadedData;
  opened?: boolean;
  /** Leads "All problems" and "All suggestions" to their views. */
  navigateTo?: NavigateTo;
}

export function RecommendationsPanel(props: RecommendationsPanelProps): ComponentChild {
  return h(WithAnalyzeActions, { data: props.data }, h(RecommendationsBody, props));
}

function RecommendationsBody({ opened = false, navigateTo }: RecommendationsPanelProps): ComponentChild {
  const shared = useAnalyzeActions()!;
  const { recommendations } = shared;
  if (!shared.delivery && recommendations.items.length === 0 && recommendations.gated.length === 0) {
    return h("p", { class: "stage-tile-empty" }, "Loading…");
  }
  return h("div", { class: "recommendations-panel" },
    h(ActionItemList, {
      list: recommendations,
      focus: shared.focus,
      idBase: opened ? "recommendations-opened" : "recommendations",
      opened,
      onItemHover: shared.setHovered,
      capture: shared.capture,
      links: opened && navigateTo
        ? [
            { label: "All problems ↗", onClick: () => navigateTo("problems") },
            { label: "All suggestions ↗", onClick: () => navigateTo("suggestions") },
          ]
        : [],
    }),
  );
}
