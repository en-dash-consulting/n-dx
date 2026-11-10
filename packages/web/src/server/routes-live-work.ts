/**
 * `GET /api/live-work` — the work a restart of this server would cut off.
 *
 * `ndx start` replaces a hub that is older than itself, and stopping the hub
 * stops every project server it supervises. Before it does, it asks each
 * server, through the hub, what is live on it, and defers the replacement
 * while anything is:
 *
 * - `mcpSessions`: MCP sessions open on `/mcp/rex` and `/mcp/sourcevision`
 *   and used within their idle TTL;
 * - `sidecarTurns`: Sidecar turns in progress — `worktree` for this
 *   project's own sessions, `hub` for the hub-scope session when this server
 *   hosts it.
 *
 * Agent runs are not here: `ndx start` reads hench's locks on disk and the
 * existing `/api/hench/execute/status`.
 *
 * @module web/server/routes-live-work
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { mcpSessionCounts } from "./routes-mcp.js";
import { sidecarTurnsInFlight } from "./sidecar/session-registry.js";

const LIVE_WORK_PATH = "/api/live-work";

/** What `GET /api/live-work` answers. */
export interface LiveWorkReport {
  mcpSessions: { rex: number; sourcevision: number };
  sidecarTurns: { worktree: number; hub: number };
}

/** The live work in this process. */
export function liveWorkReport(): LiveWorkReport {
  return { mcpSessions: mcpSessionCounts(), sidecarTurns: sidecarTurnsInFlight() };
}

/** Handle `GET /api/live-work`; false for any other request. */
export function handleLiveWorkRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const path = (req.url ?? "/").split("?")[0];
  if (path !== LIVE_WORK_PATH || (req.method || "GET") !== "GET") return false;
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(liveWorkReport()));
  return true;
}
