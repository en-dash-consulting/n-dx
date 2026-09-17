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
 * backstop for a chunked body that declares no length.
 *
 * On overflow it stops buffering and answers 413 itself — the same status and
 * body the Content-Length guard sends — then rejects. It used to call
 * `req.destroy()` first and leave the answering to the caller's try/catch,
 * which could not work: destroying the request destroys the socket, so the
 * caller's `errorResponse` wrote a 400 into a closed connection and the client
 * got zero bytes and an EPIPE. A cap rejection was indistinguishable from a
 * crash.
 *
 * The rejection still happens, so callers keep their existing `catch`. Nothing
 * there needs to change: `jsonResponse` and `errorResponse` no-op once the
 * response is committed, so a caller's follow-up 400 lands on a response that
 * has already said 413.
 *
 * The request is not destroyed. `Connection: close` tells the client this is
 * the end, and Node closes the socket once the response has flushed — the
 * remaining bytes are read and discarded rather than buffered, so the memory
 * bound holds either way. Without `res` (a caller that has none to give) there
 * is nothing to say, and the old destroy-and-reject is all that is left.
 *
 * @param res Response to answer 413 on. Omit only where there is none.
 */
export function readBody(req: IncomingMessage, res?: ServerResponse): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const onData = (chunk: Buffer): void => {
      total += chunk.length;
      if (total > MAX_REQUEST_BODY_BYTES) {
        req.off("data", onData);
        const message = `Request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit.`;
        if (res && !res.headersSent && !res.writableEnded) {
          res.writeHead(413, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            Connection: "close",
          });
          res.end(JSON.stringify({ error: message }));
        } else {
          req.destroy();
        }
        reject(new Error(message));
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
