/**
 * The dashboard's layout, as data.
 *
 * Four stages in a loop — Analysis → Plan → Work → Tune → Analysis — each a page
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

export type StageId = "analyze" | "plan" | "work" | "tune";

export type StageProduct = "sourcevision" | "rex" | "hench";

export interface StageTab {
  /** The tab's own label, blurb and glyph come from its `view-meta.ts` entry. */
  view: ViewId;
  /** The tab's name where its view's own label would not read as one (Tasks → "Tree"). */
  label?: string;
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
  /**
   * A count read from project status (`/api/status`), shown as a pill after
   * the title so it is visible while the section is collapsed.
   */
  badge?: StageSectionBadge;
  /**
   * Open by default while the `badge` count is above zero. A stored open or
   * closed choice still wins.
   */
  openWhenNonEmpty?: boolean;
}

/** Counts a section header can show; each is read in `stage-pages.ts`. */
export type StageSectionBadge = "inbox";

/**
 * A part of the page that is not a view of its own — a panel the stage page
 * renders through the registry (`renderPanel`). Overview's Next steps and
 * Languages, split out so they can sit in tiles of their own.
 */
export type StagePanelId = "map" | "health" | "next-steps" | "languages" | "delivery" | "flow" | "product-map" | "changes-glance" | "outcomes";

/** Columns a tile spans on the 12-column dashboard grid. */
export type TileCols = 4 | 6 | 8 | 12;
/** Fixed-height grid rows a tile spans. */
export type TileRows = 1 | 2 | 3;

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
   * map), so the tile draws no header or border around it and does not open
   * full-screen itself — the panel is its view's embedded form.
   */
  chromeless?: boolean;
  /**
   * The panel is `view`'s embedded form but keeps the tile's header (Plan's
   * product area map), so the tile still places `view` on the page.
   */
  embedsView?: boolean;
  /**
   * A strip of links (Plan's lifecycle strip): full width above the grid, sized
   * by its content rather than a grid row, with no header or full-screen. It
   * places no view; `view` is only where it belongs.
   */
  band?: boolean;
  /** Grid columns spanned, of 12 (default 4: three tiles a row). */
  cols?: TileCols;
  /** Grid rows spanned (default 1). Every row has the same fixed height. */
  rows?: TileRows;
  /**
   * Further views shown as tabs once the tile is open full-screen (Architecture's
   * Routes). Each tab is still one view, reused unchanged, with its own route
   * and full page.
   */
  tabs?: readonly StageTab[];
  /** The name of the tile's own view as the first of its `tabs`, like `StageTab.label`. */
  tabLabel?: string;
  /** A live count in the tile header, read from project status like a section's. */
  badge?: StageSectionBadge;
  /** Shown only on a v2 project; a v1 project draws the stage's `v1Tiles` in their place. */
  v2Only?: boolean;
  /**
   * Dropped while the project has no PRD: the view would only tell the user to
   * migrate a PRD that does not exist.
   */
  requiresPrd?: boolean;
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
   * Tiles drawn instead of the `v2Only` ones on a v1 project, which has no
   * Inbox, changes or product map. These reuse views the v2 tiles already
   * place (Tasks is the Open changes tile's tab), so they add no placement.
   */
  v1Tiles?: readonly StageTile[];
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
  return !tile.panel || !!tile.chromeless || !!tile.embedsView;
}

/**
 * The tiles a stage draws for a project's PRD layout: on v1 the `v2Only` tiles
 * give way to `v1Tiles`, which take the first such tile's place.
 */
export function tilesForLayout(def: StageDef, layout: "v1" | "v2"): readonly StageTile[] {
  const tiles = def.tiles ?? [];
  if (layout === "v2" || !def.v1Tiles) return tiles;
  const first = tiles.findIndex((t) => t.v2Only);
  const kept = tiles.filter((t) => !t.v2Only);
  return first < 0 ? kept : [...kept.slice(0, first), ...def.v1Tiles, ...kept.slice(first)];
}

