/**
 * Minimal reverse proxy for the hub — plain node:http, no dependency.
 *
 * Every request under /p/:id/* (and, with a sole registered project, the root
 * surface) is forwarded to the project's child server on 127.0.0.1. Bodies are
 * streamed in both directions — MCP POSTs and large data responses must not
 * be buffered — and the WebSocket upgrade is forwarded by replaying the
 * upgrade request against the child and then piping the two sockets raw.
 *
 * Browser-origin metadata (Origin, Sec-Fetch-*) is stripped before
 * forwarding. The child validates a browser Origin against its OWN socket
 * port (see server/request-security.ts), so a proxied request carrying the
 * hub's origin would be rejected as cross-origin. The hub applies the same
 * gate itself at the edge (see ./edge-security.ts); past it, the child sees a
 * plain loopback service client — the branch request-security.ts keeps for
 * CLI and MCP clients.
 *
 * @module hub/proxy
 */

import { request, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

const TARGET_HOST = "127.0.0.1";

/** Request headers the hub owns and must not forward. */
function forwardableHeaders(req: IncomingMessage, port: number): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (lower === "host" || lower === "origin" || lower.startsWith("sec-fetch-")) continue;
    headers[name] = value;
  }
  headers["host"] = `${TARGET_HOST}:${port}`;
  return headers;
}

function sendBadGateway(res: ServerResponse, detail: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(502, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: `project server unreachable: ${detail}` }));
}

/**
 * Forward one HTTP request to the child on `port`, rewriting the path to
 * `path` (prefix already stripped by the caller; query string included).
 */
export function proxyHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  path: string,
): void {
  const proxyReq = request(
    {
      host: TARGET_HOST,
      port,
      method: req.method,
      path,
      headers: forwardableHeaders(req, port),
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => sendBadGateway(res, err.message));
  // An aborted client request must not leave a dangling upstream request.
  req.on("error", () => proxyReq.destroy());
  res.on("close", () => proxyReq.destroy());

  req.pipe(proxyReq);
}

/**
 * Forward a request whose body the hub has ALREADY consumed (it had to read
 * the JSON to route on it — /api/reload's `dir` field). The streaming proxy
 * cannot be used at that point, so the buffered body is re-sent verbatim and
 * the child's response relayed.
 */
export function proxyBufferedRequest(
  res: ServerResponse,
  port: number,
  path: string,
  method: string,
  body: string,
): void {
  const proxyReq = request(
    {
      host: TARGET_HOST,
      port,
      method,
      path,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        host: `${TARGET_HOST}:${port}`,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (err) => sendBadGateway(res, err.message));
  proxyReq.end(body);
}

/**
 * Forward a WebSocket upgrade to the child on `port` and pipe the sockets.
 *
 * The upgrade request is replayed via http.request — the child's handshake
 * (server/websocket.ts) needs the original Sec-WebSocket-* headers, which
 * forwardableHeaders preserves. After the child answers 101, both sockets are
 * piped raw in both directions; frames are opaque to the hub.
 */
export function proxyUpgrade(
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  port: number,
  path: string,
): void {
  const headers = forwardableHeaders(req, port);
  // node strips connection-level headers from the header bag on request();
  // the upgrade pair must be stated explicitly for the child to switch.
  headers["connection"] = "Upgrade";
  headers["upgrade"] = req.headers.upgrade ?? "websocket";

  const proxyReq = request({
    host: TARGET_HOST,
    port,
    method: req.method,
    path,
    headers,
  });

  const abort = () => {
    proxyReq.destroy();
    clientSocket.destroy();
  };

  proxyReq.on("error", abort);
  clientSocket.on("error", abort);

  // The child answered with a plain response instead of switching protocols —
  // relay the refusal rather than leaving the client hanging.
  proxyReq.on("response", (proxyRes) => {
    const status = proxyRes.statusCode ?? 502;
    clientSocket.write(`HTTP/1.1 ${status} ${proxyRes.statusMessage ?? ""}\r\n\r\n`);
    clientSocket.end();
    proxyReq.destroy();
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    const lines = [`HTTP/1.1 ${proxyRes.statusCode ?? 101} ${proxyRes.statusMessage ?? "Switching Protocols"}`];
    for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
      lines.push(`${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}`);
    }
    clientSocket.write(lines.join("\r\n") + "\r\n\r\n");

    if (proxyHead.length > 0) clientSocket.write(proxyHead);
    if (head.length > 0) proxySocket.write(head);

    proxySocket.on("error", abort);
    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);
  });

  proxyReq.end();
}
