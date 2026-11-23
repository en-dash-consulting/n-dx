/**
 * The dashboard's layout, as data.
 *
 * Three stages in a loop — Analysis → Plan → Work → Analysis — each a page
 * that composes existing product views as collapsible sections or tiles. Plan
 * and Work each split into two modes, toggled at the top of the page: Plan's
 * Create (how, why and what) and Preparation (who and when), Work's Now (what
 * is running, by whom, what is next and what a run costs) and Tune (how the
 * agent runs, with the settings that steer it). Every view
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
   * header: always rendered, never collapsible. At most one per stage, first.
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
 * renders through the registry (`renderPanel`): the Analyze tiles' visuals
 * and recommended fixes, Plan's strips and glances.
 */
export type StagePanelId =
  | "capture" | "map" | "glance" | "recommendations" | "changes-glance" | "plan-health" | "spec-gaps"
  | "outcomes" | "running" | "up-next" | "run-queue" | "agent-settings"
  | "plan-glance" | "plan-flow" | "plan-areas" | "inbox" | "work-stats" | "prd-tools";

/**
 * A panel behind a vertical tab at the page's right edge: pressing the tab
 * slides the panel in over the page (Plan's New change, From analysis and
 * Inbox). It renders `panel` through the registry, or `view` itself, opened.
 */
export interface StageSidePanel {
  /** Unique within the stage; the head action names a panel by it. */
  id: string;
  /** The tab's text. */
  label: string;
  /** The panel's heading. A page may word it its own way (`StagePage`'s `sidePanelTitle`). */
  title: string;
  /** One line under the heading: what the panel is for. */
  blurb: string;
  /** Where the panel's "Open" goes; also what is rendered when `panel` is unset. */
  view: ViewId;
  panel?: StagePanelId;
  /** A live count on the tab, read from project status like a tile's. */
  badge?: StageSectionBadge;
  /** Hidden on a v1 project, which has no Inbox or changes. */
  v2Only?: boolean;
  requiresServer?: boolean;
  /**
   * A part of the page the redesign has no place for yet, kept here rather
   * than removed (Plan's Open changes, Plan health, Specs to tighten). Grouped
   * after the panels the layout names, under a divider.
   */
  transitional?: boolean;
}

