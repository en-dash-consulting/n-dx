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
import { BrandedHeader } from "../components/index.js";
import {
  CHANGE_STAGE_LABELS,
  groupChangesByRelease,
  isAppliedStage,
  type ChangeRow,
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
    return h("span", { class: "ch-map-none" }, "Unplaced");
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
    h("button", {
      type: "button",
      class: "ch-intent-toggle",
      "aria-expanded": expanded ? "true" : "false",
      onClick: () => setExpanded(!expanded),
    }, expanded ? "less" : "more"),
  );
}

function Change({ change, onSelect }: {
  change: ChangeRow;
  onSelect?: (id: string) => void;
}) {
  return h("li", {
    class: "ch-change",
    "data-change-id": change.id,
    "data-stage": change.stage,
  },
    h("div", { class: "ch-change-head" },
      change.displayId ? h("span", { class: "ch-display-id" }, change.displayId) : null,
      onSelect
        ? h("button", {
            type: "button",
            class: "ch-change-link",
            onClick: () => onSelect(change.id),
          }, change.title)
        : h("span", { class: "ch-change-title" }, change.title),
      change.spike ? h("span", { class: "tag ch-spike" }, "Spike") : null,
      change.awaitsPlacement ? h(NeedsPlacement, { change, onSelect }) : null,
      change.priority ? h("span", { class: "tag ch-priority" }, change.priority) : null,
    ),
    change.intent ? h(Intent, { intent: change.intent }) : null,
    h(MapLinks, { change }),
    h("div", { class: "ch-change-meta" },
      h(TaskProgress, { change }),
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
  return h("div", { class: "ch-stage", "data-stage": stage.stage },
    h("h4", { class: "ch-stage-header" },
      CHANGE_STAGE_LABELS[stage.stage],
      h("span", { class: "ch-stage-count" }, `${stage.changes.length}`),
    ),
    h("ul", { class: "ch-change-list" },
      stage.changes.map((change) =>
        h(Change, { key: change.id, change, onSelect: onSelectChange })),
    ),
  );
}

/** One release: open stages, then applied history behind a count. */
function Release({ group, onSelectChange }: {
  group: ReleaseGroup;
  onSelectChange?: (id: string) => void;
}) {
  const [showApplied, setShowApplied] = useState(false);
  const open = group.stages.filter((s) => !isAppliedStage(s.stage));
  const applied = group.stages.filter((s) => isAppliedStage(s.stage));

  return h("section", {
    class: "ch-release",
    "aria-label": group.label,
    ...(group.release ? { "data-release": group.release } : { "data-release-unscheduled": "true" }),
  },
    h("h3", { class: "section-header" },
      group.label,
      h("span", { class: "ch-release-count" }, `${group.changeCount}`),
    ),
    open.map((stage) => h(Stage, { key: stage.stage, stage, onSelectChange })),
    group.appliedCount > 0
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

// ── View ─────────────────────────────────────────────────────────────

export function ChangesView({ changes, onSelectChange }: {
  changes: ChangeRow[];
  /** Opens a change. Omitted, titles render as plain text. */
  onSelectChange?: (id: string) => void;
}) {
  const groups = groupChangesByRelease(changes);

  return h("div", { class: "ch-container" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "view-title" }, "Changes"),
    ),
    h("p", { class: "section-sub" },
      "Work grouped by planned release and stage. A release is a field on a change, not a container."),

    groups.length === 0
      ? h("div", { class: "empty-state", role: "status" },
          "No changes yet. Captured work appears here, grouped by the release it is planned for.")
      : h(Fragment, null,
          groups.map((group) =>
            h(Release, { key: group.release ?? "unscheduled", group, onSelectChange })),
        ),
  );
}
