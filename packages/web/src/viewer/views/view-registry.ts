/**
 * View registry — maps ViewId to render functions.
 *
 * Centralizes all view component imports and the view-to-component
 * dispatch logic. main.ts imports only `renderActiveView` and
 * `buildValidViews` from here instead of 22 individual view modules.
 */

import { h } from "preact";
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
} from "./domain-rex.js";

import {
  HenchRunsView,
  HenchConfigView,
  HenchTemplatesView,
  AdaptiveOptimizationView,
} from "./domain-hench.js";

import { WorkspacesView } from "./domain-workspaces.js";
import { LiveView, LiveTaskView, LiveAnalyzeView } from "./domain-live.js";
import { isoMapAnalysisStamp } from "./iso-map-url.js";
import { HomeView, StagePage } from "./stage-pages.js";
import type { StageId } from "./stages.js";
import { buildValidViews as buildValidViewsForScope } from "../external.js";

import {
  NotionConfigView,
  IntegrationConfigView,
  FeatureTogglesView,
  CliTimeoutsView,
  CommandsView,
  CommandReferenceView,
  LlmProviderView,
  ProjectSettingsView,
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

/** A stage page, rendering each of its sections through this registry. */
function stage(id: StageId): ViewRenderer {
  return (ctx) => h(StagePage, {
    stage: id,
    validViews: validViewsOf(ctx),
    navigateTo: ctx.navigateTo,
    renderView: (view: ViewId) => renderActiveView(view, ctx),
  });
}

const REGISTRY: Record<string, ViewRenderer> = {
  "home": (ctx) =>
    h(HomeView, { validViews: validViewsOf(ctx), navigateTo: ctx.navigateTo }),

  "analyze": stage("analyze"),
  "plan": stage("plan"),
  "work": stage("work"),

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

  "notion-config": () =>
    h(NotionConfigView, null),

  "integrations": () =>
    h(IntegrationConfigView, null),

  "hench-runs": ({ navigateTo, selectedRunId }) =>
    h(HenchRunsView, { navigateTo, initialRunId: selectedRunId }),

  "hench-audit": ({ navigateTo }) =>
    h(TaskAuditView, { navigateTo }),

  "hench-config": () =>
    h(HenchConfigView, null),

  "hench-templates": () =>
    h(HenchTemplatesView, null),

  "hench-optimization": () =>
    h(WorkflowOptimizationView, null),

  "hench-adaptive": () =>
    h(AdaptiveOptimizationView, null),

  "feature-toggles": () =>
    h(FeatureTogglesView, null),

  "cli-timeouts": () =>
    h(CliTimeoutsView, null),

  "commands": ({ jobs }) =>
    h(CommandsView, { jobs }),

  "command-reference": () =>
    h(CommandReferenceView, null),

  "llm-provider": () =>
    h(LlmProviderView, null),

  "project-settings": () =>
    h(ProjectSettingsView, null),
};

/** Render the view identified by `view` using props from `ctx`. */
export function renderActiveView(view: ViewId, ctx: ViewRenderContext): ComponentChild {
  const renderer = REGISTRY[view];
  return renderer ? renderer(ctx) : null;
}

export { buildValidViews } from "../external.js";
