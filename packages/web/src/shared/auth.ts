/**
 * How a request proves it belongs to the user who started the servers.
 *
 * Loopback is shared by every account on a host, so the Host and Origin
 * rules in `origin.ts` tell a web page apart from the dashboard but cannot
 * tell one local user from another. When a server runs with a per-user token
 * (see `@n-dx/llm-client`'s `auth-token.ts`), every request must present a
 * credential in a header — never a cookie, because a cookie on `localhost` is
 * sent to every port on it:
 *
 * - the per-user token, as `Authorization: Bearer <token>` or
 *   `X-Ndx-Token: <token>` — MCP clients, scripts, the CLI and the hub's own
 *   calls to the project servers it supervises;
 * - a session credential, in the same headers — the browser. It is minted by
 *   the server the page is on, in exchange for a single-use nonce that the
 *   URL `ndx start` prints carries, and the page keeps it in `sessionStorage`,
 *   which is scoped to the origin and so to the port.
 *
 * WebSocket handshakes carry no custom headers from a browser, so a page
 * trades its session credential for a single-use ticket and puts that in the
 * socket URL.
 *
 * Sessions, nonces and tickets live in the memory of the server that minted
 * them ({@link CredentialStore}): a restart revokes all of them. The reasoning
 * is in docs/architecture/web-server.md ("Authentication").
 *
 * Pure and framework-agnostic so the hub and the project server share one
 * definition, like `origin.ts`. Every comparison is constant-time.
 */

export const AUTH_HEADER_NAME = "x-ndx-token";
/** Legacy URL parameter: removed before forwarding to extension code, never accepted for authentication. */
const AUTH_QUERY_PARAM = "ndx_token";
/** The header a landing page sends its nonce in, to {@link AUTH_ROUTES}.session. */
export const NONCE_HEADER_NAME = "x-ndx-nonce";
/** The query parameter the printed URL carries the nonce in. */
export const NONCE_QUERY_PARAM = "ndx_nonce";
/** The query parameter a WebSocket URL carries its ticket in. */
export const TICKET_QUERY_PARAM = "ndx_ticket";
/** The `sessionStorage` key a page keeps its session credential under. */
export const SESSION_STORAGE_KEY = "ndx.session";

/**
 * The credential routes. Every server that takes a token answers them itself
 * (the hub never forwards them to a project server), always at the root, and
 * also under a `/p/<id>/` or `/w/<key>/` base path.
 */
export const AUTH_ROUTES = {
  /** GET, no credential needed: `{ required, authenticated }`. */
  state: "/api/auth/state",
  /** POST with the per-user token: `{ nonce, expiresAt }`. */
  nonce: "/api/auth/nonce",
  /** POST with `X-Ndx-Nonce`: `{ credential, expiresAt }`; the nonce is spent either way. */
  session: "/api/auth/session",
  /** POST with any credential: `{ ticket, expiresAt }` for one WebSocket handshake. */
  wsTicket: "/api/auth/ws-ticket",
} as const;

/** How long a landing nonce may wait to be exchanged. */
export const NONCE_TTL_MS = 60_000;
/** How long a WebSocket ticket may wait to be used. */
export const TICKET_TTL_MS = 30_000;
/** A session ends after this long without a request… */
export const SESSION_IDLE_TTL_MS = 12 * 60 * 60_000;
/** …and after this long regardless. */
export const SESSION_MAX_TTL_MS = 7 * 24 * 60 * 60_000;

/** The subset of request headers the checks read; `string[]` means a duplicated header. */
export interface AuthHeaders {
  authorization?: string | string[];
  "x-ndx-token"?: string | string[];
  "x-ndx-nonce"?: string | string[];
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

/**
 * The credential a request presents: the bearer header, then `X-Ndx-Token`.
 * A duplicated header is ignored rather than merged. Cookies are never read.
 */
export function presentedToken(headers: AuthHeaders): string | null {
  const auth = single(headers.authorization);
  if (auth) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) return m[1];
  }
  const header = single(headers["x-ndx-token"]);
  if (header && header.trim()) return header.trim();
  return null;
}

/** Whether `headers` present the per-user token `expected` itself. */
export function isAuthenticated(headers: AuthHeaders, expected: string): boolean {
  return tokensEqual(presentedToken(headers), expected);
}

