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
