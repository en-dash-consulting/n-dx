/**
 * Plan's open-changes glance: placed open changes grouped by planned release
 * (newest first, Unscheduled last), each row with a progress bar, a stage chip
 * and at most one gap chip. A row opens the change's detail panel; a long list
 * ends in "N more", which opens the full Open changes list. Inbox changes are
 * not here — the summary counts them apart.
 *
 * Reads the summary the Plan grid's `ChangesSummaryProvider` loaded once, shared
 * with the lifecycle strip.
 *
 * @module viewer/views/changes-glance
 */

import { h } from "preact";
import { useContext, useMemo } from "preact/hooks";
import { DescribeInSidecarButton, GhostCardsContext, ghostChanges } from "../components/index.js";
import type { NavigateTo } from "../types.js";
import { useChangesSummary } from "./changes-summary-context.js";
import {
  CHANGE_STAGE_LABELS,
  glanceGap,
  groupGlanceByRelease,
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
    h(DescribeInSidecarButton, { changeId: change.id, class: "cg-describe" }),
  );
}

export function ChangesGlance({ navigateTo }: { navigateTo: NavigateTo }) {
  const load = useChangesSummary();
  const cards = useContext(GhostCardsContext);
  const ghosts = useMemo(() => ghostChanges(cards), [cards]);
  if (load.state === "loading") return h("div", { class: "changes-glance", role: "status" }, "Loading...");
  if (load.state === "v1") return null;
  if (load.state === "error") return h("div", { class: "changes-glance", role: "alert" }, `Could not load open changes: ${load.message}`);

  const { groups, more } = limitGroups(groupGlanceByRelease(load.data.open));
  if (groups.length === 0 && ghosts.length === 0) return h("div", { class: "changes-glance cg-empty" }, "No open changes.");
  return h("div", { class: "changes-glance" },
    // Proposed on a waiting card: dashed, never counted, gone on Deny.
    ghosts.length > 0
      ? h("ul", { class: "cg-rows cg-ghosts", "aria-label": "Waiting on a card" },
        ghosts.map((g) =>
          h("li", { key: g.key, class: "cg-row cg-ghost", "data-ghost": g.key },
            h("span", { class: "cg-title" }, g.title),
            h("span", { class: "cg-chip cg-ghost-chip" }, "proposed · on a card"))))
      : null,
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
