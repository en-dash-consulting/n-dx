/**
 * View registry — maps ViewId to render functions.
 *
 * Centralizes all view component imports and the view-to-component
 * dispatch logic. main.ts imports only `renderActiveView` and
 * `buildValidViews` from here instead of 22 individual view modules.
 */

import { h, Fragment } from "preact";
import type { ComponentChild, VNode } from "preact";
import type { ViewId, NavigateTo, DetailItem, LoadedData, AskSeed } from "../types.js";
import type { DegradableFeature } from "../performance/index.js";
import type { JobTray } from "../hooks/index.js";

// ── View component imports (via domain barrels) ────────────────
//
// Each domain barrel groups related view components behind a single
// import boundary. This creates natural decomposition points that:
//   - Make the import surface explicit and auditable
//   - Enable future lazy-loading per domain
//   - Reduce the blast radius of view-level changes

import {
  Overview,
  AnalysisStatus,
  MapPanel,
  Graph,
  IsoMapView,
  ZonesView,
  FilesView,
  ArchitectureView,
  ProblemsView,
  SuggestionsView,
  RoutesView,
  AskView,
} from "./domain-sourcevision.js";

import {
  PRDView,
  AnalysisView,
  RexDashboard,
  TokenUsageView,
  ValidationView,
  ActivityView,
  TaskAuditView,
  WorkflowOptimizationView,
  MergeGraphView,
  ProductPage,
  ChangesPage,
  InboxPage,
  InboxTriagePage,
  INBOX_SECTION_ROWS,
} from "./domain-rex.js";

import {
  HenchRunsView,
  AdaptiveOptimizationView,
  OutcomesPanel,
} from "./domain-hench.js";

import { WorkspacesView } from "./domain-workspaces.js";
import { LiveView, LiveTaskView, LiveAnalyzeView } from "./domain-live.js";
import { isoMapAnalysisStamp } from "./iso-map-url.js";
import { HomeView, StagePage } from "./stage-pages.js";
import { RunningNow, UpNext } from "./work-now.js";
import { AgentSettingsPanel } from "./agent-settings.js";
import { ChangesGlance } from "./changes-glance.js";
import { ChangesSummaryProvider } from "./changes-summary-context.js";
import { PlanHealth } from "./plan-health.js";
import { SpecGapsPanel } from "./spec-gaps.js";
import { AnalyzeControls, PrepareTaskModal } from "../components/index.js";
import { isSettingsView, STAGES, type StageId, type StagePanelId, type StageSidePanel, type StageTile } from "./stages.js";
import { GlancePanel } from "./glance.js";
import { RecommendationsPanel } from "./recommendations-panel.js";
import { AnalyzeActionsProvider } from "./analyze-actions-context.js";
import { SpendSummary } from "./spend-summary.js";
import { PlanGlance } from "./plan-glance.js";
import { PlanAreas } from "./plan-areas.js";
import { PlanInbox } from "./plan-inbox.js";
import { PlanHeadControls } from "./plan-tour.js";
import { PrdTools, WorkStats } from "./work-stats.js";
import { SettingsDisclosure } from "./settings-disclosure.js";
import type { TileGridApi } from "./stage-tiles.js";
import { buildValidViews as buildValidViewsForScope } from "../external.js";
import { areaCapabilityOfTab, areaSlugOfTab, placeChangeOfTab } from "../route-state.js";

import {
  WorkflowView,
  CommandsView,
  CommandReferenceView,
  RobotWranglerView,
  ProjectView,
} from "./domain-settings.js";

// ── View render context ────────────────────────────────────────

