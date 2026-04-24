/**
 * Rex domain views — barrel module.
 *
 * Groups all Rex/PRD-specific view components behind a single import
 * boundary. This establishes a natural decomposition point within the
 * web-viewer zone, enabling future extraction or lazy-loading of the
 * entire Rex view surface without touching individual files.
 *
 * Domain scope: PRD tree, dashboard, token usage, validation,
 * task audit, and workflow optimization.
 */

export { PRDView } from "./prd.js";
export { RexDashboard } from "./rex-dashboard.js";
export { TokenUsageView } from "./token-usage.js";
export { ValidationView } from "./validation.js";
export { TaskAuditView } from "./task-audit.js";
export { WorkflowOptimizationView } from "./workflow-optimization.js";
export { MergeGraphView } from "./merge-graph.js";
