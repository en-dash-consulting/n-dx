/**
 * Browser-origin gate at the hub edge.
 *
 * A faithful copy of server/request-security.ts, duplicated rather than
 * imported: the hub zone must not import from src/server (see the hub
 * containment assertion in boundary-check.test.ts), the same way core/web.js
 * duplicates rather than imports across the orchestration boundary.
 *
 * It must exist at the edge because the proxy STRIPS browser-origin metadata
 * before forwarding (see ./proxy.ts): the child validates Origin against its
 * own socket port, which through a proxy is always a mismatch. Stripping
 * without this gate would turn the hub into a CORS bypass — any website could
 * POST to 127.0.0.1:3117 and reach a child that no longer sees the Origin.
 * So the hub applies the identical policy against ITS port first, and only
 * requests that pass are forwarded, origin-free.
 *
 * Keep the logic in lockstep with server/request-security.ts.
 *
 * @module hub/edge-security
 */

import type { IncomingMessage, ServerResponse } from "node:http";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "http:" ? 80 : 443;
}

/**
 * Only the hub's own pages may make browser CORS requests. Comparing against
 * the socket's local port, rather than the attacker-controlled Host header,
 * also prevents a DNS-rebinding origin from presenting a matching Host value.
 */
function isTrustedBrowserOrigin(origin: string, req: IncomingMessage): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:"
      && LOOPBACK_HOSTNAMES.has(url.hostname)
      && req.socket.localPort !== undefined
      && effectivePort(url) === req.socket.localPort;
  } catch {
    return false;
  }
}

function setCorsHeaders(res: ServerResponse, origin: string): void {
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
 * Apply browser-origin and CORS protection before routing/proxying.
 * Returns true when the request has been fully handled (rejected or
 * preflight-answered) and must not be forwarded.
 */
export function handleEdgeSecurity(req: IncomingMessage, res: ServerResponse): boolean {
  const method = (req.method || "GET").toUpperCase();
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

  return false;
}
