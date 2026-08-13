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
  | "analysis"
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
  | "requirements"
  | "notion-config"
  | "integrations"
  | "hench-runs"
  | "hench-audit"
  | "hench-config"
  | "hench-templates"
  | "hench-optimization"
  | "hench-adaptive"
  | "feature-toggles"
  | "cli-timeouts"
  | "commands"
  | "command-reference"
  | "llm-provider"
  | "project-settings"
  | "merge-graph";
