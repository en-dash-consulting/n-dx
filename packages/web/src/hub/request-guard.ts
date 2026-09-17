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
 * It guards proxied traffic too, not just `/api/hub/*`: the hub is the outer
 * boundary, and it rewrites the forwarded `Origin` for the child behind it
 * (see `proxy.ts`), so the child can no longer tell a browser origin apart.
 *
 * @module web/hub/request-guard
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { isLoopbackOriginOnPort } from "../shared/index.js";

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

/**
 * Apply the gate. Returns true when the request has been answered (rejected,
 * or a preflight) and must not be routed further.
 */
export function guardHubRequest(req: IncomingMessage, res: ServerResponse, hubPort: number | undefined): boolean {
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
 */
export function upgradeAllowed(req: Pick<IncomingMessage, "headers">, hubPort: number | undefined): boolean {
  return classifyOrigin(req, hubPort) !== "untrusted";
}
