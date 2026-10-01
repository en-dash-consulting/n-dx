/**
 * View identifier type — framework-agnostic.
 *
 * Extracted to the shared layer so that modules with zero framework
 * dependencies (e.g. crash-detector) can reference it without importing
 * from the viewer layer.
 */

export type ViewId =
  // Shell pages: the landing page and the three stage pages that compose
  // the product views below into the analyze → plan → work loop.
  | "home"
  | "analyze"
  | "plan"
  | "work"
  | "overview"
  | "graph"
  | "zones"
  | "analysis"
  | "files"
  | "routes"
  | "architecture"
  | "iso-map"
  | "problems"
  | "suggestions"
  | "pr-markdown"
  | "ask"
  | "rex-dashboard"
  | "prd"
  | "token-usage"
  | "validation"
  | "requirements"
  | "activity"
  | "hench-runs"
  | "hench-audit"
  | "hench-optimization"
  | "hench-adaptive"
  | "workflow"
  | "commands"
  | "command-reference"
  | "robot-wrangler"
  | "project"
  | "merge-graph"
  | "workspaces";
