import type { ViewId } from "./view-id.js";

/** Valid scope identifiers for standalone package viewers. */
export type ViewerScope = "sourcevision" | "rex" | "hench";

export type SourcevisionScopeViewId = Extract<
  ViewId,
  "analyze" | "overview" | "graph" | "iso-map" | "zones" | "files" | "routes" | "architecture" | "problems" | "suggestions" | "pr-markdown" | "ask"
>;

// Each stage page belongs to the scope whose views it composes, so a scoped
// standalone viewer gets its own stage and not the other two.
export const SOURCEVISION_SCOPE_VIEWS: readonly SourcevisionScopeViewId[] = [
  "analyze",
  "overview",
  "graph",
  "iso-map",
  "zones",
  "files",
  "routes",
  "architecture",
  "problems",
  "suggestions",
  "pr-markdown",
  "ask",
];

export const REX_SCOPE_VIEWS: readonly ViewId[] = [
  "plan",
  "rex-dashboard",
  "prd",
  "analysis",
  "merge-graph",
  "validation",
  "requirements",
  "activity",
  "notion-config",
  "integrations",
];

export const HENCH_SCOPE_VIEWS: readonly ViewId[] = [
  "work",
  "hench-runs",
  "hench-audit",
  "hench-optimization",
  "hench-adaptive",
];

export const CROSS_CUTTING_VIEWS: readonly ViewId[] = [
  "home",
  "workspaces",
  "token-usage",
  "feature-toggles",
  "workflow",
  "command-reference",
  "commands",
  "robot-wrangler",
  "project-settings",
];

export const VIEWS_BY_SCOPE: Readonly<Record<ViewerScope, readonly ViewId[]>> = {
  sourcevision: SOURCEVISION_SCOPE_VIEWS,
  rex: REX_SCOPE_VIEWS,
  hench: HENCH_SCOPE_VIEWS,
};

const ALL_VIEWS = new Set<ViewId>([
  ...SOURCEVISION_SCOPE_VIEWS,
  ...REX_SCOPE_VIEWS,
  ...HENCH_SCOPE_VIEWS,
  ...CROSS_CUTTING_VIEWS,
]);

/** Build the valid view set based on an optional scope. */
export function buildValidViews(scope: string | null): Set<ViewId> {
  if (!scope || scope === "all") return new Set(ALL_VIEWS);
  const scopedViews = VIEWS_BY_SCOPE[scope as ViewerScope];
  return scopedViews ? new Set<ViewId>([...scopedViews, ...CROSS_CUTTING_VIEWS]) : new Set(ALL_VIEWS);
}

/** True when the pathname segment maps to a known SPA view. */
export function isKnownViewPath(segment: string): boolean {
  return ALL_VIEWS.has(segment as ViewId);
}

/**
 * Old view paths renamed or merged in 0.8.0, mapped to the view that
 * absorbed them. `overview` and `rex-dashboard` remain registered `ViewId`s
 * (a scoped standalone viewer still renders them as their own page — see
 * `resolveViewAlias`), so this table is what turns a stale top-level path
 * into a redirect instead of the orphaned bare view it used to be.
 */
const VIEW_ALIASES: Readonly<Record<string, ViewId>> = {
  overview: "analyze",
  "rex-dashboard": "work",
  // 0.8.0 renamed the LLM Provider page to Robot Wrangler.
  "llm-provider": "robot-wrangler",
  // 0.8.0 merged work settings, CLI timeouts and templates into Workflow (#457).
  "hench-config": "workflow",
  "cli-timeouts": "workflow",
  "hench-templates": "workflow",
};

/**
 * Resolve an old view path segment to the stage it now redirects to, or
 * `null` when no alias applies.
 *
 * The alias only fires when its target is itself a valid view for this
 * viewer — the one exception this covers today is a rex-scoped viewer,
 * which has no `work` stage, so `rex-dashboard` keeps being its own page
 * there rather than redirecting nowhere.
 */
export function resolveViewAlias(segment: string, validViews: ReadonlySet<ViewId>): ViewId | null {
  const target = VIEW_ALIASES[segment];
  return target && validViews.has(target) ? target : null;
}
