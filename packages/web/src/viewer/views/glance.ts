/**
 * The Analyze dashboard's visuals tile: the codebase's numbers and pictures,
 * and nothing to act on — that is the Recommended fixes tile beside it
 * (recommendations-panel.ts).
 *
 * On the page it shows the health and infrastructure stat cards (files, zones,
 * import cycles, cohesion, coupling, SDLC readiness, cross-zone imports,
 * infrastructure), then the summary: totals, the languages as a pie, the
 * largest zones with a "!" on those with issues, and files by role. The
 * highlighted elements — Avg cohesion, Avg coupling, SDLC readiness,
 * Cross-zone imports and each "!" zone — highlight the recommended fixes they
 * concern while hovered and filter that list to them when pressed.
 *
 * Opened, the elements stop filtering: the cards lead to the sections that
 * explain them — zones needing attention, hub files, import cycles, the
 * readiness evidence and infrastructure, every language and role.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import type { DetailItem, LoadedData } from "../types.js";
import { CodebaseStats, HealthDetail, HEALTH_ATTENTION_ID, HEALTH_CYCLES_ID, type StatKey } from "./overview.js";
import { DeliveryPanel, deliveryAnalysisStamp } from "./delivery.js";
import { infraStatCards } from "./infra-arch.js";
import { SummaryPanel } from "./summary-panel.js";
import { WithAnalyzeActions, useAnalyzeActions } from "./analyze-actions-context.js";

interface GlancePanelProps {
  data: LoadedData;
  opened?: boolean;
  /** Show a zone or file in the detail panel beside the opened tile. */
  setDetail?: (item: DetailItem) => void;
}

export function GlancePanel(props: GlancePanelProps): ComponentChild {
  return h(WithAnalyzeActions, { data: props.data }, h(GlanceBody, props));
}

/** Where an opened stat card leads: the section that explains it. */
const STAT_SECTION: Record<StatKey, string> = {
  files: "summary-languages",
  zones: HEALTH_ATTENTION_ID,
  cohesion: HEALTH_ATTENTION_ID,
  coupling: HEALTH_ATTENTION_ID,
  cycles: HEALTH_CYCLES_ID,
};

function GlanceBody({ data, opened = false, setDetail }: GlancePanelProps): ComponentChild {
  const shared = useAnalyzeActions()!;
  const delivery = shared.delivery;

  if (!opened) {
    const focus = { focus: shared.focus, items: shared.recommendations.items };
    return h("div", { class: "glance-panel" },
      h(CodebaseStats, { data, focus, extra: infraStatCards({ data, delivery, focus }) }),
      h(SummaryPanel, { data }),
    );
  }

  return h("div", { class: "glance-panel glance-panel--opened health-detail" },
    h(CodebaseStats, {
      data,
      onStat: (stat) => document.getElementById(STAT_SECTION[stat])?.scrollIntoView?.({ block: "start", behavior: "smooth" }),
      extra: infraStatCards({ data, delivery }),
    }),
    h(HealthDetail, { data, setDetail: setDetail ?? (() => {}) }),
    h(DeliveryPanel, { stamp: deliveryAnalysisStamp(data.manifest), opened: true }),
    h(SummaryPanel, { data, opened: true }),
  );
}
