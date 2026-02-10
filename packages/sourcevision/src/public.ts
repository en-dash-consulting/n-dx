/**
 * Public API for the sourcevision package.
 *
 * This barrel re-exports the subset of sourcevision internals consumed by
 * downstream packages (web server, cli.js, etc.). All other modules are
 * implementation details and should not be imported directly.
 *
 * ## Architectural isolation
 *
 * Sourcevision depends only on `@n-dx/claude-client` (the shared
 * foundation) and has **no dependency on rex or hench**. This makes it
 * a fully independent analysis engine that can be built, tested, and
 * published on its own:
 *
 * ```
 *   hench → rex → claude-client ← sourcevision
 * ```
 *
 * The web package consumes both rex and sourcevision, but those two
 * packages never import from each other — they share data only through
 * the web layer's coordination, preserving zero coupling between
 * domain packages.
 *
 * @module sourcevision/public
 */

// ---- MCP server factory -----------------------------------------------------

export { createSourcevisionMcpServer } from "./cli/mcp.js";
