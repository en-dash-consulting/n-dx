/**
 * Tracker sync on the project server (tracker/sync-engine.ts):
 *
 *   POST /api/tracker/sync/tick   collect the ndx events since the last tick (tracker/event-sources.ts),
 *                                 run the queue through the rules -> the tick's result and { collected }
 *   GET  /api/tracker/activity    -> { entries, sources } the activity log, newest last, and each
 *                                 event source the last tick could not read ({ event, problem, at })
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
import { readSidecarSettings } from "./sidecar/settings.js";
import { readTrackerActivity } from "./tracker/activity-log.js";
import { collectTrackerEvents, type TrackerEventExec } from "./tracker/event-sources.js";
import { readSourceProblems, type SourceProblem } from "./tracker/source-problems.js";
import { TRACKER_EVENTS } from "./tracker/server-profiles.js";
import { loadTrackerSync } from "./tracker/sync-config.js";
import { enqueueTrackerEvent, runTrackerSyncTick, type TrackerSyncService } from "./tracker/sync-engine.js";
import type { ServerContext } from "./types.js";

export const TRACKER_PREFIX = "/api/tracker";
const TICK_PATH = `${TRACKER_PREFIX}/sync/tick`;
const ACTIVITY_PATH = `${TRACKER_PREFIX}/activity`;

/** The most entries the activity route answers, newest kept. */
export const MAX_ACTIVITY_ENTRIES = 200;

export interface TrackerRouteOptions {
  /** The connection service for a workspace. Defaults to the workspace's shared one. */
  connectionsFor?: (projectDir: string) => TrackerSyncService;
  /** Runs gh and git for the event sources. Defaults to the llm-client `exec`. */
  exec?: TrackerEventExec;
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
    const collected = await collectSince(ctx, opts);
    const service = (opts.connectionsFor ?? workspaceConnectionService)(ctx.projectDir);
    jsonResponse(res, 200, { ...(await runTrackerSyncTick({ projectDir: ctx.projectDir, service })), collected });
    return true;
  }

  if (pathname === ACTIVITY_PATH) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    jsonResponse(res, 200, {
      entries: readTrackerActivity(ctx.projectDir).slice(-MAX_ACTIVITY_ENTRIES),
      sources: currentSourceProblems(ctx.projectDir),
    });
    return true;
  }

  return refuse(res, 404, `No such tracker route: ${pathname}`);
}

/**
 * Queue the ndx events since the last tick, for the rules that are not off.
 * Nothing is read while the settings are absent or unusable, so no cursor
 * moves and no gh command runs; the tick then reports why.
 */
async function collectSince(ctx: ServerContext, opts: TrackerRouteOptions): Promise<{ queued: number; problems: string[] }> {
  const config = loadTrackerSync(ctx.projectDir);
  if (!config || "problems" in config) return { queued: 0, problems: [] };
  const events = TRACKER_EVENTS.filter((event) => config.rules[event] !== "off");
  const { records, problems } = await collectTrackerEvents({
    projectDir: ctx.projectDir,
    rexDir: ctx.rexDir,
    events,
    githubReads: readSidecarSettings(ctx.projectDir).githubReads,
    ...(opts.exec && { exec: opts.exec }),
  });
  for (const record of records) enqueueTrackerEvent(ctx.projectDir, record);
  return { queued: records.length, problems };
}

/**
 * The recorded source problems whose rule is still on. With every rule off
 * the hub stops ticking, so nothing rewrites the record; a problem for a rule
 * that no longer reads is not a problem.
 */
function currentSourceProblems(projectDir: string): SourceProblem[] {
  const config = loadTrackerSync(projectDir);
  if (!config || "problems" in config) return [];
  return readSourceProblems(projectDir).filter((p) => (config.rules[p.event] ?? "off") !== "off");
}

function refuse(res: ServerResponse, status: number, message: string): true {
  errorResponse(res, status, message);
  return true;
}
