/**
 * What the Analyze dashboard's tiles share about what to do: the Codebase
 * health list, the Infrastructure & architecture list, the zones the map marks
 * with a "!", and the item the pointer is over.
 *
 * The provider reads next steps and the delivery artifacts once for the grid.
 * Hovering an item in either list sets `hovered`; the codebase map lights that
 * item's zones and, when it touches none it can draw or its remedy adds files,
 * shows its note beside the map. A panel rendered on its own (a test, the
 * opened tile of a stage without the provider) gets a provider of its own
 * through `WithAnalyzeActions`.
 *
 * @module viewer/views/analyze-actions-context
 */

import { createContext, Fragment, h } from "preact";
import type { ComponentChild, ComponentChildren } from "preact";
import { useContext, useMemo, useState } from "preact/hooks";
import type { LoadedData } from "../types.js";
import { deliveryAnalysisStamp, useDeliveryData, type DeliveryData } from "./delivery.js";
import { useNextSteps } from "./next-steps.js";
import {
  buildHealthActions,
  buildInfraActions,
  zoneIssues,
  type ActionItem,
  type ActionList,
  type ZoneMark,
} from "./action-items.js";

export interface AnalyzeActions {
  health: ActionList;
  infra: ActionList;
  /** The readiness score and infrastructure scan; null while loading. */
  delivery: DeliveryData | null;
  /** Zone id → its "!" on the map. */
  issues: Record<string, ZoneMark>;
  /** The item the pointer is over in either list. */
  hovered: ActionItem | null;
  setHovered: (item: ActionItem | null) => void;
}

const AnalyzeActionsContext = createContext<AnalyzeActions | null>(null);

/** Reads next steps and the delivery artifacts once and shares both lists with the tiles beneath. */
export function AnalyzeActionsProvider({ data, children }: { data: LoadedData; children?: ComponentChildren }) {
  const steps = useNextSteps(5);
  const delivery = useDeliveryData(deliveryAnalysisStamp(data.manifest));
  const [hovered, setHovered] = useState<ActionItem | null>(null);
  const health = useMemo(() => buildHealthActions(data, steps), [data.zones, data.manifest, steps]);
  const infra = useMemo(() => buildInfraActions(data, delivery?.readiness ?? null), [data.zones, data.manifest, delivery]);
  const issues = useMemo(() => zoneIssues(data, [...health.items, ...infra.items]), [data.zones, health, infra]);
  const value = useMemo(
    () => ({ health, infra, delivery, issues, hovered, setHovered }),
    [health, infra, delivery, issues, hovered],
  );
  return h(AnalyzeActionsContext.Provider, { value }, children);
}

/** The shared lists, or null outside a provider. */
export function useAnalyzeActions(): AnalyzeActions | null {
  return useContext(AnalyzeActionsContext);
}

/** Renders `children` under the enclosing provider, or under one of its own when there is none. */
export function WithAnalyzeActions({ data, children }: { data: LoadedData; children?: ComponentChildren }): ComponentChild {
  return useAnalyzeActions() ? h(Fragment, null, children) : h(AnalyzeActionsProvider, { data }, children);
}
