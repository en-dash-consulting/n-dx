/**
 * The Analyze dashboard's Infrastructure & architecture tile: the delivery
 * readiness score, the zone boundaries and the discovered infrastructure as
 * stat cards, over what to do about them — readiness gaps, architecture
 * findings and files to move — in the same list the Codebase health tile uses.
 *
 * SDLC readiness highlights the readiness gaps while hovered and filters the
 * list to them when pressed; Cross-zone imports does the same for the
 * boundary findings. Hovering an item lights its zones on the codebase map, or
 * says beside the map what it would add that the map cannot draw yet. Opened,
 * the tile lists every item with its remedy, then each practice's evidence and
 * every resource (the Delivery panel's detail); Architecture and Routes follow
 * as tabs.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import { useMemo } from "preact/hooks";
import type { LoadedData } from "../types.js";
import { StatTile } from "./overview.js";
import { DeliveryPanel, deliveryAnalysisStamp, groupInfrastructure, scoreBand } from "./delivery.js";
import { ActionItemList, concernCardProps, concernCounts, useConcernFocus } from "./action-items.js";
import { WithAnalyzeActions, useAnalyzeActions } from "./analyze-actions-context.js";

const BAND_TONE = { good: "var(--green)", fair: "var(--orange)", poor: "var(--red)" } as const;

interface InfraArchPanelProps {
  data: LoadedData;
  opened?: boolean;
}

export function InfraArchPanel(props: InfraArchPanelProps): ComponentChild {
  return h(WithAnalyzeActions, { data: props.data }, h(InfraArchBody, props));
}

function InfraArchBody({ data, opened = false }: InfraArchPanelProps): ComponentChild {
  const shared = useAnalyzeActions()!;
  const list = shared.infra;
  const counts = useMemo(() => concernCounts(list.items, ["readiness", "boundaries"]), [list]);
  const focus = useConcernFocus();
  const readiness = shared.delivery?.readiness ?? null;
  const infrastructure = shared.delivery?.infrastructure ?? null;
  const crossings = data.zones?.crossings?.length ?? null;
  const kinds = infrastructure ? groupInfrastructure(infrastructure) : [];

  const stats = h("div", { class: "overview-stats", role: "list", "aria-label": "Infrastructure and architecture summary" },
    readiness
      ? h(StatTile, {
          glyph: "✓",
          label: "SDLC readiness",
          value: String(readiness.overall),
          sub: "of 100 — a heuristic",
          tone: BAND_TONE[scoreBand(readiness.overall)],
          meter: readiness.overall / 100,
          ...concernCardProps(focus, counts, "readiness"),
        })
      : null,
    crossings !== null
      ? h(StatTile, {
          glyph: "⇄",
          label: "Cross-zone imports",
          value: crossings.toLocaleString(),
          sub: "edges between zones",
          ...concernCardProps(focus, counts, "boundaries"),
        })
      : null,
    infrastructure
      ? h(StatTile, {
          glyph: "☁",
          label: "Infrastructure",
          value: infrastructure.resources.length.toLocaleString(),
          sub: kinds.length > 0 ? kinds.map((k) => `${k.resources.length} ${k.kind}`).join(" · ") : "none found",
        })
      : null,
  );

  const listEl = h(ActionItemList, {
    list,
    focus,
    idBase: opened ? "infra-actions-opened" : "infra-actions",
    opened,
    onItemHover: shared.setHovered,
  });

  if (!shared.delivery && list.items.length === 0) {
    return h("div", { class: "health-summary" }, stats, h("p", { class: "stage-tile-empty" }, "Loading…"));
  }
  return opened
    ? h("div", { class: "health-detail" },
        stats,
        listEl,
        h(DeliveryPanel, { stamp: deliveryAnalysisStamp(data.manifest), opened: true }),
      )
    : h("div", { class: "health-summary" }, stats, listEl);
}
