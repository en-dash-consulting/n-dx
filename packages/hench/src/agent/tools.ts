/**
 * Backward-compatibility re-exports.
 *
 * Tool definitions and dispatch have moved to `../tools/dispatch.js`.
 * This shim keeps existing imports working until all consumers migrate.
 */
export { TOOL_DEFINITIONS, TOOL_DEFINITIONS_NEUTRAL, dispatchTool } from "../tools/dispatch.js";
export type { ToolContext } from "../tools/contracts.js";
