/**
 * The connections routes behind the real request gate and the `web.sidecar`
 * route gate, over a real ConnectionService with a temp ndx home, a fake
 * authorization server and a fake MCP server: every route needs a credential,
 * a sign-in started and finished through them stores tokens and reads
 * connected, and no response carries a token, refresh token or code.
 *
 * The authorization server supports client ID metadata documents and has no
 * registration endpoint (as CAOS's does), so the sign-in uses n-dx's document
 * and the fixed loopback callback, whose page the server serves publicly.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storedCredential } from "@n-dx/llm-client";
import { ConnectionService } from "../../src/server/connections/connection-service.js";
import { CLIENT_METADATA_URL, SCOPES_CHANGED, SIGN_IN_AGAIN } from "../../src/server/connections/oauth-provider.js";
import { handleRequestSecurity, isPublicOnlyRequest, refusePublicOnly } from "../../src/server/request-security.js";
import { enforceRouteFeatureGate } from "../../src/server/route-feature-gates.js";
import { handleConnectionsRoute, signInRedirectUrl, signInRoute } from "../../src/server/routes-connections.js";
import { handleStaticRoute, type StaticAssets } from "../../src/server/routes-static.js";
import type { ServerContext } from "../../src/server/types.js";
import { parseSignInState } from "../../src/shared/index.js";
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

const SHELL = "<!doctype html><title>n-dx shell</title>";
const assets = { getViewerHtml: () => SHELL } as unknown as StaticAssets;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "connections-routes-"));
  ndxHome = mkdtempSync(join(tmpdir(), "connections-routes-home-"));
  fake = await startFakeOAuthMcpServer({ metadataDocuments: true, registration: false, issParameter: true });
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
    if (isPublicOnlyRequest(req)) return handleStaticRoute(req, res, ctx, assets) || refusePublicOnly(req, res);
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

const REDIRECT = () => `${server.baseUrl}/oauth/callback`;

/** Start a sign-in as the dashboard does, and play the user approving it. */
async function approvedSignIn(basePath?: string) {
  const started = await post("/api/connections/docs/oauth/start", { redirectUrl: REDIRECT(), ...(basePath !== undefined && { basePath }) });
  expect(started.status).toBe(200);
  const { authorizationUrl } = await started.json();
  return { authorizationUrl: new URL(authorizationUrl), ...fake.approve(authorizationUrl) };
}

