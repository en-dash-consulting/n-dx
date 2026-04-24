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
  FilesView,
  ArchitectureView,
  ProblemsView,
  SuggestionsView,
  PRMarkdownView,
  RoutesView,
} from "./domain-sourcevision.js";

import {
  PRDView,
  RexDashboard,
  TokenUsageView,
  ValidationView,
  TaskAuditView,
  WorkflowOptimizationView,
  MergeGraphView,
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
  CliTimeoutsView,
  CommandsView,
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
  navigateTo: NavigateTo;
  isFeatureDisabled: (feature: DegradableFeature) => boolean;
}

// ── Registry ───────────────────────────────────────────────────

type ViewRenderer = (ctx: ViewRenderContext) => ComponentChild;

const REGISTRY: Record<string, ViewRenderer> = {
  "overview": ({ data }) =>
    h(Overview, { data }),

  "graph": ({ data, setDetail, selectedFile, selectedZone, navigateTo }) =>
    h(Graph, { data, onSelect: setDetail, selectedFile, selectedZone, navigateTo }),

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

  "merge-graph": ({ navigateTo }) =>
    h(MergeGraphView, { navigateTo }),

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

  "cli-timeouts": () =>
    h(CliTimeoutsView, null),

  "commands": () =>
    h(CommandsView, null),

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
