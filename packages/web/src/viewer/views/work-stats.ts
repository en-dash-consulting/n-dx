/**
 * Work's Statistics: every number about the PRD in one section — the totals
 * (total, done, active, pending, blocked, deferred), overall progress, the
 * status breakdown with the priority distribution, and structure health.
 * It reads what the Rex dashboard reads and draws its parts; change progress
 * stays off Work.
 *
 * Also the PRD tools side panel: the dashboard's quick actions, kept on Work
 * while the redesign finds them a home.
 *
 * @module viewer/views/work-stats
 */

import { h } from "preact";
import type { NavigateTo } from "../types.js";
import {
  BreakdownPanel,
  PrdQuickActions,
  StatsRow,
  StatusProgressBar,
  StructureHealthPanel,
  useDashboardData,
} from "./rex-dashboard.js";

export function WorkStats() {
  const { data, loading, error, health } = useDashboardData();
  if (loading) return h("p", { class: "work-stats-empty", role: "status" }, "Loading…");
  if (error) return h("p", { class: "work-stats-empty" }, error);
  if (!data) return h("p", { class: "work-stats-empty" }, "No PRD data available.");
  return h("div", { class: "work-stats rex-dash" },
    h(StatsRow, { stats: data.stats }),
    h(StatusProgressBar, { stats: data.stats, percentComplete: data.percentComplete }),
    h("div", { class: "work-stats-panels" },
      h(BreakdownPanel, { stats: data.stats, priorities: data.priorities }),
      health ? h(StructureHealthPanel, { health }) : null,
    ),
  );
}

export function PrdTools({ navigateTo }: { navigateTo: NavigateTo }) {
  return h("div", { class: "prd-tools rex-dash" },
    h("p", { class: "prd-tools-intro" }, "Open the task tree, check the PRD's structure, or undo a reshape."),
    h(PrdQuickActions, { navigateTo }),
  );
}
