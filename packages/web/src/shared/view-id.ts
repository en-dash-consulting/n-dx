/**
 * View identifier type — framework-agnostic.
 *
 * Extracted to the shared layer so that modules with zero framework
 * dependencies (e.g. crash-detector) can reference it without importing
 * from the viewer layer.
 */

export type ViewId =
  | "overview"
  | "graph"
  | "zones"
  | "files"
  | "routes"
  | "architecture"
  | "problems"
  | "suggestions"
  | "pr-markdown"
  | "rex-dashboard"
  | "prd"
  | "token-usage"
  | "validation"
  | "notion-config"
  | "integrations"
  | "hench-runs"
  | "hench-audit"
  | "hench-config"
  | "hench-templates"
  | "hench-optimization"
  | "feature-toggles"
  | "cli-timeouts";
