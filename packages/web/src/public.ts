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
 * | Rex domain types  | Gateway re-export  | mcp-deps.ts (gateway) |
 * | MCP servers       | Gateway re-export  | mcp-deps.ts (gateway) |
 *
 * Runtime imports — MCP server factories and rex domain types/constants —
 * are funnelled through a single gateway module (`server/mcp-deps.ts`)
 * to keep the coupling surface explicit and auditable.
 *
 * @module @n-dx/web
 * @see packages/web/src/server/mcp-deps.ts — runtime import gateway
 * @see packages/hench/src/prd/ops.ts — hench's equivalent gateway pattern
 */

export { startServer, PORT_FILE } from "./server/start.js";
export type { ServerOptions, StartResult } from "./server/start.js";
export type { ServerContext, RouteHandler, ViewerScope } from "./server/types.js";
export type { WebSocketBroadcaster } from "./server/websocket.js";
export { checkPort, findAvailablePort } from "./server/port.js";
export type { PortCheckResult, PortAllocationResult } from "./server/port.js";
