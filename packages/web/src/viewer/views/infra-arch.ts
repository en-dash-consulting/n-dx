/**
 * The infrastructure & architecture stat cards of the Analyze dashboard's
 * visuals tile: the delivery readiness score, the zone boundaries and the
 * discovered infrastructure.
 *
 * Under the dashboard's provider, SDLC readiness highlights the readiness gaps
 * in the Recommended fixes tile while hovered and filters that list to them
 * when pressed; Cross-zone imports does the same for the boundary findings.
 * Without `focus` (the opened tile) the cards only show their numbers.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import type { LoadedData } from "../types.js";
import { StatTile } from "./overview.js";
import { groupInfrastructure, scoreBand, type DeliveryData } from "./delivery.js";
import { concernCardProps, type ActionItem, type RecommendationFocus } from "./action-items.js";

const BAND_TONE = { good: "var(--green)", fair: "var(--orange)", poor: "var(--red)" } as const;

interface InfraStatsProps {
  data: LoadedData;
  /** The readiness score and infrastructure scan; null while loading. */
  delivery: DeliveryData | null;
  /** Ties SDLC readiness and Cross-zone imports to the recommendations. */
  focus?: { focus: RecommendationFocus; items: readonly ActionItem[] };
}

/** SDLC readiness, Cross-zone imports and Infrastructure, as stat cards. */
export function infraStatCards({ data, delivery, focus }: InfraStatsProps): ComponentChild[] {
  const readiness = delivery?.readiness ?? null;
  const infrastructure = delivery?.infrastructure ?? null;
  const crossings = data.zones?.crossings?.length ?? null;
  const kinds = infrastructure ? groupInfrastructure(infrastructure) : [];
  const card = (concern: "readiness" | "boundaries") => (focus ? concernCardProps(focus.focus, focus.items, concern) : {});
  return [
    readiness
      ? h(StatTile, {
          key: "readiness",
          glyph: "✓",
          label: "SDLC readiness",
          value: String(readiness.overall),
          sub: "of 100 — a heuristic",
          tone: BAND_TONE[scoreBand(readiness.overall)],
          meter: readiness.overall / 100,
          ...card("readiness"),
        })
      : null,
    crossings !== null
      ? h(StatTile, {
          key: "crossings",
          glyph: "⇄",
          label: "Cross-zone imports",
          value: crossings.toLocaleString(),
          sub: "edges between zones",
          ...card("boundaries"),
        })
      : null,
    infrastructure
      ? h(StatTile, {
          key: "infrastructure",
          glyph: "☁",
          label: "Infrastructure",
          value: infrastructure.resources.length.toLocaleString(),
          sub: kinds.length > 0 ? kinds.map((k) => `${k.resources.length} ${k.kind}`).join(" · ") : "none found",
        })
      : null,
  ];
}
