/**
 * Web server for the n-dx dashboard.
 *
 * Serves the sourcevision viewer, provides REST API endpoints for
 * Rex (PRD data), sourcevision (analysis data), and Hench (agent runs),
 * and supports WebSocket connections for real-time updates.
 *
 * ## Route architecture
 *
 * ```
 *   Static assets   → routes-static.ts
 *   /data/*          → routes-data.ts         (sourcevision data files, live-reload)
 *   /api/rex/*       → routes-rex.ts          (PRD CRUD, stats, next task, log)
 *   /api/sv/*        → routes-sourcevision.ts (analysis data endpoints)
 *   /api/hench/*     → routes-hench.ts        (agent run history, run detail)
 *   /mcp/rex         → routes-mcp.ts          (Rex MCP over Streamable HTTP)
 *   /mcp/sourcevision→ routes-mcp.ts          (Sourcevision MCP over Streamable HTTP)
 *   WebSocket        → websocket.ts           (upgrade handler, broadcast)
 * ```
 *
 * ## Coupling strategy
 *
 * REST/API routes access domain data through **filesystem reads** and
 * **subprocess calls** — zero runtime imports from rex, sourcevision, or
 * hench.  Domain types are intentionally duplicated in `rex-domain.ts`
 * to avoid compile-time coupling.
 *
 * MCP routes are the sole exception: they need the actual MCP server
 * factory functions at runtime.  These two imports are isolated in
 * `mcp-deps.ts` — a single gateway module that mirrors the pattern
 * in `packages/hench/src/prd/ops.ts`.
 *
 * @see ./mcp-deps.ts — runtime import gateway (the only cross-package imports)
 * @see ./rex-domain.ts — duplicated domain types (avoids rex import)
 */

export { startServer } from "./start.js";
export type { ServerOptions } from "./start.js";
export type { ServerContext, RouteHandler } from "./types.js";
export type { WebSocketBroadcaster } from "./websocket.js";
