/**
 * Plan's open-changes glance: a short table of the first few placed open
 * changes (newest planned release first, Unscheduled last) and a link to the
 * full Open changes list. Columns: the change (its plain-language summary, with
 * Security and Essential flags), its size in one word, progress as a
 * percentage and a one-word status; counts and full labels are in tooltips and
 * the detail panel. Tracker and Describe actions sit in a last column that
 * shows on hover or focus. A row opens the change's detail panel. Inbox
 * changes are not here — the summary counts them apart.
 *
 * Reads the summary the Plan grid's `ChangesSummaryProvider` loaded once, shared
 * with the lifecycle strip.
 *
 * @module viewer/views/changes-glance
 */

import { h } from "preact";
import { useContext, useMemo } from "preact/hooks";
import {
  CreateInTrackerButton,
  DescribeInSidecarButton,
  GhostCardsContext,
  ImpactFlags,
  TrackerChip,
  displayTitle,
  sizeCell,
  ghostChanges,
  useItemImpacts,
  useTrackerChips,
  type ItemImpact,
  type TrackerChipRead,
} from "../components/index.js";
import type { NavigateTo } from "../types.js";
import { useChangesSummary } from "./changes-summary-context.js";
import { ApplyAllBar } from "./apply-all.js";
import {
  CHANGE_STAGE_LABELS,
  glanceGap,
  groupGlanceByRelease,
  type GlanceChange,
  type GlanceGroup,
} from "./product-model.js";

/** Rows drawn before the rest are left to the full list: the next few, not the whole queue. */
export const MAX_GLANCE_ROWS = 3;

/** One-word statuses for the table; the stage's full label is the tooltip. */
const SHORT_STATUS: Readonly<Record<GlanceChange["stage"], string>> = {
  proposed: "Planned",
  ready: "Ready",
  "in-progress": "Working",
  "awaiting-apply": "Done",
};

/**
 * The status cell: a blocked change that is not already being worked reads
 * "Waiting"; a change with no acceptance criteria says so in the tooltip.
 */
export function shortStatus(change: GlanceChange): { label: string; tone: string; title: string } {
  const gap = glanceGap(change);
  const full = CHANGE_STAGE_LABELS[change.stage];
  if (gap === "blocked" && change.stage !== "in-progress" && change.stage !== "awaiting-apply") {
    return { label: "Waiting", tone: "waiting", title: `${full} · blocked by ${change.openBlockers} unfinished ${change.openBlockers === 1 ? "item" : "items"}` };
  }
  return {
    label: SHORT_STATUS[change.stage],
    tone: change.stage,
    title: gap === "no-criteria" ? `${full} · no acceptance criteria yet` : full,
  };
}

/** Progress as a whole percentage of tasks done, or null for a task-less change. */
export function progressPercent(change: Pick<GlanceChange, "taskCount" | "completedTaskCount">): number | null {
  return change.taskCount === 0 ? null : Math.round((change.completedTaskCount / change.taskCount) * 100);
}

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

function Row({ change, navigateTo, tracker, onTrackerChanged, impact }: { change: GlanceChange; navigateTo: NavigateTo; tracker: TrackerChipRead; onTrackerChanged: () => void; impact?: ItemImpact }) {
  const pct = progressPercent(change);
  const status = shortStatus(change);
  const size = sizeCell(impact);
  return h("tr", { class: "cg-row", "data-change": change.id },
    h("td", { class: "cg-name" },
      // The plain-language summary leads; the technical title is the tooltip and the detail panel's heading.
      h("button", { type: "button", class: "cg-open", title: change.summary ? change.title : undefined, onClick: () => navigateTo("prd", { taskId: change.id }) },
        h("span", { class: "cg-title" }, displayTitle(change)),
      ),
      h(ImpactFlags, { impact }),
    ),
    h("td", { class: `cg-size${impact?.size ? ` cg-size-${impact.size}` : ""}`, title: size.title }, size.label),
    h("td", { class: "cg-pct", title: pct === null ? "No tasks: it runs as one unit" : `${change.completedTaskCount} of ${change.taskCount} tasks done` },
      pct === null ? "—" : `${pct}%`),
    h("td", { class: `cg-status cg-status-${status.tone}`, title: status.title }, status.label),
    h("td", { class: "cg-actions" },
      h(TrackerChip, { changeId: change.id, read: tracker }),
      h(DescribeInSidecarButton, { changeId: change.id, class: "cg-describe" }),
      h(CreateInTrackerButton, { changeId: change.id, read: tracker, onCreated: onTrackerChanged }),
    ),
  );
}

export function ChangesGlance({ navigateTo }: { navigateTo: NavigateTo }) {
  const load = useChangesSummary();
  const cards = useContext(GhostCardsContext);
  const { read: tracker, reload: reloadTracker } = useTrackerChips();
  const impacts = useItemImpacts();
  // Placed changes only, like the real rows: an Inbox-bound one is noted on the strip's Inbox count.
  const ghosts = useMemo(() => ghostChanges(cards).filter((g) => g.target !== null), [cards]);
  if (load.state === "loading") return h("div", { class: "changes-glance", role: "status" }, "Loading...");
  if (load.state === "v1") return null;
  if (load.state === "error") return h("div", { class: "changes-glance", role: "alert" }, `Could not load open changes: ${load.message}`);

  const { groups, more } = limitGroups(groupGlanceByRelease(load.data.open));
  if (groups.length === 0 && ghosts.length === 0) return h("div", { class: "changes-glance cg-empty" }, "No open changes.");
  const rows = groups.flatMap((group) => group.changes);
  return h("div", { class: "changes-glance" },
    h(ApplyAllBar, { waiting: load.data.stages["awaiting-apply"] ?? 0, navigateTo }),
    h("table", { class: "cg-table" },
      h("thead", null,
        h("tr", null,
          h("th", { scope: "col" }, "Change"),
          h("th", { scope: "col" }, "Size"),
          h("th", { scope: "col" }, "Progress"),
          h("th", { scope: "col" }, "Status"),
          h("th", { scope: "col", class: "cg-actions-head" }, h("span", { class: "sr-only" }, "Actions")),
        ),
      ),
      h("tbody", null,
        // Proposed on a waiting card: dashed, never counted, gone on Deny.
        ghosts.map((g) =>
          h("tr", { key: g.key, class: "cg-row cg-ghost", "data-ghost": g.key },
            h("td", { class: "cg-name" }, h("span", { class: "cg-title" }, g.title)),
            h("td", { class: "cg-size" }, "—"),
            h("td", { class: "cg-pct" }, "—"),
            h("td", { class: "cg-status" }, h("span", { class: "cg-ghost-chip" }, "On a card")),
            h("td", { class: "cg-actions" }),
          )),
        rows.map((change) => h(Row, { key: change.id, change, navigateTo, tracker, onTrackerChanged: reloadTracker, impact: impacts[change.id] })),
      ),
    ),
    // Always a way to the whole list; with more than the glance shows, say how many.
    h("button", { type: "button", class: "cg-more", onClick: () => navigateTo("changes") },
      more > 0 ? `See all ${load.data.open.length} open changes →` : "Open the full list →"),
  );
}
