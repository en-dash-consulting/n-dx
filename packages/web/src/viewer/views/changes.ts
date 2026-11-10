/**
 * Changes view — open and shipped work, grouped by planned release and stage.
 *
 * Releases are a field on a change, never a container, so the grouping here
 * is a presentation of `plannedRelease` rather than a tree walk. Releases run
 * newest first, with the unscheduled group on top while it holds open work.
 * Within a release, open stages lead in lifecycle order and applied/shipped
 * changes collapse behind a count; long intents clamp to two lines.
 *
 * Driven entirely by its `changes` prop: `product-pages.ts` fetches it from
 * `GET /api/rex/changes`, and tests render it from a fixture.
 */

import { h, Fragment } from "preact";
import { useState } from "preact/hooks";
import { ApplyAllBar } from "./apply-all.js";
import type { NavigateTo } from "../types.js";
import { BrandedHeader, DescribeInSidecarButton, ImpactTags, displayTitle, useItemImpacts, type ItemImpact } from "../components/index.js";
import {
  CHANGE_STAGE_LABELS,
  CHANGE_STAGE_ORDER,
  groupChangesByRelease,
  isAppliedStage,
  type ChangeRow,
  type OpenChangeStage,
  type ReleaseGroup,
  type StageGroup,
} from "./product-model.js";

// ── Helpers ──────────────────────────────────────────────────────────

function TaskProgress({ change }: { change: ChangeRow }) {
  if (change.taskCount === 0) return h("span", { class: "ch-progress ch-progress-empty" }, "no tasks");
  return h("span", { class: "ch-progress" },
    `${change.completedTaskCount}/${change.taskCount} tasks`);
}

/** What the change does to the map: amendments first, then plain touches. */
function MapLinks({ change }: { change: ChangeRow }) {
  if (change.amends.length === 0 && change.touches.length === 0) {
    return h("p", { class: "ch-map-none" }, "Unplaced");
  }
  return h("ul", { class: "ch-map-links" },
    change.amends.map((node) =>
      h("li", { key: `amends-${node.id}`, class: "ch-map-link ch-amends" },
        h("span", { class: `ch-delta ch-delta-${node.delta}` }, node.delta),
        " ",
        node.title,
      ),
    ),
    change.touches.map((node) =>
      h("li", { key: `touches-${node.id}`, class: "ch-map-link ch-touches" },
        h("span", { class: "ch-delta ch-delta-touches" }, "touches"),
        " ",
        node.title,
      ),
    ),
  );
}

/** Open and held: opens the change's detail panel, where it is placed. */
function NeedsPlacement({ change, onSelect }: {
  change: ChangeRow;
  onSelect?: (id: string) => void;
}) {
  if (!onSelect) return h("span", { class: "tag ch-needs-placement" }, "Needs placement");
  return h("button", {
    type: "button",
    class: "tag ch-needs-placement ch-needs-placement-link",
    onClick: () => onSelect(change.id),
  }, "Needs placement");
}

/**
 * Intents longer than this, or with a line break, get a "more" control.
 * Whether text overflows two lines depends on layout the view cannot see
 * before paint, so the control follows the text rather than a measurement.
 */
const INTENT_CLAMP_CHARS = 160;

function intentIsLong(intent: string): boolean {
  return intent.length > INTENT_CLAMP_CHARS || intent.includes("\n");
}

/** The change's intent, clamped to two lines until expanded. */
function Intent({ intent }: { intent: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!intentIsLong(intent)) return h("p", { class: "ch-intent" }, intent);
  return h(Fragment, null,
    h("p", {
      class: expanded ? "ch-intent" : "ch-intent ch-intent-clamped",
      "data-expanded": expanded ? "true" : "false",
    }, intent),
    h("div", { class: "ch-intent-more" },
      h("button", {
        type: "button",
        class: "ch-intent-toggle",
        "aria-expanded": expanded ? "true" : "false",
        onClick: () => setExpanded(!expanded),
      }, expanded ? "less" : "more"),
    ),
  );
}

