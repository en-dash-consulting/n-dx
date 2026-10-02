/**
 * How a request proves it belongs to the user who started the servers.
 *
 * Loopback is shared by every account on a host, so the Host and Origin
 * rules in `origin.ts` tell a web page apart from the dashboard but cannot
 * tell one local user from another. When a server runs with a token (see
 * `@n-dx/llm-client`'s `auth-token.ts`), every request must present it in
 * one of three places:
 *
 * - `Authorization: Bearer <token>` — MCP clients and scripts;
 * - `X-Ndx-Token: <token>` — the hub's own probes and the CLI;
 * - the `ndx_token` cookie — the browser, set once by a navigation that
 *   carried `?ndx_token=<token>`, which is how the URL `ndx start` prints
 *   opens the dashboard without a prompt.
 *
 * Pure and framework-agnostic so the hub and the project server share one
 * definition, like `origin.ts`. Comparison is constant-time.
 */

export const AUTH_COOKIE_NAME = "ndx_token";
export const AUTH_HEADER_NAME = "x-ndx-token";
export const AUTH_QUERY_PARAM = "ndx_token";

/** The subset of request headers the check reads; `string[]` means a duplicated header. */
export interface AuthHeaders {
  authorization?: string | string[];
  "x-ndx-token"?: string | string[];
  cookie?: string | string[];
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Constant-time equality; a missing candidate is never equal. */
export function tokensEqual(candidate: string | null | undefined, expected: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  // Compare against a same-length string so the loop length does not leak
  // the expected length either.
  const a = candidate;
  const b = expected.length === a.length ? expected : "\0".repeat(a.length);
  let diff = expected.length === a.length ? 0 : 1;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The value of one cookie in a `Cookie` header, or null. */
export function parseCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

/**
 * The token a request presents, from the first place that carries one:
 * bearer header, then `X-Ndx-Token`, then the cookie. A duplicated header is
 * ignored rather than merged.
 */
export function presentedToken(headers: AuthHeaders): string | null {
  const auth = single(headers.authorization);
  if (auth) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) return m[1];
  }
  const header = single(headers["x-ndx-token"]);
  if (header && header.trim()) return header.trim();
  return parseCookieValue(single(headers.cookie), AUTH_COOKIE_NAME);
}

/** Whether `headers` present `expected`. */
export function isAuthenticated(headers: AuthHeaders, expected: string): boolean {
  return tokensEqual(presentedToken(headers), expected);
}

/**
 * Pull `?ndx_token=` out of a request URL. `location` is the same URL with
 * the parameter removed, for the redirect that follows setting the cookie.
 */
export function splitTokenQuery(url: string): { token: string | null; location: string } {
  const q = url.indexOf("?");
  if (q === -1) return { token: null, location: url };
  const path = url.slice(0, q);
  const params = new URLSearchParams(url.slice(q + 1));
  const token = params.get(AUTH_QUERY_PARAM);
  if (token === null) return { token: null, location: url };
  params.delete(AUTH_QUERY_PARAM);
  const rest = params.toString();
  return { token, location: rest ? `${path}?${rest}` : path };
}

/**
 * The `Set-Cookie` value that remembers the token in the browser. HttpOnly
 * so page script never reads it, SameSite=Strict so no other site's
 * navigation sends it, Path=/ so the hub's `/p/<id>/` prefixes share it.
 * No `Secure`: these servers are plain HTTP on loopback by design.
 */
export function authCookie(token: string): string {
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`;
}

/** A dashboard URL that sets the cookie on first open. */
export function urlWithToken(base: string, token: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${AUTH_QUERY_PARAM}=${encodeURIComponent(token)}`;
}
