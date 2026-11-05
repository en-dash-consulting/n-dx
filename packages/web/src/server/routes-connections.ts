/**
 * The operator's connections (connections/), for Settings > Project:
 *
 *   GET  /api/connections                    each connection and its state, and the config file's name
 *   POST /api/connections/:id/oauth/start    { redirectUrl } -> { authorizationUrl }
 *   POST /api/connections/:id/oauth/finish   { code, state } -> { connection }
 *   POST /api/connections/:id/sign-out       -> { connection }
 *
 * Every route needs the per-user token or a browser session (the request gate
 * in request-security.ts); none is public. The OAuth redirect lands on the
 * dashboard's own page shell, which posts the code and state here with its
 * session in the header, so the server never acts on a credential in a URL.
 * Governed by `web.sidecar` (route-feature-gates.ts).
 *
 * A response carries no token, refresh token or code: a connection is its
 * id, label, transport, auth, state, reason, tool count and whether the
 * server profile it names fits the server.
 *
 * See docs/architecture/sidecar-connections.md.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { basename } from "node:path";
import { redactSecrets, resolveLayout } from "@n-dx/llm-client";
import { workspaceConnectionService, type ConnectionInfo, type ConnectionService, type ConnectionTool } from "./connections/connection-service.js";
import { ConnectionSignInError } from "./connections/oauth-provider.js";
import { errorMessage, errorResponse, jsonResponse, readJsonObject } from "./response-utils.js";
import { resolveServerProfile } from "./tracker/server-profiles.js";
import type { ServerContext } from "./types.js";

export const CONNECTIONS_PREFIX = "/api/connections";

const ACTION_PATH = /^\/api\/connections\/([^/]+)\/(oauth\/start|oauth\/finish|sign-out)$/;

/** Hostnames a sign-in may return to: the dashboard is served on loopback only. */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface ConnectionsRouteOptions {
  /** The service for a workspace. Defaults to {@link workspaceConnectionService}. */
  connectionsFor?: (projectDir: string) => ConnectionService;
}

/** Whether a connection's server profile fits its server; unchecked until its tools are listed. */
export type ConnectionProfileView =
  | { name: string; state: "ok" | "unchecked" }
  | { name: string; state: "invalid"; problem: string };

/** A connection as a route answers it. */
export interface ConnectionView {
  id: string;
  label: string;
  transport: ConnectionInfo["transport"];
  auth: ConnectionInfo["auth"];
  state: ConnectionInfo["status"]["state"];
  reason?: string;
  /** On a needs-sign-in row: a first sign-in, or one that was lost. The badge reads this, not the reason. */
  signIn?: "first" | "again";
  tools: number;
  /** The server profile it names, if any. An invalid one is not used; the connection still works attended. */
  profile?: ConnectionProfileView;
}

function profileView(name: string, tools: readonly ConnectionTool[]): ConnectionProfileView {
  if (tools.length === 0) return { name, state: "unchecked" };
  const resolution = resolveServerProfile(name, tools);
  return resolution.state === "ok" ? { name, state: "ok" } : { name, state: "invalid", problem: resolution.problem };
}

/** `info` as a view. Reads the tools the service already holds; connects nothing `info` did not. */
async function view(info: ConnectionInfo, service: ConnectionService): Promise<ConnectionView> {
  const profile = service.callContext(info.id)?.profile;
  const tools = profile && info.tools > 0 ? await service.listTools([info.id]) : [];
  return {
    id: info.id,
    label: info.label,
    transport: info.transport,
    auth: info.auth,
    state: info.status.state,
    ...("reason" in info.status && { reason: info.status.reason }),
    ...("signIn" in info.status && { signIn: info.status.signIn }),
    tools: info.tools,
    ...(profile && { profile: profileView(profile, tools) }),
  };
}

function refuse(res: ServerResponse, status: number, message: string): true {
  errorResponse(res, status, message);
  return true;
}

/** `value` as a redirect URL a sign-in may return to, or why it is not one. */
export function signInRedirectUrl(value: unknown): URL | string {
  if (typeof value !== "string" || !value) return `"redirectUrl" must be a URL`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `"redirectUrl" must be a URL`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `"redirectUrl" must be http or https`;
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) return `"redirectUrl" must be a loopback dashboard address`;
  if (url.username || url.password || url.hash) return `"redirectUrl" must carry no credentials or fragment`;
  return url;
}

export async function handleConnectionsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  opts: ConnectionsRouteOptions = {},
): Promise<boolean> {
  const pathname = (req.url || "/").split("?")[0];
  if (pathname !== CONNECTIONS_PREFIX && !pathname.startsWith(`${CONNECTIONS_PREFIX}/`)) return false;
  const method = req.method || "GET";
  const service = (opts.connectionsFor ?? workspaceConnectionService)(ctx.projectDir);

  if (pathname === CONNECTIONS_PREFIX) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${CONNECTIONS_PREFIX}`);
    jsonResponse(res, 200, {
      connections: await Promise.all((await service.listConnections()).map((info) => view(info, service))),
      // The file connections are declared in, for the page to name.
      configFile: basename(resolveLayout(ctx.projectDir).localConfigFile),
    });
    return true;
  }

  const match = ACTION_PATH.exec(pathname);
  if (!match) return refuse(res, 404, `No such connections route: ${pathname}`);
  const [, id, action] = match;
  if (method !== "POST") return refuse(res, 405, `${method} is not supported on ${pathname}`);
  const known = service.connection(id);
  if (!known) return refuse(res, 404, `No connection named ${id}`);
  if (known.transport !== "http" || known.auth !== "oauth") return refuse(res, 400, `Connection ${id} does not use OAuth`);

  const body = await readJsonObject(req, res);
  if (typeof body === "string") return refuse(res, 400, body);

  if (action === "oauth/start") {
    const redirect = signInRedirectUrl(body.redirectUrl);
    if (typeof redirect === "string") return refuse(res, 400, redirect);
    try {
      jsonResponse(res, 200, { authorizationUrl: await service.beginSignIn(id, redirect.href) });
    } catch (err) {
      return refuse(res, 502, `Could not start the sign-in: ${redactSecrets(errorMessage(err))}`);
    }
    return true;
  }

  if (action === "oauth/finish") {
    const { code, state } = body;
    if (typeof code !== "string" || !code || typeof state !== "string" || !state) {
      return refuse(res, 400, `"code" and "state" must be non-empty strings`);
    }
    try {
      await service.finishSignIn(id, code, state);
    } catch (err) {
      // The sign-in error is already scrubbed of the code and stored secrets.
      if (err instanceof ConnectionSignInError) return refuse(res, 400, err.message);
      return refuse(res, 502, `Could not finish the sign-in: ${redactSecrets(errorMessage(err).split(code).join("[code]"))}`);
    }
    jsonResponse(res, 200, { connection: await view(service.connection(id)!, service) });
    return true;
  }

  await service.signOut(id);
  jsonResponse(res, 200, { connection: await view(service.connection(id)!, service) });
  return true;
}