/** Props available to any view render function. */
export interface ViewRenderContext {
  data: LoadedData;
  /** The analysis modules read after the first paint are still on their way (`useAppData`). */
  analysisLoading?: boolean;
  setDetail: (item: DetailItem | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setPrdDetailContent: (content: VNode<any> | null) => void;
  selectedFile: string | null;
  setSelectedFile: (f: string | null) => void;
  selectedZone: string | null;
  selectedRunId: string | null;
  selectedTaskId: string | null;
  /** The tab the route names on a view that keeps it in its path (Commands: `reference`). */
  selectedTab?: string | null;
  /** The area slug `?area=` names on Open changes, which it filters to that area. */
  selectedArea?: string | null;
  /** The Product page reports the capability it has open, so Sidecar can attach it. */
  setOpenCapability?: (id: string | null) => void;
  /** The PRD page reports the item selected in its tree, which the route does not carry. */
  setOpenTask?: (id: string | null) => void;
  /** The Zones page reports the zone open in its slideout, which the route does not carry. */
  setOpenZone?: (id: string | null) => void;
  /** Attach a Workspaces worktree card to Sidecar (null detaches); absent while Sidecar is off. */
  attachWorktree?: (key: string | null) => void;
  /** The worktree card attached to Sidecar, by workspace key. */
  attachedWorktree?: string | null;
  /**
   * Whether the detail panel (a file, zone or PRD item) is showing beside the
   * page, so a full-screen dashboard tile leaves room for it.
   */
  detailOpen?: boolean;
  /** Finding the Ask panel was entered with, when it was entered from one. */
  askSeed: AskSeed | null;
  navigateTo: NavigateTo;
  isFeatureDisabled: (feature: DegradableFeature) => boolean;
  /**
   * State of the `sourcevision.ask` toggle, read by the caller.
   *
   * Views that offer a route into Ask must honour it: the toggle is the only
   * control the user has over Ask, and the sidebar that hosts that control is
   * itself hidden when the toggle is off.
   */
  askEnabled: boolean;
  /**
   * The shared job tray: every async job in flight, plus start-refresh and
   * stop. Views that trigger a long-running command read their own job from
   * here instead of polling its status endpoint themselves.
   */
  jobs: JobTray;
  /**
   * The views this viewer has (scope-filtered). The landing and stage pages
   * list only what exists here; absent, every view is assumed to exist.
   */
  validViews?: ReadonlySet<ViewId>;
  /**
   * Rendered inside a stage page's section rather than on its own page, so a
   * long list may show its head and link to the full page (the Inbox).
   */
  inSection?: boolean;
}

// ── Registry ───────────────────────────────────────────────────

type ViewRenderer = (ctx: ViewRenderContext) => ComponentChild;

function validViewsOf(ctx: ViewRenderContext): ReadonlySet<ViewId> {
  return ctx.validViews ?? buildValidViewsForScope(null);
}

/** Work's folded tiles: Spend (on Tune) shows its essentials; the rest preview their view. */
function workTileSummary(tile: StageTile): ComponentChild | null {
  return tile.view === "token-usage" && !tile.panel ? h(SpendSummary, null) : null;
}

/**
 * A stage page, rendering each of its sections and tiles through this registry.
 * `route` is the view that opened it when that is one of the stage's modes
 * (`tune` opens Work on Tune).
 */
function stage(id: StageId, route: ViewId = id): ViewRenderer {
  const page: ViewRenderer = (ctx) => h(StagePage, {
    stage: id,
    view: route,
    validViews: validViewsOf(ctx),
    navigateTo: ctx.navigateTo,
    // On a tiled stage the lead Overview drops what its tiles show.
    renderView: (view: ViewId) => (view === "overview" && STAGES[id].tiles
      ? h(Overview, { data: ctx.data, jobs: ctx.jobs, variant: "lead", loading: ctx.analysisLoading })
      : renderActiveView(view, { ...ctx, inSection: true })),
    renderPanel: (panel: StagePanelId, opened: boolean, grid: TileGridApi) => renderPanel(panel, opened, grid, ctx),
    renderSummary: id === "work" ? workTileSummary : undefined,
    // A side panel shows its panel opened, or its view; the capture panel's
    // More would open a tile, and a side panel has none, so it gets a grid
    // that opens nothing.
    renderSidePanel: (side: StageSidePanel) => side.panel
      ? renderPanel(side.panel, true, NO_GRID, ctx)
      : renderActiveView(side.view, { ...ctx, inSection: true }),
    detailOpen: ctx.detailOpen ?? false,
    headStatus: id === "analyze" ? h(AnalysisStatus, { data: ctx.data }) : null,
    headActions: id === "analyze" ? h(AnalyzeControls, { jobs: ctx.jobs })
      : id === "plan" ? h(PlanHeadControls, null)
      : null,
  });
  // Plan's glance cards, product areas and open-changes panel share one
  // summary read (its capture draft is shared from main.ts, above the
  // router); Analyze's tiles and map share what to do, and the item hovered.
  return id === "plan"
    ? (ctx) => h(ChangesSummaryProvider, null, page(ctx))
    : id === "analyze"
      ? (ctx) => h(AnalyzeActionsProvider, { data: ctx.data }, page(ctx))
      : page;
}

/** A tile grid that opens nothing: what a side panel's content is given. */
const NO_GRID: TileGridApi = { openTile: () => {}, focus: null };

/** The parts of a stage page that are not views of their own. */
function renderPanel(panel: StagePanelId, opened: boolean, grid: TileGridApi, ctx: ViewRenderContext): ComponentChild {
  switch (panel) {
    // The tile is the capture row; its modal (More, or the header) is the whole view.
    case "capture": return opened
      ? h(AnalysisView, { navigateTo: ctx.navigateTo })
      : h(AnalysisView, { navigateTo: ctx.navigateTo, onMore: () => grid.openTile("capture") });
    case "map": return h(MapPanel, { data: ctx.data, navigateTo: ctx.navigateTo, opened, onExpand: () => grid.openTile("map") });
    case "glance": return h(GlancePanel, { data: ctx.data, opened, setDetail: ctx.setDetail, loading: ctx.analysisLoading });
    case "recommendations": return h(RecommendationsPanel, { data: ctx.data, opened, navigateTo: ctx.navigateTo });
    case "changes-glance": return h(ChangesGlance, { navigateTo: ctx.navigateTo });
    case "spec-gaps": return h(SpecGapsPanel, { navigateTo: ctx.navigateTo });
    case "plan-health": return opened ? h(ValidationView, { navigateTo: ctx.navigateTo }) : h(PlanHealth, null);
    case "outcomes": return h(OutcomesPanel, null);
    case "running": return h(RunningNow, { navigateTo: ctx.navigateTo });
    case "up-next": return h(UpNext, { navigateTo: ctx.navigateTo });
    case "agent-settings": return h(AgentSettingsPanel, { navigateTo: ctx.navigateTo });
    case "plan-glance": return h(PlanGlance, { navigateTo: ctx.navigateTo });
    // Full-screen and "Open" show the whole Product page.
    case "plan-areas": return opened
      ? h(ProductPage, { key: "product", onCapabilityChange: ctx.setOpenCapability, navigateTo: ctx.navigateTo })
      : h(PlanAreas, { navigateTo: ctx.navigateTo });
    // The whole Inbox, not the section's first rows (the side panel scrolls),
    // under Plan's For me / Everyone and Solo / Team, its rows draggable onto
    // the product areas.
    case "inbox": return h(PlanInbox, { navigateTo: ctx.navigateTo });
    // Full-screen and "Open" show the whole Rex dashboard.
    case "work-stats": return opened ? h(RexDashboard, { navigateTo: ctx.navigateTo }) : h(WorkStats, null);
    case "prd-tools": return h(PrdTools, { navigateTo: ctx.navigateTo });
  }
}

const REGISTRY: Record<string, ViewRenderer> = {
  "home": (ctx) =>
    h(HomeView, { validViews: validViewsOf(ctx), navigateTo: ctx.navigateTo }),

  "analyze": stage("analyze"),
  "plan": stage("plan"),
  // Work's Tune mode: the Work page, opened on Tune.
  "tune": stage("work", "tune"),
  // `/work/prep/<taskId>` is the Work page with the Prepare task modal open
  // over it; closing returns to `/work`, a start hands off to Live.
  "work": (ctx) => h(Fragment, null,
    stage("work")(ctx),
    ctx.selectedTaskId
      ? h(PrepareTaskModal, {
          key: ctx.selectedTaskId,
          taskId: ctx.selectedTaskId,
          onClose: () => ctx.navigateTo("work"),
          onOpenLive: (taskId: string) => ctx.navigateTo("live-task", { taskId }),
        })
      : null,
  ),

  // A Settings page: the worktree list behind a dropdown that expands it.
  "workspaces": ({ attachWorktree, attachedWorktree }) =>
    h(SettingsDisclosure, {
      id: "workspaces",
      title: "Workspaces",
      blurb: "Every worktree of this repository, its branch, and what is uncommitted or unmerged.",
    },
      h(WorkspacesView, { onAttachSidecar: attachWorktree, attachedWorktree: attachedWorktree ?? null }),
    ),

  "live": ({ data, navigateTo, jobs }) =>
    h(LiveView, { navigateTo, analyzedAt: data.manifest?.analyzedAt ?? null, jobs }),

  // Keyed by task: switching tasks in place starts a fresh page, not the last one's run choice.
  "live-task": (ctx) =>
    ctx.selectedTaskId
      ? h(LiveTaskView, { key: ctx.selectedTaskId, taskId: ctx.selectedTaskId, navigateTo: ctx.navigateTo })
      : REGISTRY["live"](ctx),

  "live-analyze": ({ navigateTo }) =>
    h(LiveAnalyzeView, { navigateTo }),

  // navigateTo is what lets the iso hero offer "Options" (→ the map's form);
  // without it the Overview hero had Rebuild and Expand but no way there.
  "overview": ({ data, jobs, navigateTo, analysisLoading }) =>
    h(Overview, { data, jobs, navigateTo, loading: analysisLoading }),

  "graph": ({ data, setDetail, selectedFile, selectedZone, navigateTo }) =>
    h(Graph, { data, onSelect: setDetail, selectedFile, selectedZone, navigateTo }),

  "iso-map": ({ data }) =>
    h(IsoMapView, { analysisStamp: isoMapAnalysisStamp(data) }),

  "zones": ({ data, setDetail, setOpenZone, navigateTo }) =>
    h(ZonesView, { data, onSelect: setDetail, onOpenZoneChange: setOpenZone, navigateTo }),

  "files": ({ data, setDetail, selectedFile, setSelectedFile, selectedZone, navigateTo }) =>
    h(FilesView, { data, onSelect: setDetail, selectedFile, setSelectedFile, selectedZone, navigateTo }),

  "routes": ({ data }) =>
    h(RoutesView, { data }),

  "architecture": ({ data, setDetail, navigateTo }) =>
    h(ArchitectureView, { data, onSelect: setDetail, navigateTo }),

  "problems": ({ data, navigateTo, askEnabled }) =>
    h(ProblemsView, { data, navigateTo, askEnabled }),

  "suggestions": ({ data, navigateTo, askEnabled, jobs }) =>
    h(SuggestionsView, { data, navigateTo, askEnabled, jobs }),

  "ask": ({ askSeed, jobs }) =>
    h(AskView, { seed: askSeed, jobs }),

  "rex-dashboard": ({ navigateTo }) =>
    h(RexDashboard, { navigateTo }),

  "prd": ({ setDetail, setPrdDetailContent, selectedTaskId, setOpenTask, navigateTo }) =>
    h(PRDView, { onSelectItem: setDetail, onDetailContent: setPrdDetailContent, initialTaskId: selectedTaskId, onSelectedItemChange: setOpenTask, navigateTo }),

  // Keyed apart from "requirements", which renders the same page in the same
  // slot: without the key, moving between the two routes would keep the
  // previous route's tab.
  "product": ({ setOpenCapability, selectedTab, navigateTo }) =>
    h(ProductPage, {
      key: "product",
      onCapabilityChange: setOpenCapability,
      areaSlug: areaSlugOfTab(selectedTab ?? null),
      areaCapabilityId: areaCapabilityOfTab(selectedTab ?? null),
      placeChangeId: placeChangeOfTab(selectedTab ?? null),
      onLeaveArea: () => navigateTo("product"),
      navigateTo,
    }),

  "changes": ({ navigateTo, selectedArea }) =>
    h(ChangesPage, { navigateTo, area: selectedArea ?? null }),

  // The Plan section shows a few rows; the page is the triage queue.
  "inbox": ({ navigateTo, inSection }) =>
    inSection
      ? h(InboxPage, { navigateTo, limit: INBOX_SECTION_ROWS })
      : h(InboxTriagePage, { navigateTo }),

  "analysis": ({ navigateTo }) =>
    h(AnalysisView, { navigateTo }),

  "merge-graph": ({ navigateTo }) =>
    h(MergeGraphView, { navigateTo }),

  "token-usage": () =>
    h(TokenUsageView, null),

  "validation": ({ navigateTo }) =>
    h(ValidationView, { navigateTo }),

  // Requirements is a tab of the Product page; the route opens that tab.
  "requirements": ({ setOpenCapability }) =>
    h(ProductPage, { key: "requirements", onCapabilityChange: setOpenCapability, initialTab: "requirements" }),

  "activity": () =>
    h(ActivityView, null),

  "hench-runs": ({ navigateTo, selectedRunId }) =>
    h(HenchRunsView, { navigateTo, initialRunId: selectedRunId }),

  "hench-audit": ({ navigateTo }) =>
    h(TaskAuditView, { navigateTo }),

  "hench-optimization": () =>
    h(WorkflowOptimizationView, null),

  "hench-adaptive": () =>
    h(AdaptiveOptimizationView, null),

  "workflow": ({ navigateTo }) =>
    h(WorkflowView, { navigateTo }),

  "commands": ({ jobs, navigateTo, selectedTab }) =>
    h(CommandsView, { jobs, navigateTo, tab: selectedTab === "reference" ? "reference" : "run" }),

  "command-reference": () =>
    h(CommandReferenceView, null),

  "robot-wrangler": () =>
    h(RobotWranglerView, null),

  "project": () =>
    h(ProjectView, null),
};

/** Render the view identified by `view` using props from `ctx`. */
export function renderActiveView(view: ViewId, ctx: ViewRenderContext): ComponentChild {
  const renderer = REGISTRY[view];
  return renderer ? renderer(ctx) : null;
}

/**
 * What a view shows while the analysis data may still be loading. Settings
 * views read none of that data, so they render at once; every other view waits
 * behind the loading state.
 */
export function renderViewContent(view: ViewId, loading: boolean, ctx: ViewRenderContext): ComponentChild {
  if (loading && !isSettingsView(view)) {
    return h("div", { class: "loading", role: "status", "aria-live": "polite" }, "Loading...");
  }
  return renderActiveView(view, ctx);
}

export { buildValidViews } from "../external.js";
