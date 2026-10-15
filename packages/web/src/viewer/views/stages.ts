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
   * from this view's entry in `view-meta.ts`; there is no per-section
   * override.
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

/**
 * A part of the page that is not a view of its own — a panel the stage page
 * renders through the registry (`renderPanel`). Overview's Next steps and
 * Languages, split out so they can sit in tiles of their own.
 */
export type StagePanelId = "map" | "next-steps" | "languages";

/** How much of the tile grid a tile spans: the full row (hero, wide) or one cell. */
export type TileSize = "hero" | "wide" | "normal";

export interface StageTile {
  /**
   * The view the tile opens to — in place, full-screen, and on its own page
   * through "Open". Its label, blurb and glyph name the tile.
   */
  view: ViewId;
  /** Render this panel instead of `view` itself; "Open" still goes to `view`. */
  panel?: StagePanelId;
  /** Heading for a panel tile, which is not named by its view. */
  title?: string;
  /**
   * The panel brings its own header, controls and full-screen (the codebase
   * map), so the tile draws no header or border around it and cannot be
   * expanded — the panel is its view's embedded form.
   */
  chromeless?: boolean;
  size?: TileSize;
  /**
   * Further views shown as tabs once the tile is expanded (Architecture's
   * Routes). Each tab is still one view, reused unchanged, with its own route
   * and full page.
   */
  tabs?: readonly StageTab[];
  featureGate?: string;
  requiresServer?: boolean;
  hiddenWhenDeployed?: boolean;
}

export interface StageDef {
  id: StageId;
  sections: readonly StageSection[];
  /**
   * When set, the stage page renders these as a dashboard grid after its
   * plain lead section, instead of the stacked collapsible `sections`.
   */
  tiles?: readonly StageTile[];
  /**
   * Views that belong to this stage with no place on its page — still opened
   * by route and named under this stage in the breadcrumb (the flat Graph,
   * which the Analyze dashboard dropped in favour of the codebase map).
   */
  alsoOwns?: readonly ViewId[];
}

/**
 * Whether a tile puts its view on the page. A view tile does, and so does a
 * chromeless panel, which is its view's embedded form (the map); a panel that
 * only links to its view through "Open" (Next steps, Languages) does not.
 */
export function tilePlacesView(tile: StageTile): boolean {
  return !tile.panel || !!tile.chromeless;
}

/** Loop order. The side stage links step through it and wrap. */
export const STAGE_ORDER: readonly StageId[] = ["analyze", "plan", "work"];

export const STAGES: Readonly<Record<StageId, StageDef>> = {
  analyze: {
    id: "analyze",
    // A dashboard: the lead line and stats, then tiles.
    sections: [{ view: "overview", plain: true }],
    tiles: [
      { view: "iso-map", panel: "map", title: "Codebase map", size: "hero", chromeless: true, hiddenWhenDeployed: true },
      { view: "suggestions", panel: "next-steps", title: "Next steps" },
      { view: "problems" },
      { view: "suggestions" },
      { view: "zones" },
      { view: "files" },
      { view: "architecture", tabs: [{ view: "routes" }] },
      { view: "files", panel: "languages", title: "Languages" },
      { view: "pr-markdown", featureGate: "sourcevision.prMarkdown" },
      { view: "ask", featureGate: "sourcevision.ask", requiresServer: true },
    ],
    alsoOwns: ["graph"],
  },
  plan: {
    id: "plan",
    sections: [
      { view: "analysis", plain: true },
      { view: "prd", open: true, fill: true },
      { view: "product", requiresServer: true },
      { view: "changes", requiresServer: true },
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
}

/** Robot Wrangler → Project → Workflow, then Commands (which moves to the Commands sheet in #464). */
export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { view: "robot-wrangler" },
  { view: "project" },
  { view: "workflow" },
  { view: "commands" },
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
 * stage listing it as a section, a tile, or in `alsoOwns`. Each view is listed by at most one stage, so
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
    if (stageViews(id).includes(view)) return id;
  }
  return null;
}

/**
 * Every view a stage lists, once each: its sections, its tiles and their tabs
 * (a panel tile's view included — it is where "Open" goes), and `alsoOwns`.
 */
export function stageViews(id: StageId): ViewId[] {
  const def = STAGES[id];
  return [...new Set<ViewId>([
    ...def.sections.map((s) => s.view),
    ...(def.tiles ?? []).flatMap((t) => [t.view, ...(t.tabs ?? []).map((x) => x.view)]),
    ...(def.alsoOwns ?? []),
  ])];
}

/** Stages with a page in this scope — the stage id is only a valid view in its own scope. */
export function visibleStages(validViews: ReadonlySet<ViewId>): StageId[] {
  return STAGE_ORDER.filter((id) => validViews.has(id));
}
