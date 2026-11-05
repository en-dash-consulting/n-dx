/**
 * MCP OAuth for `auth: "oauth"` connections, on the SDK's own flow
 * (`auth()` in @modelcontextprotocol/sdk/client/auth.js): protected-resource
 * and authorization-server discovery, authorization code + PKCE (S256) and
 * refresh.
 *
 * The client n-dx signs in as: its client ID metadata document,
 * {@link CLIENT_METADATA_URL}, used as the client_id wherever the
 * authorization server advertises `client_id_metadata_document_supported`,
 * else dynamic client registration. A connection's `oauth` config overrides
 * it with another document or a pre-registered client id.
 *
 * What persists is one JSON record in the credential store entry
 * `connection:<id>` (connection-credentials.ts): the client, the tokens, and
 * the URL, client identity and scopes they were issued for. A record issued
 * for another URL or identity, or for fewer scopes than the connection needs
 * now, is never used; the connection reads needs-sign-in. A sign-in's state
 * and code verifier live in memory only, single-use, for {@link SIGN_IN_TTL_MS}.
 *
 * The server never opens a browser. A sign-in is started by the dashboard
 * ({@link ConnectionOAuth.beginSignIn}) and finished by the fixed loopback
 * callback's page ({@link ConnectionOAuth.finishSignIn}); the state carries
 * the project, workspace and connection the return belongs to
 * (shared/oauth-callback.ts). Every other caller is headless and gets
 * needs-sign-in where a user would be asked.
 *
 * See docs/architecture/sidecar-connections.md.
 */

import { randomBytes } from "node:crypto";
import {
  auth,
  discoverOAuthServerInfo,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { CredentialStoreOptions } from "@n-dx/llm-client";
import { formatSignInState, type SignInState } from "../../shared/index.js";
import { errorMessage } from "../response-utils.js";
import type { HttpConnectionConfig } from "./connection-config.js";
import {
  connectionCredentialRecord,
  setConnectionCredentialRecord,
  unsetConnectionCredential,
  withoutConnectionToken,
} from "./connection-credentials.js";

/**
 * n-dx's client ID metadata document. Its redirect_uris are the loopback
 * callbacks, http://127.0.0.1/oauth/callback and http://localhost/oauth/callback,
 * on any port (RFC 8252).
 */
export const CLIENT_METADATA_URL = "https://docs.n-dx.dev/oauth/client.json";

/** How long a started sign-in can be finished. */
export const SIGN_IN_TTL_MS = 10 * 60_000;
/** An access token this close to its expiry is refreshed before it is sent. */
export const REFRESH_SKEW_MS = 30_000;

export const NOT_SIGNED_IN = "not signed in yet; sign in from the dashboard";
export const SIGN_IN_AGAIN = "the sign-in expired or was revoked; sign in again";
export const URL_CHANGED = "the connection's URL changed since sign-in; sign in again";
export const CLIENT_CHANGED = "the connection's OAuth client changed since sign-in; sign in again";
export const SCOPES_CHANGED = "the connection needs scopes it was not signed in with; sign in again";

/**
 * Whether a connection needs its first sign-in or lost one it had. The
 * dashboard words its badge from this, never from the reason text.
 */
export type SignInKind = "first" | "again";

/** Why a connection needs a sign-in: the text for the operator and the kind the badge reads. */
export interface SignInNeeded {
  reason: string;
  signIn: SignInKind;
}

/** The sign-in a connection had is gone: expired, revoked or refused. */
export const SIGN_IN_LOST: SignInNeeded = { reason: SIGN_IN_AGAIN, signIn: "again" };

/** A headless caller reached the point where a user would have to sign in. */
export class ConnectionSignInRequiredError extends Error {
  constructor(readonly reason: string, readonly signIn: SignInKind) {
    super(`sign-in required: ${reason}`);
    this.name = "ConnectionSignInRequiredError";
  }
}

/** A refresh failed for a reason other than a refused refresh token; the tokens are kept. */
export class ConnectionRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionRefreshError";
  }
}

/** {@link ConnectionOAuth.finishSignIn} refused the redirect; nothing was stored. */
export class ConnectionSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionSignInError";
  }
}

/** The JSON record kept in `connection:<id>`. */
interface OAuthRecord {
  kind: "oauth";
  /** The connection URL the client and tokens were issued for. */
  url: string;
  /** The redirect URL the client was registered with. */
  redirectUrl: string;
  /** The client identity ({@link clientIdentity}) it was issued to; unset on older records, read as the default. */
  identity?: string;
  /** The scopes the connection needed when it signed in; unset when it needed none. */
  scopes?: string[];
  client: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  /** When the access token expires, in ms, when the server said. */
  expiresAt?: number;
}

