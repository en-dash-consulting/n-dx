/**
 * HTTP response helpers for route handlers.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** JSON API response helper. */
export function jsonResponse(
  res: ServerResponse,
  status: number,
  data: unknown,
): void {
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

/** Read the full request body as a string. */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
