/**
 * Tracker sync on the project server (tracker/sync-engine.ts):
 *
 *   POST /api/tracker/sync/tick   collect the ndx events since the last tick (tracker/event-sources.ts),
 *                                 run the queue through the rules -> the tick's result and { collected }
 *   GET  /api/tracker/activity    -> { entries, cards, sources } the activity log, newest last, the request
 *                                 ids of its cards still waiting for a decision, and each
 *                                 event source the last tick could not read ({ event, problem, at }),
 *                                 and the sync connection's state (`connection`, null when unset)
 *   GET  /api/tracker/cards/form?requestId=   -> { externalCall } the form a waiting card's call is drawn from
 *   POST /api/tracker/cards/decide { requestId, action: "dismiss" | "approve", args? }
 *                                 -> { entry } approve makes the call once with the operator's args
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
import { workspaceConnectionService, type ConnectionService } from "./connections/connection-service.js";
import { isPerUserTokenRequest } from "./request-security.js";
import { errorResponse, jsonResponse, readJsonObject } from "./response-utils.js";
import { buildExternalCall } from "./sidecar/external-call.js";
import { readSidecarSettings } from "./sidecar/settings.js";
import { pendingCards, readTrackerActivity } from "./tracker/activity-log.js";
import { collectTrackerEvents, type TrackerEventExec } from "./tracker/event-sources.js";
import { readSourceProblems, type SourceProblem } from "./tracker/source-problems.js";
import { TRACKER_EVENTS } from "./tracker/server-profiles.js";
import { loadTrackerSync } from "./tracker/sync-config.js";
import { decideTrackerCard, enqueueTrackerEvent, runTrackerSyncTick, type CardDecision, type TrackerSyncService } from "./tracker/sync-engine.js";
import type { ServerContext } from "./types.js";

export const TRACKER_PREFIX = "/api/tracker";
const TICK_PATH = `${TRACKER_PREFIX}/sync/tick`;
const ACTIVITY_PATH = `${TRACKER_PREFIX}/activity`;
const FORM_PATH = `${TRACKER_PREFIX}/cards/form`;
const DECIDE_PATH = `${TRACKER_PREFIX}/cards/decide`;

/** The most entries the activity route answers, newest kept. */
export const MAX_ACTIVITY_ENTRIES = 200;

/** What the routes use of a connection service: sync's calls, the sync connection's state, and the card form's reads. */
export type TrackerRouteService = TrackerSyncService & Pick<ConnectionService, "connection">;

/** The sync connection as Live shows it. */
export interface TrackerConnectionView {
  id: string;
  label: string;
  state: "connected" | "unavailable" | "needs-sign-in";
  reason?: string;
  signIn?: "first" | "again";
}

export interface TrackerRouteOptions {
  /** The connection service for a workspace. Defaults to the workspace's shared one. */
  connectionsFor?: (projectDir: string) => TrackerRouteService;
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
    const config = loadTrackerSync(ctx.projectDir);
    const service = (opts.connectionsFor ?? workspaceConnectionService)(ctx.projectDir);
    const log = readTrackerActivity(ctx.projectDir);
    jsonResponse(res, 200, {
      entries: log.slice(-MAX_ACTIVITY_ENTRIES),
      cards: pendingCards(log).map((e) => e.requestId),
      sources: currentSourceProblems(ctx.projectDir),
      connection: config && !("problems" in config) ? connectionView(service, config.connection) : null,
    });
    return true;
  }

  if (pathname === FORM_PATH) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    const requestId = new URL(req.url || "/", "http://localhost").searchParams.get("requestId") ?? "";
    const card = pendingCards(readTrackerActivity(ctx.projectDir)).find((e) => e.requestId === requestId);
    if (!card) return refuse(res, 409, `${requestId} is not a card waiting for a decision`);
    const service = (opts.connectionsFor ?? workspaceConnectionService)(ctx.projectDir);
    const config = loadTrackerSync(ctx.projectDir);
    if (!config || "problems" in config) return refuse(res, 422, "tracker sync is not configured");
    const tools = await service.listTools([config.connection]);
    const tool = tools.find((t) => t.tool === card.call.tool);
    if (!tool) return refuse(res, 422, `${card.call.tool} is not offered by ${config.connection}`);
    jsonResponse(res, 200, { externalCall: await buildExternalCall(tool, tools, service) });
    return true;
  }

  if (pathname === DECIDE_PATH) {
    if (method !== "POST") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    const body = await readJsonObject(req, res);
    if (typeof body === "string") return refuse(res, 400, body);
    const { requestId, action, args } = body;
    if (typeof requestId !== "string" || requestId === "") return refuse(res, 400, "requestId is required");
    let decision: CardDecision;
    if (action === "dismiss") decision = { action };
    else if (action === "approve" && args && typeof args === "object" && !Array.isArray(args)) decision = { action, args: args as Record<string, unknown> };
    else return refuse(res, 400, 'action is "dismiss", or "approve" with args');
    const service = (opts.connectionsFor ?? workspaceConnectionService)(ctx.projectDir);
    const decided = await decideTrackerCard({ projectDir: ctx.projectDir, service }, requestId, decision);
    if (!decided.ok) return refuse(res, decided.status, decided.error);
    jsonResponse(res, 200, { entry: decided.entry });
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

/** The sync connection as Live shows it: its label and state, and whether a sign-in was lost. */
function connectionView(service: TrackerRouteService, id: string): TrackerConnectionView | null {
  const info = service.connection(id);
  if (!info) return null;
  const { status } = info;
  return {
    id,
    label: info.label,
    state: status.state,
    ...(status.state !== "connected" && { reason: status.reason }),
    ...(status.state === "needs-sign-in" && { signIn: status.signIn }),
  };
}

function refuse(res: ServerResponse, status: number, message: string): true {
  errorResponse(res, status, message);
  return true;
}
