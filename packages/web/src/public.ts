/**
 * Public API for the @n-dx/web package.
 *
 * Re-exports the server entry point for programmatic use.
 *
 * ## Architectural role — coordination facade
 *
 * The web package is the **only** package that surfaces all three domain
 * packages (rex, sourcevision, hench) through a unified interface.  It
 * sits alongside the orchestration layer in the dependency hierarchy:
 *
 * ```
 *   Orchestration   cli.js, web.js          (spawn CLIs, no library imports)
 *        ↓
 *   Coordination    @n-dx/web               (reads domain data, hosts MCP)
 *        ↓
 *   Execution       hench                   (agent loops → imports rex)
 *        ↓
 *   Domain          rex · sourcevision      (independent, never import each other)
 *        ↓
 *   Foundation      @n-dx/llm-client     (shared types, API client)
 * ```
 *
 * ## Coupling strategy — filesystem-first, gateway-gated
 *
 * Unlike hench (which imports rex functions at runtime), the web package
 * minimises runtime imports from domain packages.  Instead it reads
 * their JSON artefacts directly from disk:
 *
 * | Data source       | Mechanism          | Module               |
 * |------------------|--------------------|----------------------|
 * | PRD tree          | `readFileSync`     | routes-rex.ts        |
 * | Analysis data     | `readFileSync`     | routes-sourcevision.ts |
 * | Agent run history | `readFileSync`     | routes-hench.ts      |
 * | Rex CLI commands  | `execFile`         | routes-rex.ts        |
 * | Rex domain types  | Gateway re-export  | rex-gateway.ts       |
 * | MCP servers       | Gateway re-export  | rex-gateway.ts / domain-gateway.ts |
 *
 * Runtime imports — MCP server factories and rex domain types/constants —
 * are funnelled through dedicated gateway modules (`server/rex-gateway.ts`
 * for Rex, `server/domain-gateway.ts` for Sourcevision) to keep the
 * coupling surface explicit and auditable.
 *
 * @module @n-dx/web
 * @see packages/web/src/server/rex-gateway.ts — Rex runtime import gateway
 * @see packages/web/src/server/domain-gateway.ts — Sourcevision runtime import gateway
 * @see packages/hench/src/prd/ops.ts — hench's equivalent gateway pattern
 */

export { startServer, PORT_FILE } from "./server/start.js";
export type { ServerOptions, StartResult } from "./server/start.js";
export type { ServerContext, RouteHandler } from "./server/types.js";
export type { WebSocketBroadcaster } from "./server/websocket.js";
export { checkPort, checkPortWithRetry, findAvailablePort } from "./server/port.js";
export type { PortCheckResult, PortAllocationResult, PortRetryOptions } from "./server/port.js";
export type { ViewerScope } from "./shared/index.js";

// Cross-zone shared types — stable contract for types used by multiple
// server zones (task-usage-analytics, web-dashboard, cleanup scheduling).
// This explicit re-export makes the contract visible in the public API
// rather than requiring consumers to reach into zone-internal files.
export type {
  TaskUsageAccumulator,
  CollectAllIdsFn,
  OrphanedEntry,
  CleanupResult,
  CleanupLogEntry,
  CleanupConfig,
} from "./server/shared-types.js";
