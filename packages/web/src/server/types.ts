/**
 * Shared types for the web server.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

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
}

/** A route handler receives the request, response, and server context. */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
) => boolean | Promise<boolean>;

/** JSON API response helper. */
export function jsonResponse(
  res: ServerResponse,
  status: number,
  data: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(data));
}

/** Plain-text error response helper. */
export function errorResponse(
  res: ServerResponse,
  status: number,
  message: string,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

/** Read the full request body as a string. */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
