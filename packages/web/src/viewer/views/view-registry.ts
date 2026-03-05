/**
 * View registry — maps ViewId to render functions.
 *
 * Centralizes all view component imports and the view-to-component
 * dispatch logic. main.ts imports only `renderActiveView` and
 * `buildValidViews` from here instead of 22 individual view modules.
 */

import { h } from "preact";
import type { ComponentChild, VNode } from "preact";
import type { ViewId, NavigateTo, DetailItem, LoadedData } from "../types.js";
import type { DegradableFeature } from "../performance/index.js";
import { SOURCEVISION_TAB_IDS } from "./sourcevision-tabs.js";

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
  ZonesView,
  FilesView,
  ArchitectureView,
  ProblemsView,
  SuggestionsView,
  PRMarkdownView,
  RoutesView,
  AnalysisView,
} from "./domain-sourcevision.js";

import {
  PRDView,
  RexDashboard,
  TokenUsageView,
  ValidationView,
  TaskAuditView,
  WorkflowOptimizationView,
} from "./domain-rex.js";

import {
  HenchRunsView,
  HenchConfigView,
  HenchTemplatesView,
} from "./domain-hench.js";

import {
  NotionConfigView,
  IntegrationConfigView,
  FeatureTogglesView,
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
  navigateTo: NavigateTo;
  isFeatureDisabled: (feature: DegradableFeature) => boolean;
}

// ── Registry ───────────────────────────────────────────────────

type ViewRenderer = (ctx: ViewRenderContext) => ComponentChild;

const REGISTRY: Record<string, ViewRenderer> = {
  "overview": ({ data }) =>
    h(Overview, { data }),

  "graph": ({ data, setDetail, selectedFile, selectedZone, navigateTo, isFeatureDisabled }) => {
    if (isFeatureDisabled("graphRendering")) {
      return h("div", { class: "degraded-view-placeholder", role: "status" },
        h("h2", null, "Graph view unavailable"),
        h("p", null, "The graph view has been temporarily disabled to conserve memory. It will be re-enabled automatically when memory usage decreases, or you can refresh the page."),
      );
    }
    return h(Graph, { data, onSelect: setDetail, selectedFile, selectedZone, navigateTo });
  },

  "zones": ({ data, setDetail, navigateTo }) =>
    h(ZonesView, { data, onSelect: setDetail, navigateTo }),

  "files": ({ data, setDetail, selectedFile, setSelectedFile, selectedZone, navigateTo }) =>
    h(FilesView, { data, onSelect: setDetail, selectedFile, setSelectedFile, selectedZone, navigateTo }),

  "routes": ({ data }) =>
    h(RoutesView, { data }),

  "architecture": ({ data, setDetail, navigateTo }) =>
    h(ArchitectureView, { data, onSelect: setDetail, navigateTo }),

  "problems": ({ data }) =>
    h(ProblemsView, { data }),

  "suggestions": ({ data }) =>
    h(SuggestionsView, { data }),

  "pr-markdown": () =>
    h(PRMarkdownView, null),

  "rex-dashboard": ({ navigateTo }) =>
    h(RexDashboard, { navigateTo }),

  "prd": ({ setDetail, setPrdDetailContent, selectedTaskId, navigateTo }) =>
    h(PRDView, { onSelectItem: setDetail, onDetailContent: setPrdDetailContent, initialTaskId: selectedTaskId, navigateTo }),

  "rex-analysis": () =>
    h(AnalysisView, null),

  "token-usage": () =>
    h(TokenUsageView, null),

  "validation": ({ navigateTo }) =>
    h(ValidationView, { navigateTo }),

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

  "feature-toggles": () =>
    h(FeatureTogglesView, null),
};

/** Render the view identified by `view` using props from `ctx`. */
export function renderActiveView(view: ViewId, ctx: ViewRenderContext): ComponentChild {
  const renderer = REGISTRY[view];
  return renderer ? renderer(ctx) : null;
}

// ── Scope & valid-view helpers ─────────────────────────────────

/** All known views grouped by product scope. */
const VIEWS_BY_SCOPE: Record<string, ViewId[]> = {
  sourcevision: SOURCEVISION_TAB_IDS,
  rex: ["rex-dashboard", "prd", "rex-analysis", "validation", "notion-config", "integrations"],
  hench: ["hench-runs", "hench-audit", "hench-config", "hench-templates", "hench-optimization"],
};

/** Cross-cutting views available in all scopes. */
const CROSS_CUTTING_VIEWS: ViewId[] = ["token-usage", "feature-toggles"];

const ALL_VIEWS = new Set<ViewId>([...Object.values(VIEWS_BY_SCOPE).flat(), ...CROSS_CUTTING_VIEWS] as ViewId[]);

/** Build the valid view set based on an optional scope. */
export function buildValidViews(scope: string | null): Set<ViewId> {
  if (!scope) return ALL_VIEWS;
  return new Set<ViewId>([...(VIEWS_BY_SCOPE[scope] ?? []), ...CROSS_CUTTING_VIEWS] as ViewId[]);
}
