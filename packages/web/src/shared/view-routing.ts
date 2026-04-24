import type { ViewId } from "./view-id.js";

/** Valid scope identifiers for standalone package viewers. */
export type ViewerScope = "sourcevision" | "rex" | "hench";

export type SourcevisionScopeViewId = Extract<
  ViewId,
  "overview" | "graph" | "files" | "routes" | "architecture" | "problems" | "suggestions" | "pr-markdown"
>;

export const SOURCEVISION_SCOPE_VIEWS: readonly SourcevisionScopeViewId[] = [
  "overview",
  "graph",
  "files",
  "routes",
  "architecture",
  "problems",
  "suggestions",
  "pr-markdown",
];

export const REX_SCOPE_VIEWS: readonly ViewId[] = [
  "rex-dashboard",
  "prd",
  "merge-graph",
  "validation",
  "notion-config",
  "integrations",
];

export const HENCH_SCOPE_VIEWS: readonly ViewId[] = [
  "hench-runs",
  "hench-audit",
  "hench-config",
  "hench-templates",
  "hench-optimization",
];

export const CROSS_CUTTING_VIEWS: readonly ViewId[] = [
  "token-usage",
  "feature-toggles",
  "cli-timeouts",
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
