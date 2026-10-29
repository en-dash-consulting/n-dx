/**
 * The hub's browser-origin gate.
 *
 * The hub listens on a fixed, well-known port (3117), and
 * `POST /api/hub/projects` makes it *spawn a process* — the hub's own CLI
 * entry point, for the repository the body names. A `fetch` from any page the
 * user has open is a same-site-less cross-origin request, and a `text/plain`
 * POST is a CORS "simple request" — no preflight, so nothing asks the hub's
 * permission before the body arrives. Without this gate, visiting a web page
 * was enough to make the hub register and serve a chosen directory.
 *
 * The rule matches the project server's (`server/request-security.ts`), which
 * the hub cannot import from — its zone may not reach into `src/server/` — so
 * both delegate to `shared/origin.ts` and cannot drift:
 *
 * - An `Origin` naming this hub's own loopback port is the dashboard; allowed,
 *   and reflected back so its CORS check passes.
 * - Any other `Origin` on a mutating method is refused with 403. Safe methods
 *   are let through unreflected: without the CORS header the page cannot read
 *   the response, and refusing them would break a plain address-bar visit.
 * - No `Origin` at all is a non-browser client (the `ndx` CLI, an MCP client) —
 *   allowed, except when `Sec-Fetch-Site: cross-site` says a browser sent it
 *   without one.
 *
 * Before any of that, every request — safe methods included — must carry a
 * `Host` naming loopback on the hub's own port, or it is answered 421. The
 * check sits here rather than only in the project servers because the proxy
 * rewrites `Host` for the child (`proxy.ts`), so a server behind the hub never
 * sees the original.
 *
 * With a per-user token configured (`ndx start` always passes one), every
 * request must also present it or a session credential this hub minted, in a
 * header; see `shared/auth.ts`. This is what tells this user's browser and
 * CLI apart from another account on the same machine, which the Host and
 * Origin rules cannot do. A safe-method request without one is passed on
 * marked public-only ({@link isPublicOnlyHubRequest}) so a navigation still
 * gets the page shell that signs itself in; a mutation is answered 401. The
 * credential routes (`/api/auth/*`, at the root or under any `/p/<id>/`) are
 * the hub's own and answered here — never forwarded to a project server.
 *
 * It guards proxied traffic too, not just `/api/hub/*`: the hub is the outer
 * boundary. The proxy restates a *trusted* `Origin` as the child's own (see
 * `proxy.ts`) and forwards an untrusted one unchanged, so a child route that
 * judges its own GETs (`isForeignSiteRequest`) still sees the foreign origin.
 *
 * @module web/hub/request-guard
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  isLoopbackHostOnPort,
  isLoopbackOriginOnPort,
  applySecurityHeaders,
  requestAccess,
  authRouteOf,
  answerAuthRoute,
  authorizeUpgrade,
  detectBasePath,
  stripBasePath,
  stripWorkspaceSlot,
  AUTH_HINT,
} from "../shared/index.js";
import type { CredentialStore, RequestAccess } from "../shared/index.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** What the hub makes of a request's browser-origin metadata. */
export type OriginVerdict = "absent" | "trusted" | "untrusted";

/**
 * Classify a request's origin against the hub's own port.
 *
 * A duplicate `Origin` header (an array) is untrusted rather than merged —
 * a request carrying two origins is not one a browser sends.
 */
export function classifyOrigin(req: Pick<IncomingMessage, "headers">, hubPort: number | undefined): OriginVerdict {
  const raw = req.headers.origin;
  if (raw === undefined) return "absent";
  const origin = singleHeader(raw);
  if (origin === undefined) return "untrusted";
  return isLoopbackOriginOnPort(origin, hubPort) ? "trusted" : "untrusted";
}

function reject(res: ServerResponse): true {
  res.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error: "Cross-origin request rejected" }));
  return true;
}

function rejectHost(res: ServerResponse): true {
  // 421 Misdirected Request: the request was not meant for the server it
  // reached. No CORS headers are set.
  res.writeHead(421, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error: "Request Host does not name this server" }));
  return true;
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

/** Requests the gate let through without a credential. */
const publicOnly = new WeakSet<object>();

