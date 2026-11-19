/**
 * What the Analyze dashboard's tiles share about what to fix: the recommended
 * fixes, the zones the map marks with a "!", the element pressed or hovered on
 * the page (`focus`) and the item the pointer is over.
 *
 * The provider reads next steps and the delivery artifacts once for the grid.
 * The visuals tile's highlighted elements set `focus`, which filters and
 * highlights the Recommended fixes tile's list. Hovering an item there sets
 * `hovered`; the codebase map lights that item's zones and, when it touches
 * none it can draw or its remedy adds files, shows its note beside the map. A
 * panel rendered on its own (a test, the opened tile of a stage without the
 * provider) gets a provider of its own through `WithAnalyzeActions`.
 *
 * @module viewer/views/analyze-actions-context
 */

import { createContext, Fragment, h } from "preact";
import type { ComponentChild, ComponentChildren } from "preact";
import { useContext, useMemo, useState } from "preact/hooks";
import type { LoadedData } from "../types.js";
import { deliveryAnalysisStamp, useDeliveryData, type DeliveryData } from "./delivery.js";
import { useNextSteps } from "./next-steps.js";
import { isDeployedMode } from "../deployed-mode.js";
import {
  buildRecommendations,
  zoneIssues,
  useRecommendationCapture,
  useRecommendationFocus,
  type ActionItem,
  type RecommendationCapture,
  type RecommendationFocus,
  type ActionList,
  type ZoneMark,
} from "./action-items.js";

export interface AnalyzeActions {
  /** Every recommended fix: next steps, readiness gaps, findings and files to move. */
  recommendations: ActionList;
  /** The readiness score and infrastructure scan; null while loading. */
  delivery: DeliveryData | null;
  /** Zone id → its "!" on the map. */
  issues: Record<string, ZoneMark>;
  /** The page element hovered or pressed: highlights or filters the recommendations. */
  focus: RecommendationFocus;
  /** The item the pointer is over in the list. */
  hovered: ActionItem | null;
  setHovered: (item: ActionItem | null) => void;
  /** Adds recommendations to the PRD; null in a static export, which has no server. */
  capture: RecommendationCapture | null;
}

const AnalyzeActionsContext = createContext<AnalyzeActions | null>(null);

/** Reads next steps and the delivery artifacts once and shares the recommendations with the tiles beneath. */
export function AnalyzeActionsProvider({ data, children }: { data: LoadedData; children?: ComponentChildren }) {
  const steps = useNextSteps(5);
  const delivery = useDeliveryData(deliveryAnalysisStamp(data.manifest));
  const [hovered, setHovered] = useState<ActionItem | null>(null);
  const focus = useRecommendationFocus();
  const recommendationCapture = useRecommendationCapture();
  const capture = isDeployedMode() ? null : recommendationCapture;
  const recommendations = useMemo(
    () => buildRecommendations(data, steps, delivery?.readiness ?? null),
    [data.zones, data.manifest, steps, delivery],
  );
  const issues = useMemo(() => zoneIssues(data, recommendations.items), [data.zones, recommendations]);
  const value = useMemo(
    () => ({ recommendations, delivery, issues, focus, hovered, setHovered, capture }),
    [recommendations, delivery, issues, focus.hover, focus.filter, hovered, capture],
  );
  return h(AnalyzeActionsContext.Provider, { value }, children);
}

/** The shared recommendations, or null outside a provider. */
export function useAnalyzeActions(): AnalyzeActions | null {
  return useContext(AnalyzeActionsContext);
}

/** Renders `children` under the enclosing provider, or under one of its own when there is none. */
export function WithAnalyzeActions({ data, children }: { data: LoadedData; children?: ComponentChildren }): ComponentChild {
  return useAnalyzeActions() ? h(Fragment, null, children) : h(AnalyzeActionsProvider, { data }, children);
}
