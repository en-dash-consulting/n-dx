/**
 * The operator's connections (connections/), for Settings > Project:
 *
 *   GET    /api/connections                      each connection and its state, and the config file's name
 *   POST   /api/connections                      { id, label?, transport, auth?, url | command, args?, env?, profile?, token? } -> { connection }
 *   POST   /api/connections/test                 the same body, unsaved -> { state, reason?, tools }: connect, tools/list, close
 *   GET    /api/connections/tracker              -> { label } the tracker's name from its profile, or null
 *   GET    /api/connections/profiles             -> { profiles } the built-in server profiles
 *   GET    /api/connections/sync                 -> the tracker sync rules and the connections it may use
 *   PUT    /api/connections/sync                 { rules: { <event>: off | dry-run | on }, connection? } -> the same
 *   DELETE /api/connections/:id[?credential=delete]  remove it; with the query, also connection:<id> from the store
 *   POST   /api/connections/:id/test             reconnect and list tools -> { connection, tools }
 *   GET    /api/connections/:id/tools            -> { connection, tools } each with class, policy and where each came from
 *   PUT    /api/connections/:id/tools/:tool      { class?, policy? } (null clears) -> { tool }
 *   PUT    /api/connections/:id/profile          { profile: name | null } -> { connection }
 *   PUT    /api/connections/:id/token            { token } -> { connection }
 *   POST   /api/connections/:id/oauth/start      { redirectUrl, basePath? } -> { authorizationUrl }
 *   POST   /api/connections/:id/oauth/finish     { code, state, iss? } -> { connection }
 *   POST   /api/connections/:id/sign-out         -> { connection }
 *
 * Every route needs the per-user token or a browser session (the request gate
 * in request-security.ts); none is public. The OAuth redirect lands on the
 * fixed loopback callback, `/oauth/callback`, which serves the dashboard's
 * page shell (relayed by the hub from its origin root); the page posts the
 * code, state and iss here with its session in the header, so the server
 * never acts on a credential in a URL.
 * Governed by `web.sidecar` (route-feature-gates.ts).
 *
 * Writes go to the untracked `.n-dx.local.json` only (local-config-write.ts)
 * and reload the shared service, so the broker sees them without a restart. A
 * token is accepted by the add and token routes, stored as `connection:<id>`
 * and never returned, logged or written to a file; a response carries no
 * token, refresh token or code: a connection is its id, label, transport,
 * auth, state, reason, tool count, whether a token is stored and whether the
 * server profile it names fits the server.
 *
 * See docs/architecture/sidecar-connections.md.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { basename } from "node:path";
import { redactSecrets, resolveLayout, type CredentialStoreOptions } from "@n-dx/llm-client";
import {
  addConnection,
  connectionFromForm,
  ConnectionWriteError,
  removeConnection,
  setConnectionProfile,
  setToolOverride,
} from "./connections/connection-writes.js";
import { bindConnectionCredential, connectionToken, setConnectionToken, unsetConnectionCredential, withoutSecrets } from "./connections/connection-credentials.js";
import {
  ConnectionService,
  workspaceConnectionService,
  type ConnectionInfo,
  type ConnectionTool,
} from "./connections/connection-service.js";
import { ConnectionSignInError, type SignInRoute } from "./connections/oauth-provider.js";
import { OAUTH_CALLBACK_PATH, detectViewerBasePath, projectIdFromBasePath, workspaceKeyFromBasePath } from "../shared/index.js";
import type { ToolClass, ToolRunPolicy, ToolSource } from "./connections/tool-policy.js";
import { LocalConfigError } from "./local-config-write.js";
import { errorMessage, errorResponse, jsonResponse, readJsonObject } from "./response-utils.js";
import { builtInProfileNames, loadServerProfile, resolveServerProfile } from "./tracker/server-profiles.js";
import { readSyncSettings, SyncSettingsError, writeSyncRules } from "./tracker/sync-settings.js";
import { connectionsTrackerLabel } from "./tracker/tracker-label.js";
import type { ServerContext } from "./types.js";

export const CONNECTIONS_PREFIX = "/api/connections";

/** `GET` -> `{ label }`: the tracker's name from its profile, for the links an item shows. */
const TRACKER_PATH = `${CONNECTIONS_PREFIX}/tracker`;
const PROFILES_PATH = `${CONNECTIONS_PREFIX}/profiles`;
const SYNC_PATH = `${CONNECTIONS_PREFIX}/sync`;
const TEST_PATH = `${CONNECTIONS_PREFIX}/test`;

