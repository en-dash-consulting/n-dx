/**
 * Public API for the @n-dx/web package.
 *
 * Re-exports the server entry point for programmatic use.
 *
 * @module @n-dx/web
 */

export { startServer } from "./server/start.js";
export type { ServerOptions } from "./server/start.js";
export type { ServerContext, RouteHandler, ViewerScope } from "./server/types.js";
export type { WebSocketBroadcaster } from "./server/websocket.js";