/** A button at the right of the stage's head that opens one of its side panels. */
export interface StageSideAction {
  label: string;
  /** A `StageSidePanel.id` of the same stage. */
  panel: string;
}

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
   * A strip of links (Plan's process steps and lifecycle strip): full width above the grid, sized
   * by its content rather than a grid row, with no header or full-screen. It
   * places no view; `view` is only where it belongs.
   */
  band?: boolean;
  /**
   * The tile is a working surface, not a preview (Plan's Inbox): its body takes
   * clicks, and its header and "Open to see all" go to `view`'s own page rather
   * than opening the tile full-screen.
   */
  opensPage?: boolean;
  /** Grid columns spanned, of 12 (default 4: three tiles a row). */
  cols?: TileCols;
  /** Grid rows spanned (default 1). Every row has the same fixed height. */
  rows?: TileRows;
  /**
   * Grow past `rows` to fit the content instead of clipping it (Plan's capture
   * tile, whose preview opens beneath the input). The tiles below move down.
   */
  grow?: boolean;
  /**
   * Further views shown as tabs once the tile is open full-screen (Architecture's
   * Routes). Each tab is still one view, reused unchanged, with its own route
   * and full page.
   */
  tabs?: readonly StageTab[];
  /** The name of the tile's own view as the first of its `tabs`, like `StageTab.label`. */
  tabLabel?: string;
  /**
   * Opened, the panel is a tab of its own, named this, ahead of `view` and
   * `tabs` (Codebase at a glance: its overview, then Zones, Files, Architecture and Routes).
   */
  panelTab?: string;
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

/** The modes a stage page toggles between. */
export type StageModeId = "create" | "prepare" | "now" | "tune";

/**
 * One half of a stage page that splits in two (Plan, Work). The page shows a
 * toggle under its head and the active mode's tiles beneath it. A mode with a
 * `view` is addressed by that view's route (`/tune` opens Work on Tune), so
 * the toggle navigates; one without is remembered per stage in the browser.
 */
export interface StageMode {
  id: StageModeId;
  label: string;
  /** The question the mode answers, shown beside its label ("How, why and what"). */
  focus: string;
  /** The route that opens the stage on this mode; the stage's own id for its default mode. */
  view?: ViewId;
  tiles: readonly StageTile[];
  /** Tiles drawn instead of the mode's `v2Only` ones on a v1 project, as `StageDef.v1Tiles`. */
  v1Tiles?: readonly StageTile[];
}

export interface StageDef {
  id: StageId;
  sections: readonly StageSection[];
  /**
   * The page is split into these modes, each with its own tiles; `tiles` and
   * `v1Tiles` are then unset. The first mode is the default.
   */
  modes?: readonly StageMode[];
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
  /**
   * Panels behind tabs at the page's right edge, the same in every mode. A
   * side panel places no view: a view it shows belongs to the stage through a
   * tile or `alsoOwns`, or to another stage (From analysis shows Analysis's
   * recommended fixes).
   */
  sidePanels?: readonly StageSidePanel[];
  /** A head button that opens one of the side panels (Plan's "Add to the plan"). */
  sideAction?: StageSideAction;
}

/**
 * Whether a tile puts its view on the page. A view tile does, and so does a
 * chromeless panel, which is its view's embedded form (the map); a panel that
 * only links to its view through "Open" (Recommended fixes) does not.
 */
export function tilePlacesView(tile: StageTile): boolean {
  return !tile.panel || !!tile.chromeless || !!tile.embedsView;
}

/**
 * The tiles a stage draws for a project's PRD layout: on v1 the `v2Only` tiles
 * give way to `v1Tiles`, which take the first such grid tile's place. A band
 * sits above the grid, so a v2-only band (Plan's process steps) is dropped
 * without moving the v1 tiles ahead of the grid tiles that precede that slot.
 */
export function tilesForLayout(def: Pick<StageDef, "tiles" | "v1Tiles">, layout: "v1" | "v2"): readonly StageTile[] {
  const tiles = def.tiles ?? [];
  if (layout === "v2" || !def.v1Tiles) return tiles;
  const first = tiles.findIndex((t) => t.v2Only && !t.band);
  const kept = tiles.filter((t) => !t.v2Only);
  if (first < 0) return tiles.some((t) => t.v2Only) ? [...kept, ...def.v1Tiles] : kept;
  // Where the slot falls among the kept tiles: those listed before it.
  const at = tiles.slice(0, first).filter((t) => !t.v2Only).length;
  return [...kept.slice(0, at), ...def.v1Tiles, ...kept.slice(at)];
}

/** Loop order. The side stage links step through it and wrap. */
export const STAGE_ORDER: readonly StageId[] = ["analyze", "plan", "work"];

export const STAGES: Readonly<Record<StageId, StageDef>> = {
  analyze: {
    id: "analyze",
    // A dashboard: the analysis line and its controls, then tiles.
    sections: [{ view: "overview", plain: true }],
    // Two tiles across the top — the visuals and basic numbers on the left,
    // the recommended fixes on the right — then the codebase map across the
    // full row below. Pressing a highlighted element on the left filters the
    // fixes; hovering a fix lights its zones on the map, which marks every
    // zone with issues "!".
    tiles: [
      {
        view: "zones", panel: "glance", title: "Codebase at a glance", cols: 6, rows: 2,
        embedsView: true, panelTab: "Overview",
        tabs: [{ view: "files" }, { view: "architecture" }, { view: "routes" }],
      },
      { view: "suggestions", panel: "recommendations", title: "Recommended fixes", cols: 6, rows: 2 },
      { view: "iso-map", panel: "map", title: "Codebase map", cols: 12, rows: 3, chromeless: true, hiddenWhenDeployed: true },
      { view: "ask", cols: 6, featureGate: "sourcevision.ask", requiresServer: true },
    ],
    // Problems and Suggestions are listed in the Recommended fixes tile, which
    // links to them; the flat Graph gave way to the codebase map.
    alsoOwns: ["graph", "problems", "suggestions"],
  },
  plan: {
    id: "plan",
    // No lead section. Two modes: Create holds writing and shaping the work
    // (what it is, why, and how it fits the product); Preparation holds who
    // takes it and when (assignees, releases, priority, where it stands).
    sections: [],
    modes: [
      {
        id: "create",
        label: "Create",
        focus: "How, why and what",
        // What you are doing, what matters most and what is next; then How
        // work moves, the stages with their counts, each focusing the areas
        // and the Inbox panel on it; then the product areas the work lands
        // in, filtered by whose work from the tile's own toggle. Adding work,
        // the analysis findings and the Inbox are side panels (`sidePanels`).
        tiles: [
          { view: "changes", panel: "plan-glance", title: "At a glance", band: true, v2Only: true, requiresServer: true },
          { view: "changes", panel: "plan-flow", title: "How work moves", band: true, v2Only: true, requiresServer: true },
          // The Product page's areas, each with the open changes moving it.
          // Full-screen and "Open" show the whole Product page.
          { view: "product", panel: "plan-areas", title: "Product areas", embedsView: true, cols: 12, rows: 3, grow: true, v2Only: true, requiresServer: true },
        ],
        // A v1 tree has no Inbox, changes or product map: Tasks stands in for them.
        // Product stays, because its tablist is how a v1 project reaches Requirements.
        v1Tiles: [
          { view: "prd", cols: 8, rows: 2 },
          { view: "product", cols: 4, rows: 2, requiresServer: true, requiresPrd: true },
        ],
      },
      {
        id: "prepare",
        label: "Preparation",
        focus: "Who and when",
        tiles: [
          // The full list: each open change with its assignee picker, release
          // and priority, under the assignee filter.
          // The Tasks tree is its Tree tab, now Create's Open changes tile is a side panel.
          { view: "changes", title: "Assign and schedule", cols: 8, rows: 3, tabLabel: "List", tabs: [{ view: "prd", label: "Tree" }], v2Only: true, requiresServer: true },
          // The planned run queue, the same one Work › Now shows: who does
          // what and when includes what the agent runs next. Its view is the
          // Tasks tree, Plan's own, since a view sits in one stage only (Work's
          // queue tile opens Runs).
          { view: "prd", panel: "run-queue", title: "Run queue", cols: 4, rows: 3, requiresServer: true },
        ],
        // A v1 tree assigns and prioritises in the task tree's detail panel.
        v1Tiles: [
          { view: "prd", title: "Assign and schedule", cols: 8, rows: 3 },
        ],
      },
    ],
    // Requirements is a tab of the Product page; its route still opens that
    // tab. The capture view, the Inbox and Validation now show in side panels,
    // which place no view, so they are owned here.
    alsoOwns: ["requirements", "analysis", "inbox", "validation"],
    sidePanels: [
      { id: "new-change", label: "New change", title: "Add to the plan", blurb: "Describe it, and n-dx suggests where it goes.", view: "analysis", panel: "capture", requiresServer: true },
      // The Analysis page's recommended fixes; "Open" goes to its Suggestions.
      { id: "from-analysis", label: "From analysis", title: "From analysis", blurb: "Findings from the last run, ready to plan.", view: "suggestions", panel: "recommendations" },
      { id: "inbox", label: "Inbox", title: "Inbox", blurb: "Waiting to be placed on the map.", view: "inbox", panel: "inbox", badge: "inbox", v2Only: true, requiresServer: true },
      // Create's tiles the new layout does not place yet, kept rather than removed.
      { id: "open-changes", label: "Open changes", title: "Open changes", blurb: "Placed open changes by stage, with their gaps.", view: "changes", panel: "changes-glance", v2Only: true, requiresServer: true, transitional: true },
      { id: "plan-health", label: "Plan health", title: "Plan health", blurb: "The last validation of the PRD, as lights.", view: "validation", panel: "plan-health", transitional: true },
      { id: "spec-gaps", label: "Specs to tighten", title: "Specs to tighten", blurb: "Open changes missing criteria or blocked.", view: "changes", panel: "spec-gaps", v2Only: true, requiresServer: true, transitional: true },
    ],
    sideAction: { label: "Add to the plan", panel: "new-change" },
  },
  work: {
    id: "work",
    sections: [],
    modes: [
      {
        // What is happening and what happens next: the runs going now and who
        // they are for beside the planned run queue (what `ndx work` takes
        // next, before its own pick), then the PRD's numbers in one section.
        // The full Ready to run list is Tune's first tile.
        id: "now",
        label: "Now",
        focus: "Who is working on what, and what is next",
        view: "work",
        tiles: [
          { view: "hench-runs", panel: "running", title: "Running now", cols: 8, rows: 2, grow: true, requiresServer: true },
          { view: "hench-runs", panel: "run-queue", title: "Run queue", cols: 4, rows: 2, grow: true, requiresServer: true },
          // Totals, status, priority and structure health, from the Rex
          // dashboard. No change progress: that is Plan's to show.
          { view: "rex-dashboard", panel: "work-stats", title: "Statistics", embedsView: true, cols: 12, rows: 2, grow: true },
        ],
      },
      {
        // How the agent runs: the queue `ndx work` picks from (yours first,
        // then the unassigned by product area, each card addable to the run
        // queue), the settings that steer it, then what its runs produced and
        // cost. Reached at `/tune`.
        id: "tune",
        label: "Tune",
        focus: "How the agent runs",
        view: "tune",
        tiles: [
          { view: "hench-runs", panel: "up-next", title: "Ready to run", cols: 12, rows: 3, grow: true, requiresServer: true },
          // Editable here and in Settings: the same endpoints, each section
          // linking to the Settings page that holds the rest.
          { view: "hench-optimization", panel: "agent-settings", title: "Agent settings", cols: 12, rows: 3, grow: true, requiresServer: true },
          // Tile titles, not view labels: "Suggestions" is the Analysis view's
          // label and labels are unique.
          { view: "hench-runs", cols: 8, rows: 2, tabs: [{ view: "activity" }] },
          { view: "token-usage", title: "Spend" },
          // The audit of what runs did to each task, beside the runs it reads.
          { view: "hench-audit", cols: 8, rows: 2 },
          { view: "hench-optimization", title: "Suggestions", tabs: [{ view: "hench-adaptive" }] },
          { view: "merge-graph", title: "Shipped" },
          // Panel tile: "Open" goes to the Runs view, whose records it summarises.
          { view: "hench-runs", panel: "outcomes", title: "Outcomes by tier", rows: 2 },
        ],
      },
    ],
    // Workspaces moved to Settings; the Rex dashboard's numbers are the
    // Statistics tile and the audit is a Tune tile, so nothing is left here.
    sidePanels: [
      // The dashboard's quick actions, kept rather than removed.
      { id: "prd-tools", label: "PRD tools", title: "PRD tools", blurb: "Browse, validate, reorganize or restore the PRD.", view: "prd", panel: "prd-tools", transitional: true },
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

/**
 * Robot Wrangler → Project → Workflow → Workspaces, then Commands (which moves
 * to the Commands sheet in #464). Workspaces shows as a dropdown that expands
 * to the worktree list.
 */
export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { view: "robot-wrangler" },
  { view: "project" },
  { view: "workflow" },
  { view: "workspaces" },
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
 * (`stageShowsView`): Token Usage is on Work, and a Rex viewer's borrowed Work
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
 * view must both be valid. A stage another scope borrows (Work, hench's, in a
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
 * (a panel tile's view included — it is where "Open" goes) in every mode, the
 * routes of its modes (`tune`), and `alsoOwns`.
 */
export function stageViews(id: StageId): ViewId[] {
  const def = STAGES[id];
  const modes = def.modes ?? [];
  const tiles = [def, ...modes].flatMap((part) => [...(part.tiles ?? []), ...(part.v1Tiles ?? [])]);
  return [...new Set<ViewId>([
    ...def.sections.map((s) => s.view),
    ...tiles.flatMap((t) => [t.view, ...(t.tabs ?? []).map((x) => x.view)]),
    ...modes.flatMap((m) => (m.view && m.view !== id ? [m.view] : [])),
    ...(def.alsoOwns ?? []),
  ])];
}

/** Every tile a stage draws on a v2 project, across its modes, in order. */
export function stageTiles(id: StageId): StageTile[] {
  const def = STAGES[id];
  return [def, ...(def.modes ?? [])].flatMap((part) => [...(part.tiles ?? [])]);
}

/**
 * The mode a route opens a stage on: the mode whose `view` it is (`tune` →
 * Work's Tune), else null — the page then shows its remembered or first mode.
 */
export function modeForView(id: StageId, view: ViewId): StageModeId | null {
  return STAGES[id].modes?.find((m) => m.view === view)?.id ?? null;
}

/** True for a route that opens a stage on one of its modes rather than a page of its own (`tune`). */
export function isStageModeView(view: ViewId): boolean {
  return STAGE_ORDER.some((id) => !isStageId(view) && modeForView(id, view) !== null);
}

/** Stages with a page in this scope — the stage id is only a valid view in its own scope. */
export function visibleStages(validViews: ReadonlySet<ViewId>): StageId[] {
  return STAGE_ORDER.filter((id) => validViews.has(id));
}