const ID_PATH = /^\/api\/connections\/([^/]+)(?:\/(oauth\/start|oauth\/finish|sign-out|test|profile|token|tools))?$/;
const TOOL_PATH = /^\/api\/connections\/([^/]+)\/tools\/([^/]+)$/;

/** Hostnames a sign-in may return to: the two loopback callbacks n-dx's client metadata document lists. */
const CALLBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

/** The longest token accepted: far above any real one, far below a request body. */
const MAX_TOKEN_LENGTH = 8192;

const MAX_TOOL_DESCRIPTION = 300;

export interface ConnectionsRouteOptions {
  /** The service for a workspace. Defaults to {@link workspaceConnectionService}. */
  connectionsFor?: (projectDir: string) => ConnectionService;
  /** The credential store tokens are written to and read from; defaults to the per-user store. */
  credentials?: CredentialStoreOptions;
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
  /** On a token connection: whether `connection:<id>` holds one. The token itself is never sent. */
  tokenStored?: boolean;
  /** The server profile it names, if any. An invalid one is not used; the connection still works attended. */
  profile?: ConnectionProfileView;
}

/** One discovered tool as a route answers it. */
export interface ToolView {
  tool: string;
  description: string;
  class: ToolClass;
  classSource: ToolSource;
  policy: ToolRunPolicy;
  policySource: ToolSource;
}

function profileView(name: string, tools: readonly ConnectionTool[]): ConnectionProfileView {
  if (tools.length === 0) return { name, state: "unchecked" };
  const resolution = resolveServerProfile(name, tools);
  return resolution.state === "ok" ? { name, state: "ok" } : { name, state: "invalid", problem: resolution.problem };
}

function toolView({ tool, description, policy }: ConnectionTool): ToolView {
  return {
    tool,
    description: description.length > MAX_TOOL_DESCRIPTION ? `${description.slice(0, MAX_TOOL_DESCRIPTION)}…` : description,
    class: policy.class,
    classSource: policy.classSource,
    policy: policy.policy,
    policySource: policy.policySource,
  };
}

/** `info` as a view. Reads the tools the service already holds; connects nothing `info` did not. */
async function view(info: ConnectionInfo, service: ConnectionService, credentials?: CredentialStoreOptions): Promise<ConnectionView> {
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
    ...(info.auth === "token" && { tokenStored: connectionToken(info.id, credentials) !== undefined }),
    ...(profile && { profile: profileView(profile, tools) }),
  };
}

function refuse(res: ServerResponse, status: number, message: string): true {
  errorResponse(res, status, message);
  return true;
}

/** A write's failure as the response it deserves. `secrets` are scrubbed from an unexpected one. */
function refuseWrite(res: ServerResponse, err: unknown, secrets: readonly string[] = []): true {
  if (err instanceof ConnectionWriteError) return refuse(res, err.status, err.message);
  if (err instanceof LocalConfigError) return refuse(res, 409, err.message);
  if (err instanceof SyncSettingsError) return refuse(res, 400, err.message);
  return refuse(res, 500, `Could not save: ${redactSecrets(withoutSecrets(secrets, errorMessage(err)))}`);
}

/** `value` as a token, undefined when absent, or why it is not one. Never echoed. */
function tokenFrom(value: unknown): string | undefined | { problem: string } {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) return { problem: `"token" must be a non-empty string` };
  if (/[\r\n]/.test(value) || value.length > MAX_TOKEN_LENGTH) {
    return { problem: `"token" must be a single line of at most ${MAX_TOKEN_LENGTH} characters` };
  }
  return value;
}

