/**
 * The dashboard's layout, as data.
 *
 * Three stages in a loop — Analysis → Plan → Work → Analysis — each a page
 * that composes existing product views as collapsible sections. Every view
 * keeps its own route (`/zones`, `/hench-runs/<id>`, …); a section is a
 * window onto it with an "Open" link to the full page. Settings views are not
 * part of any stage: they open as a full overlay from the bottom bar's cog.
 *
 * This file is the one place the arrangement lives. The top navigation, the
 * stage pages, the side stage links, the breadcrumb and the landing page all
 * read it, so moving a view between stages is an edit here and nowhere else.
 *
 * It says *where* a view sits; `view-meta.ts` — re-exported below, so callers
 * need one import — says what it is *called*. A section therefore names only
 * a view id: its heading and blurb are the view's own, which is why the stage
 * page and the breadcrumb can no longer disagree about what a view is named.
 *
 * Pure data and pure functions — no Preact — so both components and views
 * can import it (components through api.ts).
 */

import type { ViewId } from "../types.js";
import { VIEW_META } from "./view-meta.js";

export * from "./view-meta.js";

export type StageId = "analyze" | "plan" | "work";

export type StageProduct = "sourcevision" | "rex" | "hench";

export interface StageTab {
  /** The tab's own label, blurb and glyph come from its `view-meta.ts` entry. */
  view: ViewId;
  /**
   * Dropped in a static export — the isometric map is built by the server on
   * demand, same exemption the old 2D/3D toggle carried for its 3D side.
   */
  hiddenWhenDeployed?: boolean;
}

export interface StageSection {
  /**
   * View rendered in the section and opened full-page by its "Open" link —
   * the first tab when `tabs` is set. The section's heading and blurb come
   * from this view's entry in `view-meta.ts`, unless `group` overrides them;
   * there is no other per-section override.
   */
  view: ViewId;
  /** Expanded when the stage page first opens. */
  open?: boolean;
  /**
   * The stage's lead section, shown in the page itself with no dropdown
   * header: always rendered, never collapsible. One per stage, first.
   */
  plain?: boolean;
  /**
   * Further views sharing this section as tabs alongside `view` — the
   * Terrain section's Isometric map and Zones, the Architecture section's
   * Routes. Generalises the old two-way 2D/3D projection toggle into an
   * N-way tab strip; each tab is still one view, reused unchanged, and
   * still keeps its own route and full page.
   */
  tabs?: readonly StageTab[];
  /**
   * Heading and blurb for a section whose tabs form a named group with no
   * page of its own — Terrain has no route; only its tabs do. Omitted when
   * the section's identity is simply `view`'s own (Architecture's merged
   * section needs no override: it is still named by the `architecture` view).
   */
  group?: { heading: string; blurb: string };
  /**
   * A long list (run history, the execution log): the open section is a
   * bounded scroll region, with an Expand control in its header that shows it
   * at full length. The choice is remembered per section.
   */
  scroll?: boolean;
  /**
   * The view owns a full-height layout of its own (the Tasks tree: a pinned
   * filter bar over a virtual scroller that sizes itself from its container),
   * so the section gives it a bounded-height flex body to fill.
   */
  fill?: boolean;
  /** Hidden when this feature toggle is off (same keys as `useFeatureToggle`). */
  featureGate?: string;
  /** Built on demand by the server — absent from a static export. */
  requiresServer?: boolean;
}

export interface StageDef {
  id: StageId;
  sections: readonly StageSection[];
}

/** Loop order. The side stage links step through it and wrap. */
export const STAGE_ORDER: readonly StageId[] = ["analyze", "plan", "work"];

