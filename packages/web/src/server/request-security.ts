import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_REQUEST_BODY_BYTES } from "./response-utils.js";
import {
  isLoopbackHostOnPort,
  isLoopbackOriginOnPort,
  isAuthenticated,
  applySecurityHeaders,
  requestAccess,
  authRouteOf,
  answerAuthRoute,
  authRequiredPage,
  wantsHtml,
  stripWorkspaceSlot,
  AUTH_HINT,
} from "../shared/index.js";
import type { CredentialStore, RequestAccess } from "../shared/index.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Only the dashboard itself may make browser CORS requests. Comparing against
 * the socket's local port, rather than the attacker-controlled Host header,
 * also prevents a DNS-rebinding origin from presenting a matching Host value.
 * {@link isTrustedHost} is checked first on every request, independently.
 *
 * Exported so the WebSocket upgrade path can apply the same check — browsers do
 * not send a CORS preflight for a WebSocket handshake, so without this any page
 * open in the user's browser could open `ws://localhost:<port>` and read every
 * broadcast.
 */
export function isTrustedBrowserOrigin(origin: string, req: IncomingMessage): boolean {
  return isLoopbackOriginOnPort(origin, req.socket.localPort);
}

/**
 * Whether the request's `Host` names loopback on the socket it arrived on.
 *
 * Behind the hub this always holds: the proxy rewrites `Host` to
 * `127.0.0.1:<child port>` (`hub/proxy.ts`), and the hub has already judged
 * the browser's original `Host` itself. So this check only ever refuses a
 * request made directly to a project server by a name that is not loopback.
 *
 * Exported for the WebSocket upgrade path, which has no `handleRequestSecurity`.
 */
export function isTrustedHost(req: IncomingMessage): boolean {
  return isLoopbackHostOnPort(singleHeader(req.headers.host), req.socket.localPort);
}

function rejectMisdirected(res: ServerResponse): true {
  // 421 Misdirected Request: the request was not meant for the server it
  // reached. No CORS headers are set.
  res.writeHead(421, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify({ error: "Request Host does not name this server" }));
  return true;
}

/** Per-request options for {@link handleRequestSecurity}. */
export interface RequestSecurityOptions {
  /**
   * The per-user token (bearer header or `X-Ndx-Token`). `null`/absent means
   * the server runs without one — a bare `web serve`, or a test harness.
   */
  token?: string | null;
  /**
   * The browser credentials this server has issued (`shared/auth.ts`). With a
   * token but no store, only the per-user token itself is accepted.
   */
  credentials?: CredentialStore | null;
}

/** Requests the gate let through without a credential: the public shell only. */
const publicOnly = new WeakSet<object>();

/**
 * Whether the gate let `req` through without a credential. Such a request is
 * a safe-method one, and the caller may answer it only with the public shell
 * (the viewer HTML, the landing page, static images) — or
 * {@link refusePublicOnly}. Everything else needs a credential.
 */
export function isPublicOnlyRequest(req: object): boolean {
  return publicOnly.has(req);
}

/** Whether the request presents the per-user token in a header. */
export function isAuthenticatedRequest(req: Pick<IncomingMessage, "headers">, token: string): boolean {
  return isAuthenticated(req.headers, token);
}

function rejectUnauthenticated(res: ServerResponse): true {
  res.writeHead(401, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Bearer realm="n-dx"',
  });
  res.end(JSON.stringify({ error: "Authentication required", hint: AUTH_HINT }));
  return true;
}

/**
 * Answer a request the gate passed as public-only and the caller has no
 * public answer for: a page saying how to sign in for a navigation, a JSON
 * 401 for anything else.
 */
export function refusePublicOnly(req: IncomingMessage, res: ServerResponse): true {
  if (wantsHtml(req.headers)) {
    res.writeHead(401, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Bearer realm="n-dx"',
    });
    res.end(authRequiredPage());
    return true;
  }
  return rejectUnauthenticated(res);
}

/** The path a credential route is matched on: no query, no `/w/<key>/` slot. */
function routePathOf(url: string): string {
  return stripWorkspaceSlot(url.split("?")[0]).url;
}

/**
 * Whether a WebSocket handshake carries a credential; the shared rule in
 * `shared/auth.ts`, re-exported for the upgrade path.
 */
export { authorizeUpgrade } from "../shared/index.js";