/** A body that may carry a token. A parse failure is reported without the text the parser choked on. */
async function readSecretBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | undefined> {
  const body = await readJsonObject(req, res);
  if (typeof body === "string") {
    refuse(res, 400, "Request body must be a JSON object");
    return undefined;
  }
  return body;
}

/** `value` percent-decoded, or undefined when it is not valid. */
function decoded(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/**
 * The sign-in's redirect URL, or why it is refused: the fixed loopback
 * callback, `http://127.0.0.1:<port>/oauth/callback` or the same on
 * `localhost`, as n-dx's client ID metadata document lists it (any port).
 */
export function signInRedirectUrl(value: unknown): URL | string {
  const problem = `"redirectUrl" must be http://127.0.0.1:<port>${OAUTH_CALLBACK_PATH} or the same on localhost`;
  if (typeof value !== "string" || !value) return problem;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return problem;
  }
  if (url.protocol !== "http:" || !CALLBACK_HOSTNAMES.has(url.hostname) || url.pathname !== OAUTH_CALLBACK_PATH) return problem;
  if (url.username || url.password || url.search || url.hash) return `"redirectUrl" must carry no credentials, query or fragment`;
  return url;
}

/** Where the viewer that starts a sign-in is mounted, as the state's routing fields; a string when it is not a base path. */
export function signInRoute(value: unknown): SignInRoute | string {
  if (value === undefined || value === "") return {};
  if (typeof value !== "string" || detectViewerBasePath(value) !== value) return `"basePath" must be the dashboard's base path`;
  const project = projectIdFromBasePath(value);
  const workspace = workspaceKeyFromBasePath(value);
  return { ...(project && { project }), ...(workspace && { workspace }) };
}