/** Loop order. The side stage links step through it and wrap. */
export const STAGE_ORDER: readonly StageId[] = ["analyze", "plan", "work", "tune"];

export const STAGES: Readonly<Record<StageId, StageDef>> = {
  analyze: {
    id: "analyze",
    // A dashboard: the analysis line and its controls, then tiles.
    sections: [{ view: "overview", plain: true }],
    // The map takes the top-left two thirds across three rows; health and
    // next steps fill the column beside it; the rest sit three to a row.
    tiles: [
      { view: "iso-map", panel: "map", title: "Codebase map", cols: 8, rows: 3, chromeless: true, hiddenWhenDeployed: true },
      { view: "overview", panel: "health", title: "Codebase health" },
      { view: "suggestions", panel: "next-steps", title: "Next steps", rows: 2 },
      { view: "overview", panel: "delivery", title: "Delivery & infrastructure", rows: 2 },
      { view: "problems" },
      { view: "suggestions" },
      { view: "zones" },
      { view: "architecture", tabs: [{ view: "routes" }] },
      { view: "files" },
      { view: "files", panel: "languages", title: "Languages" },
      { view: "pr-markdown", cols: 6, featureGate: "sourcevision.prMarkdown" },
      { view: "ask", cols: 6, featureGate: "sourcevision.ask", requiresServer: true },
    ],
    alsoOwns: ["graph"],
  },
  plan: {
    id: "plan",
    // The capture bar, then tiles. Product leads at full width (PP15); the
    // Inbox sits beside Open changes, which carries the PRD tree as a tab.
    sections: [{ view: "analysis", plain: true }],
    tiles: [
      // On both layouts: a v1 tree reads Pending, In progress and Next.
      { view: "changes", panel: "flow", title: "Lifecycle", band: true, requiresServer: true },
      // The area map; "Open" and full-screen show the whole Product page.
      { view: "product", panel: "product-map", title: "Product", embedsView: true, cols: 12, rows: 2, v2Only: true, requiresServer: true },
      { view: "inbox", cols: 4, rows: 2, badge: "inbox", v2Only: true, requiresServer: true },
      { view: "changes", panel: "changes-glance", title: "Open changes", embedsView: true, cols: 8, rows: 2, tabLabel: "List", tabs: [{ view: "prd", label: "Tree" }], v2Only: true, requiresServer: true },
      { view: "validation", cols: 6 },
    ],
    // A v1 tree has no Inbox, changes or product map: Tasks stands in for them.
    // Product stays, because its tablist is how a v1 project reaches Requirements.
    v1Tiles: [
      { view: "prd", cols: 8, rows: 2 },
      { view: "product", cols: 4, rows: 2, requiresServer: true, requiresPrd: true },
    ],
    // A tab of the Product page; its route still opens that tab. Tasks (`prd`)
    // keeps its route and breadcrumb under Plan as a tab of Open changes.
    alsoOwns: ["requirements"],
  },
  work: {
    id: "work",
    sections: [
      { view: "rex-dashboard", plain: true },
      { view: "hench-audit" },
      { view: "workspaces", requiresServer: true },
    ],
  },
  tune: {
    id: "tune",
    // The lead is the stage's own question (rendered by the registry); tiles
    // reuse existing views, as Analysis does.
    sections: [{ view: "tune", plain: true }],
    tiles: [
      // Tile titles, not view labels: "Suggestions" is the Analysis view's
      // label and labels are unique, and "Tuning" would read Tune › Tuning.
      { view: "hench-runs", cols: 8, rows: 2, tabs: [{ view: "activity" }] },
      { view: "token-usage", title: "Spend" },
      { view: "hench-optimization", title: "Suggestions", tabs: [{ view: "hench-adaptive" }] },
      { view: "merge-graph", title: "Shipped" },
      // Panel tile: "Open" goes to the Runs view, whose records it summarises.
      { view: "hench-runs", panel: "outcomes", title: "Outcomes by tier", rows: 2 },
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
  /** Views the page shows as tabs beside its own content; they open in the overlay too. */
  tabs?: readonly ViewId[];
}

/** Robot Wrangler → Project → Workflow, then Commands (which moves to the Commands sheet in #464). */
export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { view: "robot-wrangler" },
  { view: "project" },
  { view: "workflow" },
  { view: "commands", tabs: ["command-reference"] },
];

const SETTINGS_VIEWS: ReadonlySet<ViewId> = new Set(SETTINGS_ENTRIES.flatMap((e) => [e.view, ...(e.tabs ?? [])]));

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
  return STAGE_ORDER.includes(view as StageId);
}