/**
 * Whether the gate let `req` through without a credential (a safe method
 * only). The hub then serves it only what is public: the home page shell, and
 * a proxied request with no credential attached, which the project server
 * answers with its own public shell or a 401.
 */
export function isPublicOnlyHubRequest(req: object): boolean {
  return publicOnly.has(req);
}

/** The path a credential route is matched on: no query, no `/p/<id>` or `/w/<key>`. */
export function hubRoutePath(url: string): string {
  const pathname = url.split("?")[0];
  const prefix = detectBasePath(pathname);
  const afterPrefix = prefix ? stripBasePath(prefix, pathname) : pathname;
  return stripWorkspaceSlot(afterPrefix).url;
}

/** Whether the request's `Host` names loopback on the hub's own port. */
export function hostAllowed(req: Pick<IncomingMessage, "headers">, hubPort: number | undefined): boolean {
  return isLoopbackHostOnPort(singleHeader(req.headers.host), hubPort);
}

/**
 * Apply the gate. Returns true when the request has been answered (rejected,
 * or a preflight) and must not be routed further.
 */
export function guardHubRequest(
  req: IncomingMessage,
  res: ServerResponse,
  hubPort: number | undefined,
  token: string | null = null,
  credentials: CredentialStore | null = null,
): boolean {
  // Same headers, same moment as the project server's gate: before any
  // verdict is written, from the shared helper, so the two cannot drift.
  applySecurityHeaders(res);
  if (!hostAllowed(req, hubPort)) return rejectHost(res);

  const method = (req.method || "GET").toUpperCase();
  const route = authRouteOf(hubRoutePath(req.url ?? "/"));
  const access: RequestAccess = requestAccess(req.headers, token, credentials);
  if (access === "public" && route === null) {
    if (method !== "GET" && method !== "HEAD") return rejectUnauthenticated(res);
    publicOnly.add(req);
  }

  const mutating = method === "OPTIONS" || !SAFE_METHODS.has(method);
  const verdict = classifyOrigin(req, hubPort);

  if (verdict === "untrusted" && mutating) return reject(res);
  if (
    verdict === "absent"
    && mutating
    && singleHeader(req.headers["sec-fetch-site"])?.toLowerCase() === "cross-site"
  ) {
    return reject(res);
  }

  if (verdict === "trusted") {
    const origin = singleHeader(req.headers.origin) as string;
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, X-Ndx-Workspace");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  }

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (route !== null) {
    const answer = answerAuthRoute(route, method, req.headers, token, credentials, access);
    const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (answer.status === 401) headers["WWW-Authenticate"] = 'Bearer realm="n-dx"';
    res.writeHead(answer.status, headers);
    res.end(JSON.stringify(answer.body));
    return true;
  }

  return false;
}

/**
 * Why a WebSocket handshake is refused, as the status line to answer with, or
 * null when it may proceed.
 *
 * A handshake carries no preflight, so this is the only check there is: a
 * page that opened `ws://localhost:3117/p/<id>/` would otherwise read every
 * frame the project broadcasts — PRD changes, agent stdout, run state.
 *
 * The rules apply in the same order as the HTTP gate, and each is reported
 * distinctly rather than collapsed into one refusal: Host (421 Misdirected
 * Request), then the credential — the per-user token in a header, or a
 * single-use ticket from `POST /api/auth/ws-ticket` in the URL, spent here —
 * (401 Unauthorized), then Origin (403
 * Forbidden). A boolean here would have answered 403 for a foreign `Host`,
 * which contradicts both the HTTP path above and the project server's own
 * upgrade handler (`server/websocket.ts`).
 */
export function upgradeRefusal(
  req: Pick<IncomingMessage, "headers" | "url">,
  hubPort: number | undefined,
  token: string | null = null,
  credentials: CredentialStore | null = null,
): "421 Misdirected Request" | "401 Unauthorized" | "403 Forbidden" | null {
  if (!hostAllowed(req, hubPort)) return "421 Misdirected Request";
  if (token && !authorizeUpgrade(req, token, credentials).ok) return "401 Unauthorized";
  if (classifyOrigin(req, hubPort) === "untrusted") return "403 Forbidden";
  return null;
}
