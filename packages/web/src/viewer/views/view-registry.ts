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
  CodebaseStats,
  HealthDetail,
  MapPanel,
  LanguagesPanel,
  NextStepsPanel,
  Graph,
  IsoMapView,
  ZonesView,
  FilesView,
  ArchitectureView,
  ProblemsView,
  SuggestionsView,
  PRMarkdownView,
  RoutesView,
  AskView,
} from "./domain-sourcevision.js";

import {
  PRDView,
  AnalysisView,
  RexDashboard,
  TokenUsageView,
  ValidationView,
  RequirementsView,
  ActivityView,
  TaskAuditView,
  WorkflowOptimizationView,
  MergeGraphView,
  ProductPage,
  ChangesPage,
} from "./domain-rex.js";

import {
  HenchRunsView,
  AdaptiveOptimizationView,
} from "./domain-hench.js";

import { WorkspacesView } from "./domain-workspaces.js";
import { LiveView, LiveTaskView, LiveAnalyzeView } from "./domain-live.js";
import { isoMapAnalysisStamp } from "./iso-map-url.js";
import { HomeView, StagePage } from "./stage-pages.js";
import { AnalyzeControls, PrepareTaskModal } from "../components/index.js";
import { isSettingsView, STAGES, type StageId, type StagePanelId, type StageTile } from "./stages.js";
import { analyzeTileSummary } from "./tile-summaries.js";
import type { TileGridApi } from "./stage-tiles.js";
import { buildValidViews as buildValidViewsForScope } from "../external.js";

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
  setDetail: (item: DetailItem | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setPrdDetailContent: (content: VNode<any> | null) => void;
  selectedFile: string | null;
  setSelectedFile: (f: string | null) => void;
  selectedZone: string | null;
  selectedRunId: string | null;
  selectedTaskId: string | null;
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
}

// ── Registry ───────────────────────────────────────────────────

type ViewRenderer = (ctx: ViewRenderContext) => ComponentChild;

function validViewsOf(ctx: ViewRenderContext): ReadonlySet<ViewId> {
  return ctx.validViews ?? buildValidViewsForScope(null);
}

/** A stage page, rendering each of its sections and tiles through this registry. */
function stage(id: StageId): ViewRenderer {
  return (ctx) => h(StagePage, {
    stage: id,
    validViews: validViewsOf(ctx),
    navigateTo: ctx.navigateTo,
    // On a tiled stage the lead Overview drops what its tiles show.
    renderView: (view: ViewId) => (view === "overview" && STAGES[id].tiles
      ? h(Overview, { data: ctx.data, jobs: ctx.jobs, variant: "lead" })
      : renderActiveView(view, ctx)),
    renderPanel: (panel: StagePanelId, opened: boolean, grid: TileGridApi) => renderPanel(panel, opened, grid, ctx),
    renderSummary: id === "analyze" ? (tile: StageTile) => analyzeTileSummary(tile, ctx.data) : undefined,
    detailOpen: ctx.detailOpen ?? false,
    headStatus: id === "analyze" ? h(AnalysisStatus, { data: ctx.data }) : null,
    headActions: id === "analyze" ? h(AnalyzeControls, { jobs: ctx.jobs }) : null,
  });
}

/** The parts of a stage page that are not views of their own. */
function renderPanel(panel: StagePanelId, opened: boolean, grid: TileGridApi, ctx: ViewRenderContext): ComponentChild {
  switch (panel) {
    case "map": return h(MapPanel, { data: ctx.data, navigateTo: ctx.navigateTo, opened, onExpand: () => grid.openTile("map") });
    case "health": return opened
      ? h(HealthDetail, { data: ctx.data, openTile: grid.openTile, setDetail: ctx.setDetail })
      : h(CodebaseStats, { data: ctx.data });
    case "next-steps": return h(NextStepsPanel, { embedded: true });
    case "languages": return h(LanguagesPanel, { data: ctx.data, opened });
  }
}

const REGISTRY: Record<string, ViewRenderer> = {
  "home": (ctx) =>
    h(HomeView, { validViews: validViewsOf(ctx), navigateTo: ctx.navigateTo }),

  "analyze": stage("analyze"),
  "plan": stage("plan"),
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

  "workspaces": () =>
    h(WorkspacesView, null),

  "live": ({ data, navigateTo, jobs }) =>
    h(LiveView, { navigateTo, analyzedAt: data.manifest?.analyzedAt ?? null, jobs }),

  // Keyed by task: switching tasks in place starts a fresh page, not the last one's run choice.
  "live-task": (ctx) =>
    ctx.selectedTaskId
      ? h(LiveTaskView, { key: ctx.selectedTaskId, taskId: ctx.selectedTaskId, navigateTo: ctx.navigateTo })
      : REGISTRY["live"](ctx),

  "live-analyze": ({ navigateTo }) =>
    h(LiveAnalyzeView, { navigateTo }),

  "overview": ({ data, jobs }) =>
    h(Overview, { data, jobs }),

  "graph": ({ data, setDetail, selectedFile, selectedZone, navigateTo }) =>
    h(Graph, { data, onSelect: setDetail, selectedFile, selectedZone, navigateTo }),

  "iso-map": ({ data }) =>
    h(IsoMapView, { analysisStamp: isoMapAnalysisStamp(data) }),

  "zones": ({ data, setDetail, navigateTo }) =>
    h(ZonesView, { data, onSelect: setDetail, navigateTo }),

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

  "pr-markdown": () =>
    h(PRMarkdownView, null),

  "ask": ({ askSeed, jobs }) =>
    h(AskView, { seed: askSeed, jobs }),

  "rex-dashboard": ({ navigateTo }) =>
    h(RexDashboard, { navigateTo }),

  "prd": ({ setDetail, setPrdDetailContent, selectedTaskId, navigateTo }) =>
    h(PRDView, { onSelectItem: setDetail, onDetailContent: setPrdDetailContent, initialTaskId: selectedTaskId, navigateTo }),

  "product": () =>
    h(ProductPage, null),

  "changes": ({ navigateTo }) =>
    h(ChangesPage, { navigateTo }),

  "analysis": () =>
    h(AnalysisView, null),

  "merge-graph": ({ navigateTo }) =>
    h(MergeGraphView, { navigateTo }),

  "token-usage": () =>
    h(TokenUsageView, null),

  "validation": ({ navigateTo }) =>
    h(ValidationView, { navigateTo }),

  "requirements": () =>
    h(RequirementsView, null),

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

  "commands": ({ jobs }) =>
    h(CommandsView, { jobs }),

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