function Change({ change, onSelect, impact }: {
  change: ChangeRow;
  onSelect?: (id: string) => void;
  impact?: ItemImpact;
}) {
  return h("li", {
    class: "ch-change",
    "data-change-id": change.id,
    "data-stage": change.stage,
  },
    h("div", { class: "ch-change-head" },
      change.displayId ? h("span", { class: "ch-display-id" }, change.displayId) : null,
      // The plain-language summary leads; the technical title is the tooltip and the detail panel's heading.
      onSelect
        ? h("button", {
            type: "button",
            class: "ch-change-link",
            title: change.summary ? change.title : undefined,
            onClick: () => onSelect(change.id),
          }, displayTitle(change))
        : h("span", { class: "ch-change-title", title: change.summary ? change.title : undefined }, displayTitle(change)),
      change.spike ? h("span", { class: "tag ch-spike" }, "Spike") : null,
      change.awaitsPlacement ? h(NeedsPlacement, { change, onSelect }) : null,
      isAppliedStage(change.stage) ? null : h(DescribeInSidecarButton, { changeId: change.id }),
      change.priority ? h("span", { class: "tag ch-priority" }, change.priority) : null,
    ),
    change.intent ? h(Intent, { intent: change.intent }) : null,
    h(MapLinks, { change }),
    h("div", { class: "ch-change-meta" },
      h(TaskProgress, { change }),
      h(ImpactTags, { impact, full: true }),
      change.loe !== undefined ? h("span", { class: "ch-loe" }, `${change.loe}w`) : null,
      change.assignee ? h("span", { class: "ch-assignee" }, change.assignee) : null,
      change.shippedIn ? h("span", { class: "tag ch-shipped-in" }, `shipped in ${change.shippedIn}`) : null,
    ),
  );
}

function Stage({ stage, onSelectChange }: {
  stage: StageGroup;
  onSelectChange?: (id: string) => void;
}) {
  const impacts = useItemImpacts();
  return h("div", { class: "ch-stage", "data-stage": stage.stage },
    h("h4", { class: "ch-stage-header" },
      CHANGE_STAGE_LABELS[stage.stage],
      h("span", { class: "ch-stage-count" }, `${stage.changes.length}`),
    ),
    h("ul", { class: "ch-change-list" },
      stage.changes.map((change) =>
        h(Change, { key: change.id, change, onSelect: onSelectChange, impact: impacts[change.id] })),
    ),
  );
}

/** What a release group shows: open work, applied history, or both. */
type GroupMode = "open" | "applied" | "all";

/**
 * One release. Applied history is a collapsed section whose rows mount only
 * once it is expanded, so a group of 1,241 applied changes costs a button.
 */
function Release({ group, mode, onSelectChange }: {
  group: ReleaseGroup;
  mode: GroupMode;
  onSelectChange?: (id: string) => void;
}) {
  const [showApplied, setShowApplied] = useState(false);
  const open = mode === "applied" ? [] : group.stages.filter((s) => !isAppliedStage(s.stage));
  const applied = mode === "open" ? [] : group.stages.filter((s) => isAppliedStage(s.stage));
  const count = mode === "open" ? group.changeCount - group.appliedCount
    : mode === "applied" ? group.appliedCount : group.changeCount;

  return h("section", {
    class: "ch-release",
    "aria-label": group.label,
    ...(group.release ? { "data-release": group.release } : { "data-release-unscheduled": "true" }),
  },
    h("h3", { class: "section-header" },
      group.label,
      h("span", { class: "ch-release-count" }, `${count}`),
    ),
    open.map((stage) => h(Stage, { key: stage.stage, stage, onSelectChange })),
    applied.length > 0
      ? h("button", {
          type: "button",
          class: "ch-applied-toggle",
          "aria-expanded": showApplied ? "true" : "false",
          onClick: () => setShowApplied(!showApplied),
        }, `${group.appliedCount} applied ${showApplied ? "▾" : "▸"}`)
      : null,
    showApplied
      ? applied.map((stage) => h(Stage, { key: stage.stage, stage, onSelectChange }))
      : null,
  );
}

// ── Filters ──────────────────────────────────────────────────────────

