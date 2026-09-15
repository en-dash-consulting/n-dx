/**
 * HTTP response helpers for route handlers.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Largest request body any dashboard route will buffer, in bytes.
 *
 * The biggest legitimate payload is a PRD bundle import (`ndx prd import`
 * posted through the dashboard); 10 MB covers a very large PRD with headroom.
 * A body past this is refused rather than accumulated, so a local process (the
 * server is loopback-only) cannot drive it out of memory with one giant POST.
 * Enforced up front by the Content-Length check in `handleRequestSecurity`
 * (a proper 413 before any buffering) and, for a chunked body that carries no
 * Content-Length, by the streamed cap in {@link readBody} below.
 */
export const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

/** JSON API response helper. */
export function jsonResponse(
  res: ServerResponse,
  status: number,
  data: unknown,
): void {
  // No-op once the response is committed. A route that already answered (e.g.
  // a 413 sent by the size guard before it ran) must not have a later
  // errorResponse/jsonResponse throw ERR_HTTP_HEADERS_SENT over the top of it.
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(data));
}

/** Plain-text error response helper. */
export function errorResponse(
  res: ServerResponse,
  status: number,
  message: string,
): void {
  jsonResponse(res, status, { error: message });
}

/**
 * Read the full request body as a string, refusing bodies over
 * {@link MAX_REQUEST_BODY_BYTES}.
 *
 * A request with a Content-Length header is already refused with 413 by
 * `handleRequestSecurity` before it reaches a route, so this cap is the
 * backstop for a chunked body that declares no length: on overflow it stops
 * buffering, destroys the request, and rejects — the caller's existing
 * try/catch turns that into a 400, and either way the server has bounded how
 * much it will hold in memory.
 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const onData = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > MAX_REQUEST_BODY_BYTES) {
        req.off("data", onData);
        req.destroy();
        reject(new Error(`Request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit.`));
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