/** A started sign-in, held in memory until finished or expired. */
interface SignInFlow {
  connection: string;
  url: string;
  redirectUrl: string;
  identity: string;
  /** The scopes the connection needed when the sign-in started. */
  scopes: string[];
  state: string;
  expiresAt: number;
  client?: OAuthClientInformationMixed;
  /** Set when the server rejected the stored client, so it is not offered again. */
  ignoreStoredClient?: boolean;
  codeVerifier?: string;
  discovery?: OAuthDiscoveryState;
  authorizationUrl?: URL;
}

export interface ConnectionOAuthOptions {
  /** Credential store options, e.g. a temp ndx home (tests). */
  credentials?: CredentialStoreOptions;
  /** The clock, in ms (tests). */
  now?: () => number;
  /** The scopes a connection's sign-in needs (tracker/oauth-scopes.ts); none when unset. */
  scopesFor?: (config: HttpConnectionConfig) => string[];
}

/** Where a sign-in's return belongs: the routing fields of its state. */
export type SignInRoute = Pick<SignInState, "project" | "workspace">;

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** A provider and the fetch its transport must use, so a refused refresh token is noted. */
export type PreparedOAuth = { provider: OAuthClientProvider; fetch: FetchLike } | { needsSignIn: SignInNeeded };

function isRecord(value: Record<string, unknown> | undefined): value is Record<string, unknown> & OAuthRecord {
  const client = value?.client as { client_id?: unknown } | undefined;
  return value?.kind === "oauth"
    && typeof value.url === "string"
    && typeof value.redirectUrl === "string"
    && typeof client?.client_id === "string";
}

/** Which client `config` signs in as, as a record stores it: a change means signing in again. */
export function clientIdentity(config: Pick<HttpConnectionConfig, "oauth">): string {
  if (config.oauth && "clientId" in config.oauth) return `client-id ${config.oauth.clientId}`;
  return `metadata-document ${config.oauth?.clientMetadataUrl ?? CLIENT_METADATA_URL}`;
}

/** The identity a record was issued to: one from before identities were recorded was the default. */
const recordIdentity = (record: OAuthRecord): string => record.identity ?? clientIdentity({});

