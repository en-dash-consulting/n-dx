/**
 * Sidecar session routes: create a session, post a turn, read its frames.
 *
 * A turn is a POST that answers `202` as soon as the prompt is in the
 * transcript; the vendor CLI runs on in the background. Every frame the turn
 * appends is announced over the WebSocket as `sidecar:frames` with the
 * session's new cursor, and the client fetches `GET …/frames?after=<cursor>`
 * for the frames themselves — the announce-then-fetch pattern the run tail
 * uses (`hench:run-appended` + `/events?after=`). The socket carries no
 * transcript text, and a reloaded client resumes by fetching after the last
 * cursor it rendered.
 *
 * Routes, all under `/api/sidecar/sessions`, all refused while `web.sidecar`
 * is off (see route-feature-gates.ts):
 *
 * | Method | Path | Does |
 * |--------|------|------|
 * | GET  | `/api/sidecar/sessions` | sessions in this worktree |
 * | POST | `/api/sidecar/sessions` | create one (`{ vendor, model?, name?, lens? }`) |
 * | GET  | `/api/sidecar/sessions/:id` | one session and whether a turn runs |
 * | POST | `/api/sidecar/sessions/:id/turns` | start a turn (`{ prompt }`) |
 * | GET  | `/api/sidecar/sessions/:id/frames?after=N` | transcript frames after N |
 * | POST | `/api/sidecar/sessions/:id/interrupt` | stop the running turn |
 * | POST | `/api/sidecar/sessions/:id/end` | end the session |
 *
 * Sessions are the addressed workspace's: `ctx.projectDir` picks the registry
 * (`<henchDir>/sidecar/`) and is the worktree a new session runs in.
 *
 * @module web/server/routes-sidecar
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { vendorSessionDriver } from "@n-dx/llm-client";
import type { SessionTurnStatus } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import type { WebSocketBroadcaster } from "./websocket.js";
import { errorMessage, errorResponse, jsonResponse, readBody } from "./response-utils.js";
import {
  createWorktreeSidecarRegistry,
  type SidecarFrame,
  type SidecarSessionRecord,
  type SidecarSessionRegistry,
} from "./sidecar/session-registry.js";

const PREFIX = "/api/sidecar/sessions";

/** Announces that a session's transcript grew, or that its turn settled. */
export interface SidecarFramesMessage {
  type: "sidecar:frames";
  sessionId: string;
  /** Sequence number of the last frame; fetch `frames?after=` the cursor you hold. */
  cursor: number;
  /** False on the announcement that closes a turn. */
  running: boolean;
  /** How the turn ended; only on the closing announcement. */
  status?: SessionTurnStatus;
  /** Why the turn failed; only on a failed closing announcement. */
  error?: string;
  timestamp: string;
}

export interface SidecarSessionResponse {
  session: SidecarSessionRecord;
  running: boolean;
}

export interface SidecarTurnStartedResponse extends SidecarSessionResponse {
  /** Fetch `frames?after=` this to read the turn from its prompt on. */
  from: number;
}

export interface SidecarFramesResponse {
  frames: SidecarFrame[];
  /** The cursor to fetch after next: the last frame's seq, else `after`. */
  cursor: number;
  running: boolean;
}

export interface SidecarRouteOptions {
  /** The registry for a project directory. Defaults to one per directory, kept for the server's life. */
  registryFor?: (projectDir: string) => SidecarSessionRegistry;
}

const registries = new Map<string, SidecarSessionRegistry>();

function defaultRegistryFor(projectDir: string): SidecarSessionRegistry {
  let registry = registries.get(projectDir);
  if (!registry) {
    registry = createWorktreeSidecarRegistry(projectDir);
    registries.set(projectDir, registry);
  }
  return registry;
}

/** Answer an error; true, so a handler can `return refuse(…)`. */
function refuse(res: ServerResponse, status: number, message: string): true {
  errorResponse(res, status, message);
  return true;
}

