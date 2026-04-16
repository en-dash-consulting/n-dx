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
}

/** A route handler receives the request, response, and server context. */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
) => boolean | Promise<boolean>;