export async function handleConnectionsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  opts: ConnectionsRouteOptions = {},
): Promise<boolean> {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname;
  if (pathname !== CONNECTIONS_PREFIX && !pathname.startsWith(`${CONNECTIONS_PREFIX}/`)) return false;
  const method = req.method || "GET";
  const service = (opts.connectionsFor ?? workspaceConnectionService)(ctx.projectDir);
  const credentials = opts.credentials;
  const viewOf = (id: string) => view(service.connection(id)!, service, credentials);

  if (pathname === CONNECTIONS_PREFIX) {
    if (method === "POST") return addConnectionRoute(req, res, ctx, service, credentials);
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${CONNECTIONS_PREFIX}`);
    jsonResponse(res, 200, {
      connections: await Promise.all((await service.listConnections()).map((info) => view(info, service, credentials))),
      // The file connections are declared in, for the page to name.
      configFile: basename(resolveLayout(ctx.projectDir).localConfigFile),
    });
    return true;
  }

  if (pathname === TRACKER_PATH) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    jsonResponse(res, 200, { label: connectionsTrackerLabel(service) });
    return true;
  }

  if (pathname === PROFILES_PATH) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    jsonResponse(res, 200, { profiles: builtInProfileNames() });
    return true;
  }

  if (pathname === SYNC_PATH) {
    if (method === "GET") {
      jsonResponse(res, 200, { ...readSyncSettings(ctx.projectDir), connections: service.connectionIds() });
      return true;
    }
    if (method !== "PUT") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    const body = await readJsonObject(req, res);
    if (typeof body === "string") return refuse(res, 400, body);
    const { rules, connection } = body;
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) return refuse(res, 400, `"rules" must be an object keyed by ndx event`);
    if (connection !== undefined && (typeof connection !== "string" || !service.connection(connection))) {
      return refuse(res, 400, `"connection" must name a declared connection`);
    }
    try {
      const settings = writeSyncRules(ctx.projectDir, rules as Record<string, unknown>, connection as string | undefined);
      jsonResponse(res, 200, { ...settings, connections: service.connectionIds() });
    } catch (err) {
      return refuseWrite(res, err);
    }
    return true;
  }

  if (pathname === TEST_PATH) {
    if (method !== "POST") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    return testSpecRoute(req, res, ctx, credentials);
  }

  const toolMatch = TOOL_PATH.exec(pathname);
  if (toolMatch) {
    if (method !== "PUT") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    const [, id, rawTool] = toolMatch;
    const tool = decoded(rawTool);
    if (!service.connection(id)) return refuse(res, 404, `No connection named ${id}`);
    if (tool === undefined) return refuse(res, 400, "The tool name is not valid");
    const body = await readJsonObject(req, res);
    if (typeof body === "string") return refuse(res, 400, body);
    if (!(await service.listTools([id])).some((listed) => listed.tool === tool)) {
      return refuse(res, 404, `${id} does not list a tool named ${tool}`);
    }
    try {
      setToolOverride(ctx.projectDir, id, tool, { class: body.class, policy: body.policy });
    } catch (err) {
      return refuseWrite(res, err);
    }
    service.reload();
    const changed = (await service.listTools([id])).find((listed) => listed.tool === tool);
    if (!changed) return refuse(res, 502, `${id} no longer lists ${tool}`);
    jsonResponse(res, 200, { tool: toolView(changed) });
    return true;
  }

  const match = ID_PATH.exec(pathname);
  if (!match) return refuse(res, 404, `No such connections route: ${pathname}`);
  const [, id, action] = match;
  const known = service.connection(id);

  if (action === undefined) {
    if (method !== "DELETE") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    if (!known) return refuse(res, 404, `No connection named ${id}`);
    try {
      removeConnection(ctx.projectDir, id);
    } catch (err) {
      return refuseWrite(res, err);
    }
    service.reload();
    // The token is the operator's to keep or to delete: removing the server does not decide.
    const credentialDeleted = url.searchParams.get("credential") === "delete" && unsetConnectionCredential(id, credentials);
    jsonResponse(res, 200, { removed: id, credentialDeleted });
    return true;
  }

  if (!known) return refuse(res, 404, `No connection named ${id}`);

  if (action === "test" || action === "tools") {
    if (method !== (action === "test" ? "POST" : "GET")) return refuse(res, 405, `${method} is not supported on ${pathname}`);
    // A test connects afresh: the operator asked whether it works now.
    if (action === "test") service.reconnect(id);
    const tools = await service.listTools([id]);
    jsonResponse(res, 200, { connection: await viewOf(id), tools: tools.map(toolView) });
    return true;
  }

  if (action === "profile") {
    if (method !== "PUT") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    const body = await readJsonObject(req, res);
    if (typeof body === "string") return refuse(res, 400, body);
    const { profile } = body;
    if (profile !== null && (typeof profile !== "string" || !profile.trim())) return refuse(res, 400, `"profile" must be a profile name or null`);
    const name = profile === null ? null : (profile as string).trim();
    if (name !== null) {
      const loaded = loadServerProfile(name);
      if ("problems" in loaded) return refuse(res, 400, `Profile ${name}: ${loaded.problems.join("; ")}`);
    }
    try {
      setConnectionProfile(ctx.projectDir, id, name);
    } catch (err) {
      return refuseWrite(res, err);
    }
    service.reload();
    // Connect, so the answer carries the profile's check against the server's tools.
    await service.listTools([id]);
    jsonResponse(res, 200, { connection: await viewOf(id) });
    return true;
  }

  if (action === "token") {
    if (method !== "PUT") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    if (known.transport !== "http" || known.auth !== "token") return refuse(res, 400, `Connection ${id} does not use a token`);
    const body = await readSecretBody(req, res);
    if (!body) return true;
    const token = tokenFrom(body.token);
    if (typeof token !== "string") return refuse(res, 400, token?.problem ?? `"token" is required`);
    try {
      setConnectionToken(id, token, credentials);
      bindConnectionCredential(id, service.connectionUrl(id)!, credentials);
    } catch (err) {
      return refuseWrite(res, err, [token]);
    }
    service.reconnect(id);
    await service.listTools([id]);
    jsonResponse(res, 200, { connection: await viewOf(id) });
    return true;
  }

  if (method !== "POST") return refuse(res, 405, `${method} is not supported on ${pathname}`);
  if (known.transport !== "http" || known.auth !== "oauth") return refuse(res, 400, `Connection ${id} does not use OAuth`);

  const body = await readJsonObject(req, res);
  if (typeof body === "string") return refuse(res, 400, body);

  if (action === "oauth/start") {
    const redirect = signInRedirectUrl(body.redirectUrl);
    if (typeof redirect === "string") return refuse(res, 400, redirect);
    const route = signInRoute(body.basePath);
    if (typeof route === "string") return refuse(res, 400, route);
    try {
      jsonResponse(res, 200, { authorizationUrl: await service.beginSignIn(id, redirect.href, route) });
    } catch (err) {
      return refuse(res, 502, `Could not start the sign-in: ${redactSecrets(errorMessage(err))}`);
    }
    return true;
  }

  if (action === "oauth/finish") {
    const { code, state, iss } = body;
    if (typeof code !== "string" || !code || typeof state !== "string" || !state) {
      return refuse(res, 400, `"code" and "state" must be non-empty strings`);
    }
    if (iss !== undefined && typeof iss !== "string") return refuse(res, 400, `"iss" must be a string`);
    try {
      await service.finishSignIn(id, code, state, iss);
    } catch (err) {
      // The sign-in error is already scrubbed of the code and stored secrets.
      if (err instanceof ConnectionSignInError) return refuse(res, 400, err.message);
      return refuse(res, 502, `Could not finish the sign-in: ${redactSecrets(errorMessage(err).split(code).join("[code]"))}`);
    }
    // The record the sign-in stored is for this server.
    bindConnectionCredential(id, service.connectionUrl(id)!, credentials);
    service.reconnect(id);
    await service.listTools([id]);
    jsonResponse(res, 200, { connection: await viewOf(id) });
    return true;
  }

  await service.signOut(id);
  jsonResponse(res, 200, { connection: await viewOf(id) });
  return true;
}

/** `POST /api/connections`: declare a connection, and store its token when the form carried one. */
async function addConnectionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  service: ConnectionService,
  credentials: CredentialStoreOptions | undefined,
): Promise<true> {
  const body = await readSecretBody(req, res);
  if (!body) return true;
  const { token: rawToken, ...form } = body;
  const config = connectionFromForm(form);
  if (typeof config === "string") return refuse(res, 400, config);
  const token = tokenFrom(rawToken);
  if (typeof token === "object") return refuse(res, 400, token.problem);
  if (token !== undefined && config.auth !== "token") return refuse(res, 400, `"token" applies only to auth "token"`);
  try {
    addConnection(ctx.projectDir, config);
  } catch (err) {
    return refuseWrite(res, err);
  }
  if (token !== undefined) {
    try {
      setConnectionToken(config.id, token, credentials);
      if (config.transport === "http") bindConnectionCredential(config.id, config.url, credentials);
    } catch (err) {
      // No half-added connection.
      removeConnection(ctx.projectDir, config.id);
      return refuseWrite(res, err, [token]);
    }
  }
  service.reload();
  await service.listTools([config.id]);
  jsonResponse(res, 201, { connection: await view(service.connection(config.id)!, service, credentials) });
  return true;
}

/** `POST /api/connections/test`: connect the connection the form describes, unsaved, list its tools and close. */
async function testSpecRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  credentials: CredentialStoreOptions | undefined,
): Promise<true> {
  const body = await readSecretBody(req, res);
  if (!body) return true;
  const form = { ...body };
  delete form.token;
  const config = connectionFromForm({ id: "probe", ...form });
  if (typeof config === "string") return refuse(res, 400, config);
  // The probe would read connection:<form id>, so an existing id with another
  // URL would carry a stored credential to a server nobody saved. Credentialed
  // servers are tested once added (POST /api/connections/:id/test).
  if (config.auth !== "none") return refuse(res, 400, "Only a server with auth \"none\" can be tested before it is added; add it, then test it");
  const probe = new ConnectionService({ projectDir: ctx.projectDir, connections: [config], credentials, warn: () => undefined });
  try {
    const tools = await probe.listTools();
    const [info] = await probe.listConnections();
    jsonResponse(res, 200, {
      state: info.status.state,
      ...("reason" in info.status && { reason: info.status.reason }),
      tools: tools.map(toolView),
    });
  } finally {
    await probe.close();
  }
  return true;
}