function setCorsHeaders(res: ServerResponse, origin: string): void {
  // Reflect only a validated origin. A wildcard would let any website read API
  // responses and would approve preflights for the mutating route surface.
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

function rejectCrossOrigin(res: ServerResponse): true {
  res.writeHead(403, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify({ error: "Cross-origin request rejected" }));
  return true;
}

/**
 * Apply browser-origin and CORS protection before route dispatch.
 *
 * Every request, safe methods included, must carry a `Host` naming loopback on
 * this socket's port, or it is answered 421. When the server runs with a
 * per-user token, the request must then present it or a session credential
 * in a header. Without one, a mutation is answered 401 and a safe-method
 * request is passed on marked public-only ({@link isPublicOnlyRequest}): the
 * caller serves the public shell, which signs itself in, or
 * {@link refusePublicOnly}. The credential routes (`/api/auth/*`, see
 * `shared/auth.ts`) are answered here, after the Origin rules.
 * Requests without browser origin metadata remain supported for CLI and MCP
 * clients. Origin-bearing mutations must come from this loopback server, while
 * Fetch Metadata rejects cross-site mutations if a browser omits Origin.
 * Every response, refusals included, carries the baseline security headers
 * (`nosniff`, `X-Frame-Options: DENY`, the page Content-Security-Policy).
 * Returns true when the request has been fully handled.
 */
export function handleRequestSecurity(
  req: IncomingMessage,
  res: ServerResponse,
  options: RequestSecurityOptions = {},
): boolean {
  // Before any verdict is written, so a refusal carries them as a page does.
  // Shared with the hub's gate (`shared/response-headers.ts`) so the two
  // servers cannot drift.
  applySecurityHeaders(res);
  if (!isTrustedHost(req)) return rejectMisdirected(res);

  const method = (req.method || "GET").toUpperCase();
  const route = authRouteOf(routePathOf(req.url ?? "/"));
  const access: RequestAccess = requestAccess(req.headers, options.token, options.credentials);
  if (access === "public" && route === null) {
    // No credential. A navigation still gets the public shell — it is what
    // signs itself in — so a safe method is passed on, marked; anything else
    // is refused here.
    if (method !== "GET" && method !== "HEAD") return rejectUnauthenticated(res);
    publicOnly.add(req);
  }

  // Refuse an over-large body before any route buffers it. A declared
  // Content-Length past the cap is rejected here with 413; a chunked body with
  // no length is bounded later by readBody's streamed cap. The server is
  // loopback-only, so this guards its own availability, not data.
  const contentLength = Number(singleHeader(req.headers["content-length"]));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    res.writeHead(413, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: `Request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit.` }));
    req.destroy();
    return true;
  }

  const origin = singleHeader(req.headers.origin);

  if (origin) {
    if (!isTrustedBrowserOrigin(origin, req)) {
      if (method === "OPTIONS" || !SAFE_METHODS.has(method)) {
        return rejectCrossOrigin(res);
      }
    } else {
      setCorsHeaders(res, origin);
    }
  } else if (
    singleHeader(req.headers["sec-fetch-site"])?.toLowerCase() === "cross-site"
    && (method === "OPTIONS" || !SAFE_METHODS.has(method))
  ) {
    return rejectCrossOrigin(res);
  }

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (route !== null) {
    const answer = answerAuthRoute(route, method, req.headers, options.token, options.credentials, access);
    const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (answer.status === 401) headers["WWW-Authenticate"] = 'Bearer realm="n-dx"';
    res.writeHead(answer.status, headers);
    res.end(JSON.stringify(answer.body));
    return true;
  }

  return false;
}

/**
 * Whether a browser is making this request on behalf of another site.
 *
 * {@link handleRequestSecurity} lets every safe-method request through, which is
 * right for reads whose answer a foreign page cannot see. It is wrong for a GET
 * that makes this server do work — spawn a process, scan the PRD — because a
 * page's `<img src>` triggers it without needing to read anything. Such routes
 * call this and answer 403.
 *
 * Refuses a foreign `Origin`, and any `Sec-Fetch-Site` other than `same-origin`
 * or `none` (a typed URL). A same-site page on another loopback port is refused
 * too. Requests with neither header (CLI, MCP, curl) pass.
 */
export function isForeignSiteRequest(req: IncomingMessage): boolean {
  const origin = singleHeader(req.headers.origin);
  if (origin && !isTrustedBrowserOrigin(origin, req)) return true;
  const site = singleHeader(req.headers["sec-fetch-site"])?.toLowerCase();
  return site !== undefined && site !== "same-origin" && site !== "none";
}

/** Answer 403 to a request {@link isForeignSiteRequest} refused. */
export function refuseForeignSite(res: ServerResponse): true {
  return rejectCrossOrigin(res);
}