const FILTER_STORAGE_KEY = "ndx.changes.filter";
const UNSCHEDULED_FILTER = "unscheduled";
const RELEASE_PREFIX = "release:";
const STAGE_PREFIX = "stage:";
const OPEN_STAGES = CHANGE_STAGE_ORDER.filter((s): s is OpenChangeStage => !isAppliedStage(s));

/** The filter that shows one open stage; Plan's lifecycle strip opens the page on it. */
export function stageFilter(stage: OpenChangeStage): string {
  return `${STAGE_PREFIX}${stage}`;
}

/** The gaps Plan's Specs to tighten tile counts; each opens this page on its changes. */
export type GapKind = "no-criteria" | "task-criteria" | "blocked";

export const GAP_LABELS: Readonly<Record<GapKind, string>> = {
  "no-criteria": "No acceptance criteria",
  "task-criteria": "Tasks without criteria",
  blocked: "Waiting on a blocker",
};

const GAP_PREFIX = "gap:";
const GAP_KINDS = Object.keys(GAP_LABELS) as GapKind[];

export function gapFilter(gap: GapKind): string {
  return `${GAP_PREFIX}${gap}`;
}

function gapOfFilter(filter: string): GapKind | null {
  const name = filter.startsWith(GAP_PREFIX) ? filter.slice(GAP_PREFIX.length) : "";
  return GAP_KINDS.find((g) => g === name) ?? null;
}

/**
 * Whether an open, placed change has the gap. `criteriaGap` on a task-less change
 * is its own missing criteria; on one with tasks it is an open task's.
 */
export function hasGap(change: Pick<ChangeRow, "criteriaGap" | "openBlockers" | "taskCount">, gap: GapKind): boolean {
  if (gap === "blocked") return change.openBlockers > 0;
  return change.criteriaGap && (change.taskCount === 0) === (gap === "no-criteria");
}

function stageOfFilter(filter: string): OpenChangeStage | null {
  const name = filter.startsWith(STAGE_PREFIX) ? filter.slice(STAGE_PREFIX.length) : "";
  return OPEN_STAGES.find((s) => s === name) ?? null;
}

function filterOf(group: ReleaseGroup): string {
  return group.release ? `${RELEASE_PREFIX}${group.release}` : UNSCHEDULED_FILTER;
}

function readStoredFilter(): string {
  try {
    return localStorage.getItem(FILTER_STORAGE_KEY) ?? "open";
  } catch {
    return "open";
  }
}

/** Remember the filter the page opens on next. */
export function storeFilter(value: string): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable (private mode, quota); the choice then lasts the session.
  }
}

function FilterChip({ value, label, count, active, onPick }: {
  value: string;
  label: string;
  count: number;
  active: boolean;
  onPick: (value: string) => void;
}) {
  return h("button", {
    type: "button",
    class: active ? "ch-filter ch-filter-active" : "ch-filter",
    "data-filter": value,
    "aria-pressed": active ? "true" : "false",
    onClick: () => onPick(value),
  }, label, h("span", { class: "ch-filter-count" }, `${count}`));
}

/** The open changes the map counts on the area `slug`: its badge's `openChangeIds`. */
export function changesInArea(changes: readonly ChangeRow[], slug: string): ChangeRow[] {
  return changes.filter((c) => c.areas?.some((a) => a.slug === slug));
}

/** The area filter's chip: always active, with its own remove button beside the label. */
function AreaChip({ title, count, onRemove }: { title: string; count: number; onRemove?: () => void }) {
  return h("span", { class: "ch-filter ch-filter-active ch-filter-area", "data-filter": "area" },
    `Area: ${title}`,
    h("span", { class: "ch-filter-count" }, `${count}`),
    onRemove
      ? h("button", {
          type: "button",
          class: "ch-filter-remove",
          "aria-label": `Remove the ${title} area filter`,
          onClick: onRemove,
        }, "×")
      : null,
  );
}

// ── View ─────────────────────────────────────────────────────────────