/**
 * The stage a view belongs to: the stage itself for a stage page, else the
 * stage listing it as a section, a tile, or in `alsoOwns`. Each view is listed by at most one stage, so
 * the answer never depends on where the user came from — a view listed twice
 * would light the first stage in loop order even when opened from the second.
 * Given `validViews`, only what a stage shows in this viewer counts
 * (`stageShowsView`): Token Usage is on Tune, and a Rex viewer's borrowed Tune
 * does not show it, so there it is in no stage. Null for home, settings, and
 * anything no (available) stage lists.
 */
export function stageForView(view: ViewId, validViews?: ReadonlySet<ViewId>): StageId | null {
  if (isStageId(view)) return view;
  for (const id of STAGE_ORDER) {
    if (!stageViews(id).includes(view)) continue;
    if (!validViews || stageShowsView(id, view, validViews)) return id;
  }
  return null;
}

/**
 * Whether this viewer's copy of the stage shows the view. The stage and the
 * view must both be valid. A stage another scope borrows (Tune, hench's, in a
 * Rex viewer) shows only product views: a global view it lists (Spend) belongs
 * to the viewers that have the stage's own product, so a borrowed stage draws
 * no tile for it and opening it lights no stage. A viewer has a product when
 * some non-stage view of that product is valid.
 */
export function stageShowsView(id: StageId, view: ViewId, validViews: ReadonlySet<ViewId>): boolean {
  if (!validViews.has(id) || !validViews.has(view)) return false;
  if (VIEW_META[view].product !== "global") return true;
  const product = stageProduct(id);
  return [...validViews].some((v) => !isStageId(v) && VIEW_META[v].product === product);
}

/**
 * The tile as this viewer's copy of the stage shows it. A tile whose own view
 * is not shown but one of its tabs is (Runs in a Rex viewer, with the
 * Execution Log as its tab) is promoted: the first shown tab becomes the
 * tile's view and the rest follow it. Null when the stage shows nothing the
 * tile lists.
 */
export function tileForScope(stage: StageId, tile: StageTile, validViews: ReadonlySet<ViewId>): StageTile | null {
  const shows = (view: ViewId) => stageShowsView(stage, view, validViews);
  const tabs = (tile.tabs ?? []).filter((t) => shows(t.view));
  if (shows(tile.view)) return tabs.length === (tile.tabs ?? []).length ? tile : { ...tile, tabs };
  const [first, ...rest] = tabs;
  if (!first) return null;
  return { ...tile, view: first.view, tabs: rest, hiddenWhenDeployed: first.hiddenWhenDeployed ?? tile.hiddenWhenDeployed };
}

/**
 * Every view a stage lists, once each: its sections, its tiles and their tabs
 * (a panel tile's view included — it is where "Open" goes), and `alsoOwns`.
 */
export function stageViews(id: StageId): ViewId[] {
  const def = STAGES[id];
  return [...new Set<ViewId>([
    ...def.sections.map((s) => s.view),
    ...[...(def.tiles ?? []), ...(def.v1Tiles ?? [])].flatMap((t) => [t.view, ...(t.tabs ?? []).map((x) => x.view)]),
    ...(def.alsoOwns ?? []),
  ])];
}

/** Stages with a page in this scope — the stage id is only a valid view in its own scope. */
export function visibleStages(validViews: ReadonlySet<ViewId>): StageId[] {
  return STAGE_ORDER.filter((id) => validViews.has(id));
}
