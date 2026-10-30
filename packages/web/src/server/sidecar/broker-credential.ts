/**
 * The credential a Sidecar session's vendor CLI presents to its broker.
 *
 * The CLI reads its MCP config from a file, and the session's own Read tool
 * can open any file the user can (design C7: no secret in a session's readable
 * paths). So the file must not carry the dashboard's per-user token, which
 * unlocks every route. It carries a per-session secret instead, and the
 * request gate accepts that secret on exactly one route: `POST` to that
 * session's own `/mcp` endpoint. A leaked secret grants only the broker calls
 * the session could already make, each still behind its permission card.
 *
 * Secrets live in memory for the server's life. A restarted server mints a new
 * one, and the next turn's spawn rewrites the config with it.
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { tokensEqual } from "../../shared/index.js";

/** The header carrying a session's broker credential. */
export const SIDECAR_BROKER_KEY_HEADER = "x-ndx-sidecar-key";

/**
 * The one request-target a credential is valid on. Matched against the raw
 * target, so a `/w/<key>/` slot, a dot segment or a percent-encoded slash
 * never matches; a query string is allowed.
 */
const BROKER_TARGET = /^\/api\/sidecar\/sessions\/([\w-]+)\/mcp(?:\?.*)?$/;

const credentials = new Map<string, string>();

/** The session's broker credential, minted on first use and stable for the server's life. */
export function sidecarBrokerCredential(sessionId: string): string {
  let secret = credentials.get(sessionId);
  if (!secret) {
    secret = randomBytes(32).toString("base64url");
    credentials.set(sessionId, secret);
  }
  return secret;
}

/**
 * Whether `req` is a `POST` to a session's broker endpoint presenting that
 * session's credential. Any other route, method or session refuses it.
 */
export function isSidecarBrokerRequest(req: Pick<IncomingMessage, "method" | "url" | "headers">): boolean {
  if ((req.method ?? "GET").toUpperCase() !== "POST") return false;
  const match = BROKER_TARGET.exec(req.url ?? "");
  if (!match) return false;
  const expected = credentials.get(match[1]);
  const presented = req.headers[SIDECAR_BROKER_KEY_HEADER];
  return expected !== undefined && typeof presented === "string" && tokensEqual(presented, expected);
}