/** A 256-bit CSPRNG value, base64url. */
export function randomCredential(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface Entry {
  value: string;
  expiresAt: number;
  /** Sessions only: when the session ends however busy it is. */
  hardExpiresAt?: number;
}

/** Tuning for {@link CredentialStore}; tests shorten the clocks. */
export interface CredentialStoreOptions {
  now?: () => number;
  random?: () => string;
  nonceTtlMs?: number;
  ticketTtlMs?: number;
  sessionIdleTtlMs?: number;
  sessionMaxTtlMs?: number;
  /** Cap per kind; the oldest entry is dropped past it. */
  maxEntries?: number;
}

/**
 * The short-lived browser credentials one server has issued: landing nonces,
 * sessions and WebSocket tickets. In memory only, so a restart revokes
 * everything; none of them is ever the per-user token or derived from it.
 *
 * Lookups walk every live entry with {@link tokensEqual} rather than indexing
 * a map by the presented value, so how long a check takes does not depend on
 * how much of a guess matched. The caps keep that walk short.
 */
export class CredentialStore {
  private readonly now: () => number;
  private readonly random: () => string;
  private readonly nonceTtlMs: number;
  private readonly ticketTtlMs: number;
  private readonly sessionIdleTtlMs: number;
  private readonly sessionMaxTtlMs: number;
  private readonly maxEntries: number;
  private nonces: Entry[] = [];
  private tickets: Entry[] = [];
  private sessions: Entry[] = [];

  constructor(options: CredentialStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? randomCredential;
    this.nonceTtlMs = options.nonceTtlMs ?? NONCE_TTL_MS;
    this.ticketTtlMs = options.ticketTtlMs ?? TICKET_TTL_MS;
    this.sessionIdleTtlMs = options.sessionIdleTtlMs ?? SESSION_IDLE_TTL_MS;
    this.sessionMaxTtlMs = options.sessionMaxTtlMs ?? SESSION_MAX_TTL_MS;
    this.maxEntries = options.maxEntries ?? 256;
  }

  private add(list: Entry[], entry: Entry): void {
    list.push(entry);
    while (list.length > this.maxEntries) list.shift();
  }

  private live(list: Entry[]): Entry[] {
    const now = this.now();
    return list.filter((e) => e.expiresAt > now);
  }

  /** Walk every entry; return the index of the match, or -1. Constant work per entry. */
  private find(list: Entry[], candidate: string | null | undefined): number {
    let found = -1;
    for (let i = 0; i < list.length; i++) {
      if (tokensEqual(candidate, list[i].value) && found === -1) found = i;
    }
    return found;
  }

  /** A single-use nonce for the URL `ndx start` prints. */
  mintNonce(): { nonce: string; expiresAt: number } {
    this.nonces = this.live(this.nonces);
    const entry = { value: this.random(), expiresAt: this.now() + this.nonceTtlMs };
    this.add(this.nonces, entry);
    return { nonce: entry.value, expiresAt: entry.expiresAt };
  }

  /**
   * Spend `nonce` for a new session. The nonce is gone after this whatever the
   * answer, so a second exchange of the same value fails. Null when the nonce
   * is unknown, already used, or expired.
   */
  exchangeNonce(nonce: string | null | undefined): { credential: string; expiresAt: number } | null {
    this.nonces = this.live(this.nonces);
    const i = this.find(this.nonces, nonce);
    if (i === -1) return null;
    this.nonces.splice(i, 1);
    return this.mintSession();
  }

  /** A new session, without a nonce: for a credential the caller hands out by some other proof. */
  mintSession(): { credential: string; expiresAt: number } {
    this.sessions = this.live(this.sessions);
    const now = this.now();
    const hard = now + this.sessionMaxTtlMs;
    const entry = { value: this.random(), expiresAt: Math.min(now + this.sessionIdleTtlMs, hard), hardExpiresAt: hard };
    this.add(this.sessions, entry);
    return { credential: entry.value, expiresAt: entry.expiresAt };
  }

  /** Whether `credential` is a live session; using it pushes its idle expiry out. */
  isSession(credential: string | null | undefined): boolean {
    this.sessions = this.live(this.sessions);
    const i = this.find(this.sessions, credential);
    if (i === -1) return false;
    const entry = this.sessions[i];
    entry.expiresAt = Math.min(this.now() + this.sessionIdleTtlMs, entry.hardExpiresAt ?? Infinity);
    return true;
  }

  /** A single-use ticket for one WebSocket handshake. */
  mintTicket(): { ticket: string; expiresAt: number } {
    this.tickets = this.live(this.tickets);
    const entry = { value: this.random(), expiresAt: this.now() + this.ticketTtlMs };
    this.add(this.tickets, entry);
    return { ticket: entry.value, expiresAt: entry.expiresAt };
  }

  /** Spend `ticket`. True once for a live ticket; false ever after. */
  consumeTicket(ticket: string | null | undefined): boolean {
    this.tickets = this.live(this.tickets);
    const i = this.find(this.tickets, ticket);
    if (i === -1) return false;
    this.tickets.splice(i, 1);
    return true;
  }

  /** Forget every nonce, session and ticket. */
  revokeAll(): void {
    this.nonces = [];
    this.tickets = [];
    this.sessions = [];
  }
}

/** What a request's credential amounts to. */
export type RequestAccess =
  /** The per-user token itself, or a server running without one. */
  | "token"
  /** A browser session this server minted. */
  | "session"
  /** Nothing valid: only the public shell and the pre-auth routes. */
  | "public";

/**
 * Judge a request's headers. With no `token` the server runs open and every
 * request is `"token"`.
 */
export function requestAccess(
  headers: AuthHeaders,
  token: string | null | undefined,
  store: CredentialStore | null | undefined,
): RequestAccess {
  if (!token) return "token";
  const presented = presentedToken(headers);
  if (tokensEqual(presented, token)) return "token";
  if (store?.isSession(presented)) return "session";
  return "public";
}

/** Remove one query parameter from a request target; `value` is its value or null. */
export function splitQueryParam(url: string, name: string): { value: string | null; url: string } {
  const q = url.indexOf("?");
  if (q === -1) return { value: null, url };
  let value: string | null = null;
  const kept: string[] = [];
  for (const segment of url.slice(q + 1).split("&")) {
    const [entry] = new URLSearchParams(segment);
    if (entry?.[0] === name) value ??= entry[1];
    else kept.push(segment);
  }
  if (value === null) return { value: null, url };
  const rest = kept.join("&");
  const path = sameOriginPath(url.slice(0, q));
  return { value, url: rest ? `${path}?${rest}` : path };
}

export function splitTokenQuery(url: string): { token: string | null; location: string } {
  const q = url.indexOf("?");
  if (q === -1) return { token: null, location: url };
  const path = sameOriginPath(url.slice(0, q));
  const { token, rest } = removeTokenParam(url.slice(q + 1));
  if (token === null) return { token: null, location: url };
  return { token, location: rest ? `${path}?${rest}` : path };
}

/**
 * Remove every `ndx_token` segment from a raw query string (no leading `?`).
 * `token` is the first one's decoded value, or null when there is none.
 *
 * Every other segment is kept byte for byte. Re-serialising through
 * `URLSearchParams` would rewrite them: `%20` becomes `+`, a bare key gains
 * `=`, `/` and `~` are escaped, and invalid UTF-8 such as `%E9` is replaced
 * by `%EF%BF%BD` — data loss for whoever reads the query next.
 */
export function removeTokenParam(query: string): { token: string | null; rest: string } {
  let token: string | null = null;
  const kept: string[] = [];
  for (const segment of query.split("&")) {
    // One segment through URLSearchParams decodes its key exactly as a full
    // parse would (`+`, percent escapes), so `ndx%5Ftoken=T` is caught too.
    const [entry] = new URLSearchParams(segment);
    if (entry?.[0] === AUTH_QUERY_PARAM) {
      token ??= entry[1];
      continue;
    }
    kept.push(segment);
  }
  return { token, rest: token === null ? query : kept.join("&") };
}

/** `path` when it is one leading `/` not followed by `/` or `\`; otherwise `/`. */
function sameOriginPath(path: string): string {
  return /^\/(?![/\\])/.test(path) ? path : "/";
}

/**
 * Whether a WebSocket handshake carries a credential: the per-user token in a
 * header (the CLI; the hub, forwarding an upgrade it already judged), or a
 * single-use ticket in the URL (a browser, which cannot set headers on a
 * handshake). The ticket is spent here. `url` is the request target without
 * the ticket, for forwarding.
 */
export function authorizeUpgrade(
  req: { headers: AuthHeaders; url?: string },
  token: string | null | undefined,
  store: CredentialStore | null | undefined,
): { ok: boolean; url: string } {
  const { value: ticket, url } = splitQueryParam(req.url ?? "/", TICKET_QUERY_PARAM);
  if (!token) return { ok: true, url };
  if (isAuthenticated(req.headers, token)) return { ok: true, url };
  return { ok: !!store?.consumeTicket(ticket), url };
}

/** A dashboard URL carrying a landing nonce. */
export function urlWithNonce(base: string, nonce: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${NONCE_QUERY_PARAM}=${encodeURIComponent(nonce)}`;
}

/** Which credential route `pathname` (already stripped of any base path) names, or null. */
export function authRouteOf(pathname: string): keyof typeof AUTH_ROUTES | null {
  for (const key of Object.keys(AUTH_ROUTES) as Array<keyof typeof AUTH_ROUTES>) {
    if (AUTH_ROUTES[key] === pathname) return key;
  }
  return null;
}

/** A JSON answer a gate writes for a credential route. */
export interface AuthRouteAnswer {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Answer a credential route. Pure over the store, so the hub and the project
 * server write the same responses.
 *
 * - `state` — public; says whether a credential is needed and whether this
 *   request has one. Reveals nothing else.
 * - `nonce` — the per-user token only. A session cannot mint the nonces that
 *   would mint more sessions.
 * - `session` — the nonce is the credential; no other is needed.
 * - `wsTicket` — any credential.
 */
export function answerAuthRoute(
  route: keyof typeof AUTH_ROUTES,
  method: string,
  headers: AuthHeaders,
  token: string | null | undefined,
  store: CredentialStore | null | undefined,
  access: RequestAccess,
): AuthRouteAnswer {
  const m = method.toUpperCase();
  if (route === "state") {
    if (m !== "GET" && m !== "HEAD") return { status: 405, body: { error: `${method} not allowed` } };
    return { status: 200, body: { required: !!token, authenticated: access !== "public" } };
  }
  if (m !== "POST") return { status: 405, body: { error: `${method} not allowed` } };
  if (!token || !store) {
    // An open server needs no credential, so it hands out none.
    return { status: 404, body: { error: "This server runs without a token; no credential is needed" } };
  }
  if (route === "nonce") {
    if (access !== "token") return unauthenticatedAnswer();
    return { status: 200, body: store.mintNonce() };
  }
  if (route === "session") {
    const nonce = single(headers["x-ndx-nonce"]);
    const session = store.exchangeNonce(nonce);
    if (!session) {
      return {
        status: 401,
        body: {
          error: "This sign-in link has expired or was already used",
          hint: "Run `ndx start` again for a fresh link.",
        },
      };
    }
    return { status: 200, body: session };
  }
  // wsTicket
  if (access === "public") return unauthenticatedAnswer();
  return { status: 200, body: store.mintTicket() };
}

function unauthenticatedAnswer(): AuthRouteAnswer {
  return {
    status: 401,
    body: {
      error: "Authentication required",
      hint: AUTH_HINT,
    },
  };
}

/** The hint every 401 carries. */
export const AUTH_HINT =
  "Open the URL printed by `ndx start` (run it again for a fresh link), or send the token from <ndx home>/auth.token as `Authorization: Bearer <token>` or `X-Ndx-Token`.";

/**
 * The page a browser navigation without a credential gets when it asked for
 * something other than the dashboard shell (which signs itself in).
 */
export function authRequiredPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in needed</title>`
    + `<style>body{font:15px/1.5 system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;color:#ddd;background:#111}code{background:#222;padding:.1em .3em;border-radius:3px}</style></head>`
    + `<body><h1>Sign-in needed</h1><p>This n-dx server only answers the browser tab that opened the link <code>ndx start</code> printed.</p>`
    + `<p>Run <code>ndx start</code> in the project again and open the URL it prints. The link works once and for about a minute.</p></body></html>`;
}

/** Whether a request wants an HTML page rather than data, judged from its headers. */
export function wantsHtml(headers: { accept?: string | string[]; "sec-fetch-mode"?: string | string[] }): boolean {
  if (single(headers["sec-fetch-mode"])?.toLowerCase() === "navigate") return true;
  return (single(headers.accept) ?? "").includes("text/html");
}
