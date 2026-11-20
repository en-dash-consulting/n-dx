/**
 * How the hub calls a server on this machine — a project server it
 * supervises, a hub session's host, or its own proxy: plain HTTP to
 * 127.0.0.1, carrying the per-user token as `X-Ndx-Token` when the hub has
 * one. With auth on, a server answers 401 to a request without it.
 *
 * @module web/hub/loopback
 */

import { loopbackOrigin } from "../shared/index.js";

/** `path` (with its query, if any) on the loopback server listening on `port`. */
export function loopbackUrl(port: number, path: string): string {
  return `${loopbackOrigin(port)}${path}`;
}

/** The per-user token as a request header; no header when the hub runs without one. */
export function tokenHeaders(token: string | null | undefined): Record<string, string> {
  return token ? { "X-Ndx-Token": token } : {};
}