function clientMetadataFor(redirectUrl: string): OAuthClientMetadata {
  return {
    client_name: "n-dx",
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export class ConnectionOAuth {
  readonly credentials: CredentialStoreOptions;
  private readonly now: () => number;
  private readonly scopesFor: (config: HttpConnectionConfig) => string[];
  private readonly flows = new Map<string, SignInFlow>();
  private readonly refreshing = new Map<string, Promise<PreparedOAuth>>();
  /**
   * Refresh tokens the authorization server refused, per connection, in
   * memory. Concurrent requests share one provider, so a refused refresh can
   * mean a sibling rotated the token first; the tokens are cleared only when
   * the one stored now is itself refused.
   */
  private readonly refused = new Map<string, Set<string>>();

  constructor(options: ConnectionOAuthOptions = {}) {
    this.credentials = options.credentials ?? {};
    this.now = options.now ?? Date.now;
    this.scopesFor = options.scopesFor ?? (() => []);
  }

  /**
   * The provider a headless connect uses, refreshing an expired access token
   * first, or why the connection needs a sign-in. Never asks anyone anything:
   * where a user would sign in, it reads needs-sign-in.
   */
  async prepare(config: HttpConnectionConfig): Promise<PreparedOAuth> {
    const record = this.storedRecord(config.id);
    const blocked = this.signInReason(config, record);
    if (blocked) return { needsSignIn: blocked };
    if (!this.expired(record!)) return this.headless(config, record!);
    let refresh = this.refreshing.get(config.id);
    if (!refresh) {
      refresh = this.refresh(config).finally(() => this.refreshing.delete(config.id));
      this.refreshing.set(config.id, refresh);
    }
    return refresh;
  }

  /**
   * Start a sign-in: the authorization URL to send the user to, with S256
   * PKCE and a state that carries `route` and the connection. The scopes the
   * connection needs are asked for when the server lists them.
   */
  async beginSignIn(config: HttpConnectionConfig, redirectUrl: string, route: SignInRoute = {}): Promise<string> {
    const redirect = new URL(redirectUrl);
    if (redirect.protocol !== "http:" && redirect.protocol !== "https:") throw new Error("the redirect URL must be http or https");
    this.sweep();
    const scopes = this.scopesFor(config);
    const flow: SignInFlow = {
      connection: config.id,
      url: config.url,
      redirectUrl: redirect.href,
      identity: clientIdentity(config),
      scopes,
      state: formatSignInState({ ...route, connection: config.id, nonce: randomBytes(32).toString("base64url") }),
      expiresAt: this.now() + SIGN_IN_TTL_MS,
    };
    // Discovered here rather than by auth(), to choose the scopes; auth() reuses it.
    const info = await discoverOAuthServerInfo(config.url);
    flow.discovery = { ...info, authorizationServerUrl: String(info.authorizationServerUrl) };
    const supported = info.resourceMetadata?.scopes_supported ?? info.authorizationServerMetadata?.scopes_supported;
    const requested = supported ? scopes.filter((scope) => supported.includes(scope)) : [];
    const result = await auth(new SignInProvider(this, config, flow), {
      serverUrl: config.url,
      ...(requested.length > 0 && { scope: requested.join(" ") }),
    });
    if (result !== "REDIRECT" || !flow.authorizationUrl || !flow.codeVerifier) {
      throw new Error("the authorization server did not start a sign-in");
    }
    this.flows.set(flow.state, flow);
    return flow.authorizationUrl.href;
  }

  /**
   * Finish a sign-in with the callback's `code`, `state` and `iss`. A state
   * that is unknown, already used, expired or for another connection, and an
   * `iss` that is not the authorization server's issuer (or is missing where
   * the server promises one, RFC 9207), are refused and nothing is stored; a
   * state is spent by its first use either way.
   */
  async finishSignIn(config: HttpConnectionConfig, code: string, state: string, iss?: string): Promise<void> {
    const flow = this.flows.get(state);
    this.flows.delete(state);
    if (!flow || flow.connection !== config.id || this.now() > flow.expiresAt) {
      throw new ConnectionSignInError("this sign-in is unknown, already used or expired; start it again");
    }
    if (flow.url !== config.url) throw new ConnectionSignInError("the connection's URL changed during sign-in; start it again");
    if (flow.identity !== clientIdentity(config)) {
      throw new ConnectionSignInError("the connection's OAuth client changed during sign-in; start it again");
    }
    const metadata = flow.discovery?.authorizationServerMetadata as (Record<string, unknown> & { issuer?: string }) | undefined;
    if (iss === undefined ? metadata?.authorization_response_iss_parameter_supported === true : iss !== metadata?.issuer) {
      throw new ConnectionSignInError("the sign-in did not come back from the connection's authorization server; start it again");
    }
    let result: string;
    try {
      result = await auth(new SignInProvider(this, config, flow), { serverUrl: config.url, authorizationCode: code });
    } catch (err) {
      // The server's message can echo what it was sent.
      const message = withoutConnectionToken(config.id, errorMessage(err), this.credentials).split(code).join("[code]");
      throw new ConnectionSignInError(`the authorization server refused the sign-in: ${message}`);
    }
    if (result !== "AUTHORIZED") throw new ConnectionSignInError("the authorization server did not issue tokens");
  }

  /** Forget the connection's client registration and tokens, and any sign-in in progress. */
  signOut(config: HttpConnectionConfig): void {
    for (const [state, flow] of this.flows) if (flow.connection === config.id) this.flows.delete(state);
    this.refused.delete(config.id);
    unsetConnectionCredential(config.id, this.credentials);
  }

  /** Drop the connection's tokens, keeping its client registration: the next use reads "sign in again". */
  forgetTokens(id: string): void {
    this.refused.delete(id);
    const record = this.storedRecord(id);
    if (record?.tokens) this.write(id, { ...record, tokens: undefined, expiresAt: undefined });
  }

  /**
   * Drop the tokens only when the stored refresh token is one the server
   * refused, not one a concurrent refresh has since rotated in; whether it did.
   */
  forgetRefusedTokens(id: string): boolean {
    const stored = this.storedRecord(id)?.tokens?.refresh_token;
    if (!stored || !this.refused.get(id)?.has(stored)) return false;
    this.forgetTokens(id);
    return true;
  }

  /**
   * A fetch for `id`'s transport and refreshes that notes each refresh token
   * the token endpoint refuses (400 or 401), and passes everything through.
   */
  fetchFor(id: string): FetchLike {
    return async (url, init) => {
      const response = await fetch(url, init);
      if ((response.status === 400 || response.status === 401) && (typeof init?.body === "string" || init?.body instanceof URLSearchParams)) {
        const form = new URLSearchParams(init.body.toString());
        const refreshToken = form.get("grant_type") === "refresh_token" ? form.get("refresh_token") : null;
        if (refreshToken) {
          let refused = this.refused.get(id);
          if (!refused) this.refused.set(id, (refused = new Set()));
          refused.add(refreshToken);
        }
      }
      return response;
    };
  }

  private headless(config: HttpConnectionConfig, record: OAuthRecord): Extract<PreparedOAuth, { provider: unknown }> {
    return { provider: new HeadlessProvider(this, config, record.redirectUrl), fetch: this.fetchFor(config.id) };
  }

  /** The stored record for `id`, read fresh, or undefined when there is none (or it is not OAuth). */
  storedRecord(id: string): OAuthRecord | undefined {
    const record = connectionCredentialRecord(id, this.credentials);
    return isRecord(record) ? record : undefined;
  }

  /** The record for `config` when it was issued for the connection's current URL. */
  boundRecord(config: HttpConnectionConfig): OAuthRecord | undefined {
    const record = this.storedRecord(config.id);
    return record?.url === config.url ? record : undefined;
  }

  write(id: string, record: OAuthRecord): void {
    setConnectionCredentialRecord(id, record as unknown as Record<string, unknown>, this.credentials);
  }

  /** `tokens` as stored: with the time the access token expires. */
  withExpiry(record: OAuthRecord, tokens: OAuthTokens): OAuthRecord {
    const expiresAt = typeof tokens.expires_in === "number" ? this.now() + tokens.expires_in * 1000 : undefined;
    return { ...record, tokens, expiresAt };
  }

  /** Why a headless caller cannot use `record` for `config`, or undefined when it can. */
  signInReason(config: HttpConnectionConfig, record: OAuthRecord | undefined): SignInNeeded | undefined {
    if (!record) return { reason: NOT_SIGNED_IN, signIn: "first" };
    if (record.url !== config.url) return { reason: URL_CHANGED, signIn: "again" };
    if (recordIdentity(record) !== clientIdentity(config)) return { reason: CLIENT_CHANGED, signIn: "again" };
    if (!record.tokens) return SIGN_IN_LOST;
    const granted = new Set(record.scopes ?? []);
    if (this.scopesFor(config).some((scope) => !granted.has(scope))) return { reason: SCOPES_CHANGED, signIn: "again" };
    return undefined;
  }

  private expired(record: OAuthRecord): boolean {
    return record.expiresAt !== undefined && this.now() >= record.expiresAt - REFRESH_SKEW_MS;
  }

  /**
   * Refresh `config`'s tokens. Each attempt re-reads the store first, since
   * another process may have rotated them; a failed attempt is retried once.
   * A refused refresh token clears the tokens (the SDK calls
   * invalidateCredentials) and reads "sign in again"; any other failure that
   * survives the retry is thrown, so the connection reads unavailable.
   */
  private async refresh(config: HttpConnectionConfig): Promise<PreparedOAuth> {
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const record = this.storedRecord(config.id);
      const blocked = this.signInReason(config, record);
      if (blocked) return { needsSignIn: blocked };
      const prepared = this.headless(config, record!);
      // Rotated by another process while the first attempt failed.
      if (attempt > 0 && !this.expired(record!)) return prepared;
      try {
        await auth(prepared.provider, { serverUrl: config.url, fetchFn: prepared.fetch });
        return prepared;
      } catch (err) {
        if (err instanceof ConnectionSignInRequiredError) return { needsSignIn: { reason: err.reason, signIn: err.signIn } };
        failure = err;
      }
    }
    if (failure instanceof InvalidGrantError && this.forgetRefusedTokens(config.id)) return { needsSignIn: SIGN_IN_LOST };
    throw new ConnectionRefreshError(`could not refresh the sign-in: ${errorMessage(failure)}`);
  }

  private sweep(): void {
    const now = this.now();
    for (const [state, flow] of this.flows) if (now > flow.expiresAt) this.flows.delete(state);
  }
}

/**
 * The provider for every connect and refresh: reads the store on each call,
 * so a token another process rotated is the one sent, and throws where the
 * SDK would send a user to sign in.
 */
class HeadlessProvider implements OAuthClientProvider {
  constructor(
    private readonly owner: ConnectionOAuth,
    private readonly config: HttpConnectionConfig,
    readonly redirectUrl: string,
  ) {}

  get clientMetadata(): OAuthClientMetadata {
    return clientMetadataFor(this.redirectUrl);
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.owner.boundRecord(this.config)?.client;
  }

  saveClientInformation(client: OAuthClientInformationMixed): void {
    const record = this.owner.boundRecord(this.config);
    if (record) this.owner.write(this.config.id, { ...record, client });
  }

  tokens(): OAuthTokens | undefined {
    return this.owner.boundRecord(this.config)?.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    const record = this.owner.boundRecord(this.config);
    if (record) this.owner.write(this.config.id, this.owner.withExpiry(record, tokens));
  }

  redirectToAuthorization(): never {
    const record = this.owner.boundRecord(this.config);
    // The SDK skips a refresh that failed for a server error and asks for a
    // sign-in; with the refresh token still stored that is a failed refresh,
    // not a revoked sign-in.
    if (record?.tokens?.refresh_token) {
      throw new ConnectionRefreshError("the authorization server did not refresh the sign-in");
    }
    // An access token with no way to refresh it is spent.
    this.owner.forgetTokens(this.config.id);
    const needed = this.owner.signInReason(this.config, this.owner.storedRecord(this.config.id)) ?? SIGN_IN_LOST;
    throw new ConnectionSignInRequiredError(needed.reason, needed.signIn);
  }

  saveCodeVerifier(): void {
    // A headless caller never starts an authorization.
  }

  codeVerifier(): never {
    throw new ConnectionSignInRequiredError(SIGN_IN_LOST.reason, SIGN_IN_LOST.signIn);
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "verifier" || scope === "discovery") return;
    const record = this.owner.boundRecord(this.config);
    if (!record) return;
    // A refused refresh: the SDK retries once with whatever is stored then.
    // A token a concurrent request or another process rotated in is kept and
    // tried; only a stored token the server itself refused is dropped.
    if (scope === "tokens") {
      this.owner.forgetRefusedTokens(this.config.id);
      return;
    }
    // The server rejected the client: its tokens go with it, and a sign-in registers anew.
    unsetConnectionCredential(this.config.id, this.owner.credentials);
  }
}

