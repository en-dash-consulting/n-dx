/**
 * Hench domain views — barrel module.
 *
 * Groups all Hench/agent-specific view components behind a single import
 * boundary. This establishes a natural decomposition point within the
 * web-viewer zone, enabling future extraction or lazy-loading of the
 * entire Hench view surface without touching individual files.
 *
 * Domain scope: run history, agent configuration, and task templates.
 */

export { HenchRunsView } from "./hench-runs.js";
export { HenchConfigView } from "./hench-config.js";
export { HenchTemplatesView } from "./hench-templates.js";
export { AdaptiveOptimizationView } from "./adaptive-optimization.js";

// TODO(ask-panel): a Hench-scoped Ask panel gets exported here once the
// SourceVision one (PRD feature d339458a) is generalised. Its domain context is
// run history rather than analysis data ("why did this run fail", "what did
// this run spend"), so it needs its own context assembly, not just a new tab.
// Not in the PRD yet by choice; see sourcevision-tabs.ts for the origin marker.
