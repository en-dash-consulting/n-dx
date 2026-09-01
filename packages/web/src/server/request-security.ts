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
 * Only the dashboard itself may make browser CORS requests. Comparing against
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
 * Requests without browser origin metadata remain supported for CLI and MCP
 * clients. Origin-bearing mutations must come from this loopback server, while
 * Fetch Metadata rejects cross-site mutations if a browser omits Origin.
 * Returns true when the request has been fully handled.
 */
export function handleRequestSecurity(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
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
