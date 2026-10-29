/**
 * Response headers every loopback server in this package sets.
 *
 * The hub (`hub/request-guard.ts`) and the project server
 * (`server/request-security.ts`) both apply {@link applySecurityHeaders} at
 * the top of their request gate, before any status is written, so the two
 * cannot drift and a refusal carries the headers as much as a page does.
 *
 * - `X-Content-Type-Options: nosniff` — a response is what its Content-Type
 *   says, never what a browser guesses from the bytes.
 * - `X-Frame-Options: DENY` plus `frame-ancestors 'none'` — no page on any
 *   origin may embed the dashboard or the hub.
 * - A Content-Security-Policy. {@link PAGE_CSP} is what the viewer and the hub
 *   home page can run under: both are built with an inline bootstrap script
 *   and inline styles, so `'unsafe-inline'` stays on for scripts and styles,
 *   and everything else is same-origin (plus `data:`/`blob:` for generated
 *   images and downloads, and loopback WebSockets for the live feeds).
 *   {@link STRICT_CSP} is for responses that are data, not documents — the
 *   `/data/*` files — and allows nothing at all, so a file that is somehow
 *   rendered as a document cannot run or load anything.
 *
 * Framework-agnostic: takes anything with `setHeader`, so the hub can use it
 * without importing from `src/server/`.
 */

/** The policy a document response (the viewer, the hub home page) runs under. */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Loopback WebSockets only: the live feeds are on this server, and some
  // browsers do not yet match ws: against 'self'.
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:* ws://[::1]:*",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** The policy a data response runs under: nothing may load or run. */
export const STRICT_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox";

/** The least a response needs: `setHeader`, as `http.ServerResponse` has it. */
export interface HeaderSink {
  setHeader(name: string, value: string): unknown;
}

/**
 * Set the baseline security headers on `res`. Called once per request before
 * routing; a route that serves data rather than a document tightens the CSP
 * afterwards with {@link applyStrictContentPolicy}.
 */
export function applySecurityHeaders(res: HeaderSink): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", PAGE_CSP);
  res.setHeader("Referrer-Policy", "same-origin");
}

/** Replace the page policy with {@link STRICT_CSP} on a response that is data, not a document. */
export function applyStrictContentPolicy(res: HeaderSink): void {
  res.setHeader("Content-Security-Policy", STRICT_CSP);
}
