/**
 * The fake MCP server (fake-mcp-http-server.ts) behind a fake OAuth 2.1
 * authorization server on the same 127.0.0.1 origin, for the connection OAuth
 * tests: protected-resource and authorization-server metadata, dynamic client
 * registration and/or client ID metadata documents and pre-registered
 * clients, authorization code with S256 PKCE, the `iss` response parameter,
 * and rotating refresh tokens. The MCP endpoint answers 401 to anything but a
 * live access token.
 *
 * No browser is involved: {@link FakeOAuthMcpServer.approve} plays the user
 * approving the authorization URL and returns what the redirect would carry.
 */

import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readAll, startFakeMcpHttpServer, type FakeMcpHttpServer } from "./fake-mcp-http-server.js";

export interface FakeOAuthMcpServer {
  /** The MCP endpoint, and what reached it. */
  mcp: FakeMcpHttpServer;
  url: string;
  /** Requests to each authorization-server route, by path. */
  hits: Record<string, number>;
  /** Every token request's grant type, in order. */
  grants: string[];
  /** Every access token, refresh token and code issued, for leak checks. */
  issued: string[];
  /** Lifetime given to new access tokens, in seconds. */
  expiresIn: number;
  /** The authorization server's issuer, as its metadata states it. */
  issuer: string;
  /** Every authorization URL approved, in order. */
  authorizations: URL[];
  /** Play the user approving `authorizationUrl`: the code, state and (when the server sends it) iss its redirect carries. */
  approve(authorizationUrl: string): { code: string; state: string; iss?: string };
  /** Every access token issued so far now answers 401. */
  expireAccessTokens(): void;
  /** Every refresh token issued so far is now refused with invalid_grant. */
  revokeRefreshTokens(): void;
  close(): Promise<void>;
}

const token = (prefix: string) => `${prefix}-${randomBytes(12).toString("hex")}`;
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function json(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  return true;
}

export interface FakeOAuthOptions {
  /** Advertise and accept client ID metadata documents (an HTTPS client_id). Default false. */
  metadataDocuments?: boolean;
  /** Offer dynamic client registration. Default true. */
  registration?: boolean;
  /** Client ids registered beforehand. */
  preRegistered?: string[];
  /** Send `iss` with the code and advertise authorization_response_iss_parameter_supported. Default false. */
  issParameter?: boolean;
  /** The authorization server's scopes_supported; unset advertises none. */
  scopesSupported?: string[];
}

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

export async function startFakeOAuthMcpServer(options: FakeOAuthOptions = {}): Promise<FakeOAuthMcpServer> {
  const accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  const codes = new Map<string, { challenge: string; clientId: string; redirectUri: string }>();
  const clients = new Set<string>(options.preRegistered ?? []);
  const knownClient = (clientId: string) => clients.has(clientId) || (options.metadataDocuments === true && isHttpsUrl(clientId));
  let base = "";

  const issue = (res: ServerResponse) => {
    const access = token("at");
    const refresh = token("rt");
    accessTokens.add(access);
    refreshTokens.add(refresh);
    fake.issued.push(access, refresh);
    return json(res, 200, { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: fake.expiresIn });
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url ?? "/", base).pathname;
    if (path !== "/mcp") fake.hits[path] = (fake.hits[path] ?? 0) + 1;
    if (path.startsWith("/.well-known/oauth-protected-resource")) {
      return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    }
    if (path === "/.well-known/oauth-authorization-server") {
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        ...(options.registration !== false && { registration_endpoint: `${base}/register` }),
        ...(options.metadataDocuments && { client_id_metadata_document_supported: true }),
        ...(options.issParameter && { authorization_response_iss_parameter_supported: true }),
        ...(options.scopesSupported && { scopes_supported: options.scopesSupported }),
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (path === "/register" && req.method === "POST" && options.registration !== false) {
      const metadata = JSON.parse(await readAll(req)) as Record<string, unknown>;
      const clientId = token("client");
      clients.add(clientId);
      return json(res, 201, { ...metadata, client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000) });
    }
    if (path === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await readAll(req));
      const grant = form.get("grant_type") ?? "";
      fake.grants.push(grant);
      if (!knownClient(form.get("client_id") ?? "")) return json(res, 401, { error: "invalid_client" });
      if (grant === "authorization_code") {
        const code = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        if (!code || code.clientId !== form.get("client_id") || code.redirectUri !== form.get("redirect_uri")) {
          return json(res, 400, { error: "invalid_grant" });
        }
        if (s256(form.get("code_verifier") ?? "") !== code.challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE check failed" });
        return issue(res);
      }
      if (grant === "refresh_token") {
        const refresh = form.get("refresh_token") ?? "";
        if (!refreshTokens.delete(refresh)) return json(res, 400, { error: "invalid_grant" });
        return issue(res);
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (path === "/mcp") {
      const bearer = req.headers.authorization?.replace(/^Bearer /, "");
      if (bearer && accessTokens.has(bearer)) return false;
      fake.mcp.authorizations.push(req.headers.authorization);
      res.writeHead(401, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` }).end();
      return true;
    }
    res.writeHead(404).end();
    return true;
  };

  const mcp = await startFakeMcpHttpServer({ route });
  base = new URL(mcp.url).origin;
  const fake: FakeOAuthMcpServer = {
    mcp,
    url: mcp.url,
    hits: {},
    grants: [],
    issued: [],
    expiresIn: 3600,
    issuer: base,
    authorizations: [],
    approve(authorizationUrl) {
      const url = new URL(authorizationUrl);
      const state = url.searchParams.get("state");
      const challenge = url.searchParams.get("code_challenge");
      const clientId = url.searchParams.get("client_id") ?? "";
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      if (url.searchParams.get("code_challenge_method") !== "S256" || !challenge || !state || !knownClient(clientId)) {
        throw new Error(`the fake authorization server would refuse ${authorizationUrl}`);
      }
      fake.authorizations.push(url);
      const code = token("code");
      codes.set(code, { challenge, clientId, redirectUri });
      fake.issued.push(code);
      return { code, state, ...(options.issParameter && { iss: base }) };
    },
    expireAccessTokens: () => accessTokens.clear(),
    revokeRefreshTokens: () => refreshTokens.clear(),
    close: () => mcp.close(),
  };
  return fake;
}
