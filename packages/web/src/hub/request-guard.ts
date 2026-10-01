/**
 * The hub's browser-origin gate.
 *
 * The hub listens on a fixed, well-known port (3117) with no authentication,
 * and `POST /api/hub/projects` makes it *spawn a process*: `ndxBin` is any
 * absolute path that exists on disk. A `fetch` from any page the user has open
 * is a same-site-less cross-origin request, and a `text/plain` POST is a CORS
 * "simple request" — no preflight, so nothing asks the hub's permission before
 * the body arrives. Without this gate, visiting a web page was enough to make
 * the hub execute a chosen file.
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
 * request must also present it, or it is answered 401; see `enforceHubToken`.
 * This is what tells this user's browser and CLI apart from another account
 * on the same machine, which the Host and Origin rules cannot do.
 *
 * It guards proxied traffic too, not just `/api/hub/*`: the hub is the outer
 * boundary, and it rewrites the forwarded `Origin` for the child behind it
 * (see `proxy.ts`), so the child can no longer tell a browser origin apart.
 *
 * @module web/hub/request-guard
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { isLoopbackHostOnPort, isLoopbackOriginOnPort, isAuthenticated, splitTokenQuery, tokensEqual, authCookie } from "../shared/index.js";

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
  res.end(JSON.stringify({
    error: "Authentication required",
    hint: "Open the URL printed by `ndx start`, or send the token from <ndx home>/auth.token as `Authorization: Bearer <token>` or `X-Ndx-Token`.",
  }));
  return true;
}

/**
 * The per-user token rule, same as the project server's
 * (`server/request-security.ts`, which the hub cannot import): present it in
 * a header or the cookie, or — for a safe-method navigation — carry it once
 * as `?ndx_token=` and be redirected with the cookie set. Returns true when
 * the request has been answered.
 */
export function enforceHubToken(req: IncomingMessage, res: ServerResponse, token: string): boolean {
  if (isAuthenticated(req.headers, token)) return false;
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    const { token: fromQuery, location } = splitTokenQuery(req.url ?? "/");
    if (fromQuery !== null && tokensEqual(fromQuery, token)) {
      res.writeHead(302, { Location: location, "Set-Cookie": authCookie(token), "Cache-Control": "no-store" });
      res.end();
      return true;
    }
  }
  return rejectUnauthenticated(res);
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
): boolean {
  if (!hostAllowed(req, hubPort)) return rejectHost(res);
  if (token && enforceHubToken(req, res, token)) return true;

  const method = (req.method || "GET").toUpperCase();
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

  return false;
}

/**
 * Whether a WebSocket upgrade may be forwarded.
 *
 * A handshake carries no preflight, so this is the only check there is: a
 * page that opened `ws://localhost:3117/p/<id>/` would otherwise read every
 * frame the project broadcasts — PRD changes, agent stdout, run state.
 *
 * The `Host` rule is applied here as well, so the HTTP and upgrade paths cannot
 * disagree about what "this server" means.
 */
export function upgradeAllowed(
  req: Pick<IncomingMessage, "headers">,
  hubPort: number | undefined,
  token: string | null = null,
): boolean {
  return upgradeRefusal(req, hubPort, token) === null;
}

/**
 * Why a handshake is refused, as the status line to answer with, or null
 * when it may proceed. The rules apply in the same order as the HTTP gate:
 * Host (421), then the per-user token (401), then Origin (403).
 */
export function upgradeRefusal(
  req: Pick<IncomingMessage, "headers">,
  hubPort: number | undefined,
  token: string | null = null,
): "421 Misdirected Request" | "401 Unauthorized" | "403 Forbidden" | null {
  if (!hostAllowed(req, hubPort)) return "421 Misdirected Request";
  if (token && !isAuthenticated(req.headers, token)) return "401 Unauthorized";
  if (classifyOrigin(req, hubPort) === "untrusted") return "403 Forbidden";
  return null;
}
