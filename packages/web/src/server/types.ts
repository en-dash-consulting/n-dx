/**
 * Shared types for the web server.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViewerScope } from "../shared/view-routing.js";
export type { ViewerScope } from "../shared/view-routing.js";

/** Server configuration passed to route handlers. */
export interface ServerContext {
  /** Absolute path to the project directory. */
  projectDir: string;
  /** Absolute path to .sourcevision/ directory. */
  svDir: string;
  /** Absolute path to .rex/ directory. */
  rexDir: string;
  /** Whether dev mode (live reload) is enabled. */
  dev: boolean;
  /** When set, restricts the dashboard to a single package's views and APIs. */
  scope?: ViewerScope;
  /**
   * Port this server is bound to. Set once at startup in {@link startServer}.
   * Optional because tests construct `ServerContext` directly without it —
   * consumers (e.g. `buildServerInfo` in routes-status.ts) fall back gracefully.
   */
  port?: number;
  /**
   * ISO timestamp this server started listening. Set once at startup in
   * {@link startServer}. Optional for the same reason as {@link port}.
   */
  startedAt?: string;
}

/** A route handler receives the request, response, and server context. */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
) => boolean | Promise<boolean>;