export function ChangesView({ changes, onSelectChange, area = null, onClearArea, navigateTo }: {
  changes: ChangeRow[];
  /** Reaches Settings → Workflow from the Apply all bar. */
  navigateTo?: NavigateTo;
  /** Opens a change. Omitted, titles render as plain text. */
  onSelectChange?: (id: string) => void;
  /** An area slug (`?area=`): the page lists only that area's open changes. */
  area?: string | null;
  /** Clears the area filter; the chip's remove button and every other chip call it. */
  onClearArea?: () => void;
}) {
  const [stored, setStored] = useState(readStoredFilter);
  const groups = groupChangesByRelease(changes);
  const appliedTotal = groups.reduce((n, g) => n + g.appliedCount, 0);
  const openTotal = changes.length - appliedTotal;

  // A remembered release that no longer exists falls back to the default.
  const known = new Set(groups.map(filterOf));
  const inArea = area ? changesInArea(changes, area) : null;
  // The area filter outranks the remembered one; it lives in the address, not storage.
  const stage = inArea ? null : stageOfFilter(stored);
  const gap = inArea ? null : gapOfFilter(stored);
  const filter = inArea ? "area"
    : stage || gap || stored === "open" || stored === "applied" || known.has(stored) ? stored : "open";
  const pick = (value: string) => { setStored(value); storeFilter(value); if (inArea) onClearArea?.(); };
  // Removing the area shows every open change, never whatever filter was remembered before it.
  const removeArea = onClearArea ? () => pick("open") : undefined;
  // Named from the rows; an area with nothing open (or an unknown slug) shows its slug.
  const areaTitle = area ? inArea?.[0]?.areas?.find((a) => a.slug === area)?.title ?? area : null;

  // A stage counts placed changes only: one rex holds for placement is the Inbox's.
  const staged = inArea ? inArea
    : stage ? changes.filter((c) => c.stage === stage && !c.awaitsPlacement)
    : gap ? changes.filter((c) => !isAppliedStage(c.stage) && !c.awaitsPlacement && hasGap(c, gap))
    : null;
  const mode: GroupMode = inArea || stage || gap || filter === "open" ? "open" : filter === "applied" ? "applied" : "all";
  const shown = (staged ? groupChangesByRelease(staged) : groups).filter((g) =>
    mode === "open" ? g.appliedCount < g.changeCount
    : mode === "applied" ? g.appliedCount > 0
    : filterOf(g) === filter);

  return h("div", { class: "ch-container" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "view-title" }, "Changes"),
    ),
    h("p", { class: "section-sub" },
      "Work grouped by planned release and stage. A release is a field on a change, not a container."),

    // Done and waiting to apply: one step for all of them, and the way to make it automatic.
    h(ApplyAllBar, { waiting: changes.filter((c) => c.stage === "awaiting-apply").length, navigateTo }),

    groups.length === 0
      ? h("div", { class: "empty-state", role: "status" },
          "No changes yet. Captured work appears here, grouped by the release it is planned for.")
      : h(Fragment, null,
          h("div", { class: "ch-filters", role: "group", "aria-label": "Filter changes" },
            h(FilterChip, { value: "open", label: "Open", count: openTotal, active: filter === "open", onPick: pick }),
            h(FilterChip, { value: "applied", label: "Applied", count: appliedTotal, active: filter === "applied", onPick: pick }),
            inArea && areaTitle ? h(AreaChip, { title: areaTitle, count: inArea.length, onRemove: removeArea }) : null,
            (stage || gap) && staged
              ? h(FilterChip, { value: filter, label: stage ? CHANGE_STAGE_LABELS[stage] : GAP_LABELS[gap!], count: staged.length, active: true, onPick: pick })
              : null,
            groups.map((g) => h(FilterChip, {
              key: filterOf(g), value: filterOf(g), label: g.label, count: g.changeCount,
              active: filter === filterOf(g), onPick: pick,
            })),
          ),
          shown.length === 0
            ? h("div", { class: "empty-state", role: "status" }, "Nothing matches this filter.")
            : shown.map((group) =>
                h(Release, { key: `${filter}:${filterOf(group)}`, group, mode, onSelectChange })),
        ),
  );
}
