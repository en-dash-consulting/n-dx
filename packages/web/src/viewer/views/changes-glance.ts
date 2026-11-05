/**
 * Plan's open-changes glance: placed open changes grouped by planned release
 * (newest first, Unscheduled last), each row with a progress bar, a stage chip
 * and at most one gap chip. A row opens the change's detail panel; a long list
 * ends in "N more", which opens the full Open changes list. Inbox changes are
 * not here — the summary counts them apart.
 *
 * Reads `GET /api/rex/changes/summary`, the same fast read as the lifecycle strip.
 *
 * @module viewer/views/changes-glance
 */

import { h } from "preact";
import { useProductRead } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";
import {
  CHANGE_STAGE_LABELS,
  glanceGap,
  groupGlanceByRelease,
  type ChangeSummary,
  type GlanceChange,
  type GlanceGroup,
} from "./product-model.js";

/** Rows drawn before the rest fold into "N more". */
export const MAX_GLANCE_ROWS = 12;

const GAP_LABELS = { blocked: "Blocked", "no-criteria": "No criteria" } as const;

/** The groups to draw: the first `limit` rows in order, and how many are left out. */
export function limitGroups(groups: readonly GlanceGroup[], limit: number = MAX_GLANCE_ROWS): { groups: GlanceGroup[]; more: number } {
  let left = limit;
  const kept: GlanceGroup[] = [];
  for (const group of groups) {
    if (left <= 0) break;
    const changes = group.changes.slice(0, left);
    left -= changes.length;
    kept.push({ label: group.label, changes });
  }
  const total = groups.reduce((n, g) => n + g.changes.length, 0);
  return { groups: kept, more: total - (limit - left) };
}

function Row({ change, navigateTo }: { change: GlanceChange; navigateTo: NavigateTo }) {
  const gap = glanceGap(change);
  const done = change.taskCount === 0 ? 0 : Math.round((change.completedTaskCount / change.taskCount) * 100);
  return h("li", { class: "cg-row", "data-change": change.id },
    h("button", { type: "button", class: "cg-open", onClick: () => navigateTo("prd", { taskId: change.id }) },
      h("span", { class: "cg-title" }, change.title),
    ),
    // A task-less change runs as its own unit, so it has no progress to draw.
    change.taskCount === 0
      ? h("span", { class: "cg-progress cg-progress-none" }, "no tasks")
      : h("span", { class: "cg-progress", title: `${change.completedTaskCount} of ${change.taskCount} tasks` },
        h("progress", { class: "cg-bar", max: 100, value: done, "aria-label": `${change.completedTaskCount} of ${change.taskCount} tasks done` }),
        h("span", { class: "cg-fraction" }, `${change.completedTaskCount}/${change.taskCount}`),
      ),
    h("span", { class: `cg-chip cg-stage cg-stage-${change.stage}` }, CHANGE_STAGE_LABELS[change.stage]),
    gap ? h("span", { class: `cg-chip cg-gap cg-gap-${gap}` }, GAP_LABELS[gap]) : null,
  );
}

export function ChangesGlance({ navigateTo }: { navigateTo: NavigateTo }) {
  const load = useProductRead("/api/rex/changes/summary", (body) => body.summary as ChangeSummary);
  if (load.state === "loading") return h("div", { class: "changes-glance", role: "status" }, "Loading...");
  if (load.state === "v1") return null;
  if (load.state === "error") return h("div", { class: "changes-glance", role: "alert" }, `Could not load open changes: ${load.message}`);

  const { groups, more } = limitGroups(groupGlanceByRelease(load.data.open));
  if (groups.length === 0) return h("div", { class: "changes-glance cg-empty" }, "No open changes.");
  return h("div", { class: "changes-glance" },
    groups.map((group) =>
      h("section", { key: group.label, class: "cg-group", "aria-label": group.label },
        h("h4", { class: "cg-release" }, group.label),
        h("ul", { class: "cg-rows" }, group.changes.map((change) => h(Row, { key: change.id, change, navigateTo }))),
      )),
    more > 0
      ? h("button", { type: "button", class: "cg-more", onClick: () => navigateTo("changes") }, `${more} more`)
      : null,
  );
}