export const STAGES: Readonly<Record<StageId, StageDef>> = {
  analyze: {
    id: "analyze",
    sections: [
      { view: "overview", plain: true },
      {
        view: "graph",
        tabs: [
          { view: "iso-map", hiddenWhenDeployed: true },
          { view: "zones" },
        ],
        group: {
          heading: "Terrain",
          blurb: "The import graph — flat, in 3D, or clustered into zones.",
        },
      },
      { view: "files", scroll: true },
      { view: "problems" },
      { view: "suggestions" },
      { view: "architecture", tabs: [{ view: "routes" }] },
      { view: "pr-markdown", featureGate: "sourcevision.prMarkdown" },
      { view: "ask", featureGate: "sourcevision.ask", requiresServer: true },
    ],
  },
  plan: {
    id: "plan",
    sections: [
      { view: "analysis", plain: true },
      { view: "prd", open: true, fill: true },
      { view: "command-reference" },
      { view: "hench-runs", scroll: true },
      { view: "merge-graph" },
      { view: "validation" },
      { view: "requirements" },
    ],
  },
  work: {
    id: "work",
    sections: [
      { view: "rex-dashboard", plain: true },
      { view: "activity", scroll: true },
      { view: "hench-templates" },
      { view: "token-usage" },
      { view: "hench-audit" },
      { view: "hench-optimization" },
      { view: "hench-adaptive" },
      { view: "workspaces", requiresServer: true },
    ],
  },
};

/**
 * The stage's product, narrowed to the three packages.
 *
 * `VIEW_META` is declared `as const`, so indexing it by a `StageId` gives the
 * three literal products and not the wider `ViewProduct` — the stage's colour,
 * logo and CSS class come from the same table as its name, with no second
 * declaration to keep in step.
 */
export function stageProduct(stage: StageId): StageProduct {
  return VIEW_META[stage].product;
}

// ── Settings ───────────────────────────────────────────────────

export interface SettingsEntry {
  /** Label and glyph come from this view's entry in `view-meta.ts`. */
  view: ViewId;
  featureGate?: string;
}

/** Workflow order: General → analyze/plan → work → sync → export, then cross-cutting. */
export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { view: "llm-provider" },
  { view: "project-settings" },
  { view: "hench-config" },
  { view: "notion-config", featureGate: "rex.notionSync" },
  { view: "integrations", featureGate: "rex.integrations" },
  { view: "commands" },
  { view: "feature-toggles" },
  { view: "cli-timeouts" },
];

const SETTINGS_VIEWS: ReadonlySet<ViewId> = new Set(SETTINGS_ENTRIES.map((e) => e.view));

/** True for views that open in the settings overlay rather than the page. */
export function isSettingsView(view: ViewId): boolean {
  return SETTINGS_VIEWS.has(view);
}

// ── Live ───────────────────────────────────────────────────────

/**
 * The views under the Live tab. Live is not a stage: it sits after the stage
 * tabs, outside the Analysis → Plan → Work loop, so it is absent from
 * `STAGE_ORDER` and the prev/next stage links never reach it.
 */
export const LIVE_VIEWS: readonly ViewId[] = ["live", "live-task", "live-analyze"];

/** True for the Live overview and every page under it — the views that light the Live tab. */
export function isLiveView(view: ViewId): boolean {
  return LIVE_VIEWS.includes(view);
}

// ── Lookups ────────────────────────────────────────────────────

export function isStageId(view: ViewId): view is StageId {
  return view === "analyze" || view === "plan" || view === "work";
}

/**
 * The stage a view belongs to: the stage itself for a stage page, else the
 * stage listing it as a section. Each view is listed by at most one stage, so
 * the answer never depends on where the user came from — a view listed twice
 * would light the first stage in loop order even when opened from the second.
 * Given `validViews`, only stages this viewer has count: Token Usage is on
 * Work, so a Rex-only viewer has it in no stage. Null for home, settings, and
 * anything no (available) stage lists.
 */
export function stageForView(view: ViewId, validViews?: ReadonlySet<ViewId>): StageId | null {
  if (isStageId(view)) return view;
  for (const id of STAGE_ORDER) {
    if (validViews && !validViews.has(id)) continue;
    if (STAGES[id].sections.some((s) => s.view === view || s.tabs?.some((t) => t.view === view))) return id;
  }
  return null;
}

/** Stages with a page in this scope — the stage id is only a valid view in its own scope. */
export function visibleStages(validViews: ReadonlySet<ViewId>): StageId[] {
  return STAGE_ORDER.filter((id) => validViews.has(id));
}