describe("connections routes", () => {
  it("refuse every request without the per-user token or a session", async () => {
    expect((await fetch(`${server.baseUrl}/api/connections`)).status).toBe(401);
    for (const action of ["oauth/start", "oauth/finish", "sign-out"]) {
      expect((await post(`/api/connections/docs/${action}`, {}, {})).status, action).toBe(401);
    }
    // A wrong token is no credential either.
    expect((await fetch(`${server.baseUrl}/api/connections`, { headers: { "X-Ndx-Token": "nope" } })).status).toBe(401);
  });

  it("answer the tracker's label from the profile of the connection that maps a tracker, or null", async () => {
    const label = async () => (await (await fetch(`${server.baseUrl}/api/connections/tracker`, { headers: auth })).json()).label;
    expect(await label()).toBeNull();

    await service.close();
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({
      connections: { plain: { transport: "http", url: fake.mcp.url, auth: "none", profile: "caos" } },
    }));
    service = new ConnectionService({ projectDir: root, credentials: { ndxHome }, warn: () => {} });
    expect(await label()).toBe("CAOS");
    // Read from config: naming a link connects nothing, so a page view never spawns or waits on a server.
    expect(service.connection("plain")?.status).toEqual({ state: "unavailable", reason: "not connected yet" });
    expect((await fetch(`${server.baseUrl}/api/connections/tracker`, { method: "POST", headers: auth })).status).toBe(405);
    expect((await fetch(`${server.baseUrl}/api/connections/tracker`)).status).toBe(401);
  });

  it("are off with web.sidecar", async () => {
    writeConfig(false);
    const res = await fetch(`${server.baseUrl}/api/connections`, { headers: auth });
    expect(res.status).toBe(403);
    expect((await post("/api/connections/docs/oauth/start", { redirectUrl: REDIRECT() })).status).toBe(403);
  });

  it("start then finish stores tokens and reads connected, and no response carries a secret", async () => {
    const before = await (await fetch(`${server.baseUrl}/api/connections`, { headers: auth })).json();
    expect(before.connections[0]).toMatchObject({ id: "docs", state: "needs-sign-in", signIn: "first" });
    expect(before.configFile).toBe(".n-dx.local.json");

    const { authorizationUrl, code, state, iss } = await approvedSignIn("/p/alpha/w/feature");
    // n-dx's metadata document is the client; nothing registers.
    expect(authorizationUrl.searchParams.get("client_id")).toBe(CLIENT_METADATA_URL);
    expect(REDIRECT()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(REDIRECT());
    expect(fake.hits["/register"]).toBeUndefined();
    expect(parseSignInState(state)).toMatchObject({ project: "alpha", workspace: "feature", connection: "docs" });

    // The authorization server sends the browser to the callback: the public page shell.
    const callbackUrl = new URL(REDIRECT());
    callbackUrl.search = new URLSearchParams({ code, state, ...(iss && { iss }) }).toString();
    const page = await fetch(callbackUrl);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(SHELL);

    // The page posts what it read, with its session.
    const finished = await post("/api/connections/docs/oauth/finish", { code, state, iss });
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
    const replay = await post("/api/connections/docs/oauth/finish", { code, state, iss });
    expect(replay.status).toBe(400);
    expect(await replay.text()).not.toContain(code);

    const out = await post("/api/connections/docs/sign-out", {});
    expect(out.status).toBe(200);
    expect((await out.json()).connection).toMatchObject({ state: "needs-sign-in", signIn: "first" });
    expect(storedCredential("connection:docs", { ndxHome })).toBeUndefined();
  });

  it("reads 'sign in again' once the refresh token is revoked", async () => {
    const { code, state, iss } = await approvedSignIn();
    expect((await post("/api/connections/docs/oauth/finish", { code, state, iss })).status).toBe(200);
    fake.revokeRefreshTokens();
    fake.expireAccessTokens();
    await service.close();
    service = new ConnectionService({ projectDir: root, credentials: { ndxHome }, warn: () => {} });
    const docs = (await (await fetch(`${server.baseUrl}/api/connections`, { headers: auth })).json()).connections[0];
    expect(docs).toMatchObject({ state: "needs-sign-in", reason: SIGN_IN_AGAIN, signIn: "again" });
  });

  it("refuses a sign-in for an unknown or non-OAuth connection, and a redirect off loopback", async () => {
    expect((await post("/api/connections/nope/oauth/start", { redirectUrl: REDIRECT() })).status).toBe(404);
    expect((await post("/api/connections/plain/oauth/start", { redirectUrl: REDIRECT() })).status).toBe(400);
    expect((await post("/api/connections/docs/oauth/start", { redirectUrl: "https://example.com/oauth/callback" })).status).toBe(400);
    expect((await post("/api/connections/docs/oauth/start", { redirectUrl: REDIRECT(), basePath: "/p/a/extra" })).status).toBe(400);
    expect((await post("/api/connections/docs/oauth/finish", { code: "c" })).status).toBe(400);
    expect((await post("/api/connections/docs/oauth/finish", { code: "c", state: "s", iss: 7 })).status).toBe(400);
    expect((await fetch(`${server.baseUrl}/api/connections/docs/sign-out`, { headers: auth })).status).toBe(405);
  });

  it("reads 'sign in again' once a sync rule turned on needs write scopes the sign-in lacks", async () => {
    await service.close();
    const never = { policy: "never" };
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({
      connections: {
        docs: {
          transport: "http", url: fake.url, auth: "oauth", label: "Docs", profile: "caos",
          tools: { create_work_item: never, edit_work_item: never, move_work_item: never },
        },
      },
      trackerSync: { project: "demo", connection: "docs" },
    }));
    service = new ConnectionService({ projectDir: root, credentials: { ndxHome }, warn: () => {} });
    const { code, state, iss } = await approvedSignIn();
    expect((await post("/api/connections/docs/oauth/finish", { code, state, iss })).status).toBe(200);

    const put = await fetch(`${server.baseUrl}/api/connections/sync`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ rules: { "pr-opened": "on" } }),
    });
    expect(put.status).toBe(200);
    const docs = (await (await fetch(`${server.baseUrl}/api/connections`, { headers: auth })).json()).connections[0];
    expect(docs).toMatchObject({ state: "needs-sign-in", reason: SCOPES_CHANGED, signIn: "again" });
  });

  it("refuses a mismatched iss and stores nothing", async () => {
    const { code, state } = await approvedSignIn();
    const refused = await post("/api/connections/docs/oauth/finish", { code, state, iss: "https://evil.example" });
    expect(refused.status).toBe(400);
    expect(await refused.text()).not.toContain(code);
    expect(storedCredential("connection:docs", { ndxHome })).toBeUndefined();
    expect(fake.grants).toEqual([]);
  });
});

describe("signInRedirectUrl", () => {
  it("accepts the fixed loopback callback only, on any port", () => {
    expect(signInRedirectUrl("http://127.0.0.1:3117/oauth/callback")).toBeInstanceOf(URL);
    expect(signInRedirectUrl("http://localhost:49152/oauth/callback")).toBeInstanceOf(URL);
    for (const refused of [
      "http://[::1]:3117/oauth/callback",
      "https://127.0.0.1:3117/oauth/callback",
      "http://127.0.0.1:3117/p/a/oauth/callback",
      "http://127.0.0.1:3117/oauth/callback?connection=docs",
      "http://127.0.0.1:3117/project",
      "http://evil.example/oauth/callback",
      "http://u:p@127.0.0.1/oauth/callback",
      "javascript:alert(1)",
      42,
    ]) {
      expect(typeof signInRedirectUrl(refused), String(refused)).toBe("string");
    }
  });
});

describe("signInRoute", () => {
  it("reads the project and workspace from the dashboard's base path", () => {
    expect(signInRoute(undefined)).toEqual({});
    expect(signInRoute("")).toEqual({});
    expect(signInRoute("/p/app")).toEqual({ project: "app" });
    expect(signInRoute("/w/feature")).toEqual({ workspace: "feature" });
    expect(signInRoute("/p/app/w/feature")).toEqual({ project: "app", workspace: "feature" });
    expect(typeof signInRoute("/p/app/project")).toBe("string");
    expect(typeof signInRoute(7)).toBe("string");
  });
});
