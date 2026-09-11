import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_REQUEST_BODY_BYTES } from "./response-utils.js";

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
 *
 * Exported so the WebSocket upgrade path can apply the same check — browsers do
 * not send a CORS preflight for a WebSocket handshake, so without this any page
 * open in the user's browser could open `ws://localhost:<port>` and read every
 * broadcast.
 */
export function isTrustedBrowserOrigin(origin: string, req: IncomingMessage): boolean {
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

  return false;
}