/** The body as a JSON object (empty body: `{}`), else the reason it is not one. */
async function readJsonObject(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | string> {
  let parsed: unknown;
  try {
    const body = await readBody(req, res);
    parsed = body.trim() ? JSON.parse(body) : {};
  } catch (err) {
    return `Invalid request body: ${errorMessage(err)}`;
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : "Request body must be a JSON object";
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined | Error {
  const value = body[key];
  if (value === undefined) return undefined;
  return typeof value === "string" && value.trim() ? value.trim() : new Error(`"${key}" must be a non-empty string`);
}

function sessionResponse(registry: SidecarSessionRegistry, session: SidecarSessionRecord): SidecarSessionResponse {
  return { session, running: registry.isRunning(session.id) };
}

/**
 * Start the turn in the background and announce every frame it appends.
 * The caller has checked that the session exists, is open and is idle.
 */
function startTurn(
  registry: SidecarSessionRegistry,
  id: string,
  prompt: string,
  broadcast: WebSocketBroadcaster,
): void {
  const announce = (fields: Omit<SidecarFramesMessage, "type" | "sessionId" | "timestamp">): void => {
    const message: SidecarFramesMessage = {
      type: "sidecar:frames",
      sessionId: id,
      ...fields,
      timestamp: new Date().toISOString(),
    };
    broadcast(message);
  };
  // The user frame is appended synchronously inside sendTurn, before it
  // first awaits, so it is on disk by the time the POST answers.
  registry.sendTurn(id, prompt, (frame) => announce({ cursor: frame.seq, running: true })).then(
    (result) => {
      announce({
        cursor: registry.get(id)?.cursor ?? 0,
        running: false,
        status: result.status,
        ...(result.error && { error: result.error }),
      });
    },
    (err: unknown) => {
      const error = errorMessage(err);
      console.error(`[sidecar] turn in session ${id} failed: ${error}`);
      announce({ cursor: registry.get(id)?.cursor ?? 0, running: false, status: "failed", error });
    },
  );
}

/** Parse `after` from the query: a non-negative integer, default 0. */
function parseAfter(search: string): number | Error {
  const raw = new URLSearchParams(search).get("after");
  if (raw === null || raw === "") return 0;
  const after = Number(raw);
  return Number.isInteger(after) && after >= 0 ? after : new Error(`"after" must be a non-negative integer, got "${raw}"`);
}

export async function handleSidecarRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast: WebSocketBroadcaster,
  opts: SidecarRouteOptions = {},
): Promise<boolean> {
  const [pathname, search = ""] = (req.url || "/").split("?");
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;
  const method = req.method || "GET";
  const registry = (opts.registryFor ?? defaultRegistryFor)(ctx.projectDir);

  if (pathname === PREFIX) {
    if (method === "GET") {
      const sessions = registry.list({ worktree: ctx.projectDir })
        .map((session) => sessionResponse(registry, session));
      jsonResponse(res, 200, { sessions });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      const vendor = optionalString(body, "vendor");
      if (!vendor || vendor instanceof Error || !vendorSessionDriver(vendor)) {
        return refuse(res, 400, `"vendor" must be a vendor with a resumable CLI session (claude, codex)`);
      }
      const fields: Record<string, string | undefined> = {};
      for (const key of ["model", "name", "lens"] as const) {
        const value = optionalString(body, key);
        if (value instanceof Error) return refuse(res, 400, value.message);
        fields[key] = value;
      }
      const session = registry.create({ scope: "worktree", worktree: ctx.projectDir, vendor, ...fields });
      jsonResponse(res, 201, sessionResponse(registry, session));
      return true;
    }
    return refuse(res, 405, `${method} is not supported on ${PREFIX}`);
  }

  const match = /^\/([\w-]+)(?:\/(turns|frames|interrupt|end))?$/.exec(pathname.slice(PREFIX.length));
  if (!match) return false;
  const [, id, action] = match;
  const session = registry.get(id);
  // One answer for a session this worktree does not hold, whether it does not
  // exist or belongs to another worktree's checkout.
  if (!session || session.worktree !== ctx.projectDir) return refuse(res, 404, `No Sidecar session ${id}`);

  const allowed = action === "frames" || action === undefined ? "GET" : "POST";
  if (method !== allowed) return refuse(res, 405, `${method} is not supported on ${pathname}`);

  switch (action) {
    case undefined:
      jsonResponse(res, 200, sessionResponse(registry, session));
      return true;

    case "frames": {
      const after = parseAfter(search);
      if (after instanceof Error) return refuse(res, 400, after.message);
      const frames = registry.readFrames(id, after);
      const response: SidecarFramesResponse = {
        frames,
        cursor: frames.at(-1)?.seq ?? after,
        running: registry.isRunning(id),
      };
      jsonResponse(res, 200, response);
      return true;
    }

    case "turns": {
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      const prompt = body.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) return refuse(res, 400, `"prompt" must be a non-empty string`);
      if (session.endedAt) return refuse(res, 409, `Sidecar session ${id} has ended`);
      if (registry.isRunning(id)) return refuse(res, 409, `A turn is already running in Sidecar session ${id}`);
      startTurn(registry, id, prompt, broadcast);
      const started = registry.get(id) ?? session;
      // The turn's frames start with its prompt, the last frame appended so far.
      const response: SidecarTurnStartedResponse = { ...sessionResponse(registry, started), from: started.cursor - 1 };
      jsonResponse(res, 202, response);
      return true;
    }

    case "interrupt":
      jsonResponse(res, 200, { interrupted: await registry.interrupt(id) });
      return true;

    case "end":
      await registry.end(id);
      jsonResponse(res, 200, sessionResponse(registry, registry.get(id) ?? session));
      return true;
  }
  return false;
}
