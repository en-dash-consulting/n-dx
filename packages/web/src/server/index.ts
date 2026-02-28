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
 * **subprocess calls**.  Rex domain types and constants are imported from
 * the canonical source through the gateway (`domain-gateway.ts`), eliminating
 * the previous duplication in `rex-domain.ts`.
 *
 * MCP server factories and rex domain constants are funnelled through
 * `domain-gateway.ts` — a single gateway module that mirrors the pattern
 * in `packages/hench/src/prd/rex-gateway.ts`.
 *
 * @see ./domain-gateway.ts — runtime import gateway (all cross-package imports)
 */

export { startServer, PORT_FILE } from "./start.js";
export type { ServerOptions, StartResult } from "./start.js";
export type { ServerContext, RouteHandler } from "./types.js";
export type { WebSocketBroadcaster } from "./websocket.js";
export { checkPort, checkPortWithRetry, findAvailablePort } from "./port.js";
export type { PortCheckResult, PortAllocationResult, PortRetryOptions } from "./port.js";