/** The provider for one sign-in: never offers stored tokens, so the SDK always asks for authorization. */
class SignInProvider implements OAuthClientProvider {
  constructor(
    private readonly owner: ConnectionOAuth,
    private readonly config: HttpConnectionConfig,
    private readonly flow: SignInFlow,
  ) {}

  get redirectUrl(): string {
    return this.flow.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return clientMetadataFor(this.flow.redirectUrl);
  }

  /** The SDK sends it as the client_id where the server supports metadata documents, and registers elsewhere. */
  get clientMetadataUrl(): string | undefined {
    const override = this.config.oauth;
    if (override && "clientId" in override) return undefined;
    return override?.clientMetadataUrl ?? CLIENT_METADATA_URL;
  }

  state(): string {
    return this.flow.state;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const override = this.config.oauth;
    // A pre-registered client is the only one this connection signs in as.
    if (override && "clientId" in override) return this.flow.client ?? { client_id: override.clientId };
    if (this.flow.client || this.flow.ignoreStoredClient) return this.flow.client;
    const record = this.owner.boundRecord(this.config);
    if (!record || recordIdentity(record) !== this.flow.identity) return undefined;
    return record.redirectUrl === this.flow.redirectUrl ? record.client : undefined;
  }

  /** A new registration is kept with the flow and stored only with the tokens it earns. */
  saveClientInformation(client: OAuthClientInformationMixed): void {
    this.flow.client = client;
  }

  tokens(): undefined {
    return undefined;
  }

  saveTokens(tokens: OAuthTokens): void {
    const client = this.clientInformation();
    if (!client) throw new Error("no client registration for this sign-in");
    const record: OAuthRecord = {
      kind: "oauth",
      url: this.flow.url,
      redirectUrl: this.flow.redirectUrl,
      identity: this.flow.identity,
      ...(this.flow.scopes.length > 0 && { scopes: this.flow.scopes }),
      client,
    };
    this.owner.write(this.config.id, this.owner.withExpiry(record, tokens));
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.flow.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.flow.codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.flow.codeVerifier) throw new ConnectionSignInError("this sign-in has no code verifier; start it again");
    return this.flow.codeVerifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.flow.discovery = state;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.flow.discovery;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "all" || scope === "client") {
      this.flow.client = undefined;
      this.flow.ignoreStoredClient = true;
    }
    if (scope === "all" || scope === "discovery") this.flow.discovery = undefined;
  }
}
