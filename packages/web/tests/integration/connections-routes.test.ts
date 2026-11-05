/**
 * The connections routes behind the real request gate and the `web.sidecar`
 * route gate, over a real ConnectionService with a temp ndx home, a fake
 * authorization server and a fake MCP server: every route needs a credential,
 * a sign-in started and finished through them stores tokens and reads
 * connected, and no response carries a token, refresh token or code.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storedCredential } from "@n-dx/llm-client";
import { ConnectionService } from "../../src/server/connections/connection-service.js";
import { SIGN_IN_AGAIN } from "../../src/server/connections/oauth-provider.js";
import { handleRequestSecurity, isPublicOnlyRequest, refusePublicOnly } from "../../src/server/request-security.js";
import { enforceRouteFeatureGate } from "../../src/server/route-feature-gates.js";
import { handleConnectionsRoute, signInRedirectUrl } from "../../src/server/routes-connections.js";
import type { ServerContext } from "../../src/server/types.js";
import { startFakeOAuthMcpServer, type FakeOAuthMcpServer } from "../helpers/fake-oauth-mcp-server.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";

const TOKEN = "dashboard-token-0123456789abcdef";
const auth = { "X-Ndx-Token": TOKEN };

let root: string;
let ndxHome: string;
let server: RouteTestServer;
let fake: FakeOAuthMcpServer;
let service: ConnectionService;

function writeConfig(sidecar: boolean): void {
  writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ features: { web: { sidecar } } }));
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "connections-routes-"));
  ndxHome = mkdtempSync(join(tmpdir(), "connections-routes-home-"));
  fake = await startFakeOAuthMcpServer();
  writeConfig(true);
  writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({
    connections: {
      docs: { transport: "http", url: fake.url, auth: "oauth", label: "Docs" },
      plain: { transport: "http", url: fake.mcp.url, auth: "none" },
    },
  }));
  service = new ConnectionService({ projectDir: root, credentials: { ndxHome }, warn: () => {} });
  const ctx: ServerContext = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  server = await startRouteTestServer(async (req, res) => {
    if (handleRequestSecurity(req, res, { token: TOKEN })) return true;
    // As start.ts: a request without a credential gets the page shell or nothing.
    if (isPublicOnlyRequest(req)) return refusePublicOnly(req, res);
    if (enforceRouteFeatureGate(req, res, ctx)) return true;
    return handleConnectionsRoute(req, res, ctx, { connectionsFor: () => service });
  });
});

afterEach(async () => {
  await service?.close();
  await server?.close();
  await fake.close();
  await removeTestDir(root);
  await removeTestDir(ndxHome);
});

const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  fetch(`${server.baseUrl}${path}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });

const REDIRECT = () => `${server.baseUrl}/p/alpha/project?connection=docs`;

describe("connections routes", () => {
  it("refuse every request without the per-user token or a session", async () => {
    expect((await fetch(`${server.baseUrl}/api/connections`)).status).toBe(401);
    for (const action of ["oauth/start", "oauth/finish", "sign-out"]) {
      expect((await post(`/api/connections/docs/${action}`, {}, {})).status, action).toBe(401);
    }
    // A wrong token is no credential either.
    expect((await fetch(`${server.baseUrl}/api/connections`, { headers: { "X-Ndx-Token": "nope" } })).status).toBe(401);
  });

  it("are off with web.sidecar", async () => {
    writeConfig(false);
    const res = await fetch(`${server.baseUrl}/api/connections`, { headers: auth });
    expect(res.status).toBe(403);
    expect((await post("/api/connections/docs/oauth/start", { redirectUrl: REDIRECT() })).status).toBe(403);
  });

  it("start then finish stores tokens and reads connected, and no response carries a secret", async () => {
    const before = await (await fetch(`${server.baseUrl}/api/connections`, { headers: auth })).json();
    expect(before.connections[0]).toMatchObject({ id: "docs", state: "needs-sign-in" });
    expect(before.configFile).toBe(".n-dx.local.json");

    const started = await post("/api/connections/docs/oauth/start", { redirectUrl: REDIRECT() });
    expect(started.status).toBe(200);
    const { authorizationUrl } = await started.json();
    expect(new URL(authorizationUrl).searchParams.get("redirect_uri")).toBe(REDIRECT());
    const { code, state } = fake.approve(authorizationUrl);

    const finished = await post("/api/connections/docs/oauth/finish", { code, state });
    const finishedText = await finished.text();
    expect(finished.status, finishedText).toBe(200);
    expect(JSON.parse(finishedText).connection).toMatchObject({ id: "docs", label: "Docs", state: "connected" });
    expect(storedCredential("connection:docs", { ndxHome })?.value).toContain("access_token");

    const listed = await fetch(`${server.baseUrl}/api/connections`, { headers: auth });
    const text = await listed.text();
    const docs = JSON.parse(text).connections[0];
    expect(docs).toEqual({ id: "docs", label: "Docs", transport: "http", auth: "oauth", state: "connected", tools: docs.tools });
    expect(docs.tools).toBeGreaterThan(0);
    expect(fake.issued.length).toBeGreaterThan(0);
    for (const secret of [...fake.issued, code]) {
      expect(text).not.toContain(secret);
      expect(finishedText).not.toContain(secret);
    }

    // The state is spent: a replay is refused, naming no secret.
    const replay = await post("/api/connections/docs/oauth/finish", { code, state });
    expect(replay.status).toBe(400);
    expect(await replay.text()).not.toContain(code);

    const out = await post("/api/connections/docs/sign-out", {});
    expect(out.status).toBe(200);
    expect((await out.json()).connection).toMatchObject({ state: "needs-sign-in" });
    expect(storedCredential("connection:docs", { ndxHome })).toBeUndefined();
  });

  it("reads 'sign in again' once the refresh token is revoked", async () => {
    const { code, state } = fake.approve(await (await post("/api/connections/docs/oauth/start", { redirectUrl: REDIRECT() })).json().then((b) => b.authorizationUrl));
    expect((await post("/api/connections/docs/oauth/finish", { code, state })).status).toBe(200);
    fake.revokeRefreshTokens();
    fake.expireAccessTokens();
    await service.close();
    service = new ConnectionService({ projectDir: root, credentials: { ndxHome }, warn: () => {} });
    const docs = (await (await fetch(`${server.baseUrl}/api/connections`, { headers: auth })).json()).connections[0];
    expect(docs).toMatchObject({ state: "needs-sign-in", reason: SIGN_IN_AGAIN });
  });

  it("refuses a sign-in for an unknown or non-OAuth connection, and a redirect off loopback", async () => {
    expect((await post("/api/connections/nope/oauth/start", { redirectUrl: REDIRECT() })).status).toBe(404);
    expect((await post("/api/connections/plain/oauth/start", { redirectUrl: REDIRECT() })).status).toBe(400);
    expect((await post("/api/connections/docs/oauth/start", { redirectUrl: "https://example.com/project" })).status).toBe(400);
    expect((await post("/api/connections/docs/oauth/finish", { code: "c" })).status).toBe(400);
    expect((await fetch(`${server.baseUrl}/api/connections/docs/sign-out`, { headers: auth })).status).toBe(405);
  });
});

describe("signInRedirectUrl", () => {
  it("accepts a loopback dashboard address only", () => {
    expect(signInRedirectUrl("http://127.0.0.1:3117/p/a/project?connection=docs")).toBeInstanceOf(URL);
    expect(signInRedirectUrl("http://localhost:3117/project")).toBeInstanceOf(URL);
    expect(signInRedirectUrl("http://[::1]:3117/project")).toBeInstanceOf(URL);
    expect(typeof signInRedirectUrl("http://evil.example/project")).toBe("string");
    expect(typeof signInRedirectUrl("javascript:alert(1)")).toBe("string");
    expect(typeof signInRedirectUrl("http://u:p@127.0.0.1/project")).toBe("string");
    expect(typeof signInRedirectUrl(42)).toBe("string");
  });
});
