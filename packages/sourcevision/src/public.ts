/**
 * Public API for the sourcevision package.
 *
 * This barrel re-exports the subset of sourcevision internals consumed by
 * downstream packages (web server, cli.js, etc.). All other modules are
 * implementation details and should not be imported directly.
 *
 * @module sourcevision/public
 */

// ---- MCP server factory -----------------------------------------------------

export { createSourcevisionMcpServer } from "./cli/mcp.js";
