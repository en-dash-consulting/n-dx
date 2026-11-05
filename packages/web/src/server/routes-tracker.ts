/**
 * Tracker sync on the project server (tracker/sync-engine.ts):
 *
 *   POST /api/tracker/sync/tick   run the queued ndx events through the rules -> the tick's result
 *   GET  /api/tracker/activity    -> { entries } the activity log, newest last
 *
 * The tick is the hub's clock: it is answered only on the per-user token
 * itself. A browser session is refused here, and a Sidecar broker credential
 * never gets past the request gate on this path, so no session's agent can
 * make tracker calls by ticking. The activity log is a read for the
 * dashboard. Governed by `web.sidecar` (route-feature-gates.ts).
 *
 * See docs/architecture/sidecar-connections.md.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { workspaceConnectionService } from "./connections/connection-service.js";
import { isPerUserTokenRequest } from "./request-security.js";
import { errorResponse, jsonResponse } from "./response-utils.js";
import { readTrackerActivity } from "./tracker/activity-log.js";
import { runTrackerSyncTick, type TrackerSyncService } from "./tracker/sync-engine.js";
import type { ServerContext } from "./types.js";

export const TRACKER_PREFIX = "/api/tracker";
const TICK_PATH = `${TRACKER_PREFIX}/sync/tick`;
const ACTIVITY_PATH = `${TRACKER_PREFIX}/activity`;

/** The most entries the activity route answers, newest kept. */
export const MAX_ACTIVITY_ENTRIES = 200;

export interface TrackerRouteOptions {
  /** The connection service for a workspace. Defaults to the workspace's shared one. */
  connectionsFor?: (projectDir: string) => TrackerSyncService;
}

export async function handleTrackerRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  opts: TrackerRouteOptions = {},
): Promise<boolean> {
  const pathname = (req.url || "/").split("?")[0];
  if (pathname !== TRACKER_PREFIX && !pathname.startsWith(`${TRACKER_PREFIX}/`)) return false;
  const method = req.method || "GET";

  if (pathname === TICK_PATH) {
    if (method !== "POST") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    if (!isPerUserTokenRequest(req)) return refuse(res, 403, "Tracker sync ticks only on the per-user token");
    const service = (opts.connectionsFor ?? workspaceConnectionService)(ctx.projectDir);
    jsonResponse(res, 200, await runTrackerSyncTick({ projectDir: ctx.projectDir, service }));
    return true;
  }

  if (pathname === ACTIVITY_PATH) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    jsonResponse(res, 200, { entries: readTrackerActivity(ctx.projectDir).slice(-MAX_ACTIVITY_ENTRIES) });
    return true;
  }

  return refuse(res, 404, `No such tracker route: ${pathname}`);
}

function refuse(res: ServerResponse, status: number, message: string): true {
  errorResponse(res, status, message);
  return true;
}
