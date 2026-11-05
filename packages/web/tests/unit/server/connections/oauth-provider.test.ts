/**
 * OAuth connections against a fake authorization server and fake MCP server
 * (tests/helpers/fake-oauth-mcp-server.ts), with a temp ndx home: sign-in with
 * S256 PKCE, state handling, silent refresh, revocation, URL binding, and that
 * no token or code escapes the credential store.
 */

import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storedCredential } from "@n-dx/llm-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionService,
  ConnectionUnavailableError,
} from "../../../../src/server/connections/connection-service.js";
import { ConnectionSignInError, NOT_SIGNED_IN, SIGN_IN_TTL_MS, URL_CHANGED } from "../../../../src/server/connections/oauth-provider.js";
import { startFakeOAuthMcpServer, type FakeOAuthMcpServer } from "../../../helpers/fake-oauth-mcp-server.js";
import { removeTempDir } from "../../../helpers/temp-dir.js";

const REDIRECT = "http://127.0.0.1:3117/connections/oauth/callback";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => removeTempDir(dir));
  return dir;
}

async function oauthServer(): Promise<FakeOAuthMcpServer> {
  const server = await startFakeOAuthMcpServer();
  cleanups.push(() => server.close());
  return server;
}

interface Setup {
  svc: ConnectionService;
  projectDir: string;
  ndxHome: string;
  warnings: string[];
  clock: { now: number };
}

/** A service over one `docs` OAuth connection to `url`, sharing `ndxHome` when given (another process). */
function service(url: string, shared?: { ndxHome: string; clock: { now: number } }): Setup {
  const projectDir = tempDir("ndx-oauth-project-");
  const ndxHome = shared?.ndxHome ?? tempDir("ndx-oauth-home-");
  const clock = shared?.clock ?? { now: 1_700_000_000_000 };
  writeFileSync(join(projectDir, ".n-dx.local.json"), JSON.stringify({ connections: { docs: { transport: "http", url, auth: "oauth" } } }));
  const warnings: string[] = [];
  const svc = new ConnectionService({
    projectDir,
    credentials: { ndxHome },
    warn: (message) => warnings.push(message),
    now: () => clock.now,
  });
  cleanups.push(() => svc.close());
  return { svc, projectDir, ndxHome, warnings, clock };
}

/** The OAuth record in connection:docs, parsed. */
function stored(ndxHome: string): Record<string, any> | undefined {
  const value = storedCredential("connection:docs", { ndxHome })?.value;
  return value ? JSON.parse(value) : undefined;
}

async function signIn(svc: ConnectionService, fake: FakeOAuthMcpServer) {
  const { code, state } = fake.approve(await svc.beginSignIn("docs", REDIRECT));
  return svc.finishSignIn("docs", code, state);
}

function text(result: { content: unknown }): string {
  return (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join("");
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("OAuth connections", () => {
  it("signs in with S256 PKCE and a state, stores the tokens in connection:<id>, and lists the tools", async () => {
    const fake = await oauthServer();
    const { svc, ndxHome } = service(fake.url);

    const authorizationUrl = new URL(await svc.beginSignIn("docs", REDIRECT));
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(new URL("/authorize", fake.url).href);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(fake.hits["/register"]).toBe(1);
    // Nothing is stored until the sign-in is finished.
    expect(stored(ndxHome)).toBeUndefined();

    const { code, state } = fake.approve(authorizationUrl.href);
    expect(await svc.finishSignIn("docs", code, state)).toEqual({ state: "connected" });

    const record = stored(ndxHome)!;
    expect(record).toMatchObject({ kind: "oauth", url: fake.url, redirectUrl: REDIRECT });
    expect(record.client.client_id).toMatch(/^client-/);
    expect(record.tokens.access_token).toMatch(/^at-/);
    expect(record.tokens.refresh_token).toMatch(/^rt-/);
    expect(fake.grants).toEqual(["authorization_code"]);

    expect((await svc.listTools()).map((t) => t.displayName).sort()).toEqual(["docs.delete_item", "docs.read_item", "docs.update_item"]);
    expect(text(await svc.callTool("docs", "read_item", { id: "7" }))).toBe("item 7");
    expect(fake.mcp.authorizations.at(-1)).toBe(`Bearer ${record.tokens.access_token}`);
  });

  it("refuses a wrong, reused, expired or other connection's state and stores nothing", async () => {
    const fake = await oauthServer();
    const { svc, ndxHome, clock } = service(fake.url);

    const first = fake.approve(await svc.beginSignIn("docs", REDIRECT));
    await expect(svc.finishSignIn("docs", first.code, "not-the-state")).rejects.toBeInstanceOf(ConnectionSignInError);
    expect(stored(ndxHome)).toBeUndefined();

    // A state is spent by its first use, so a guess does not leave it open either.
    await svc.finishSignIn("docs", first.code, first.state);
    const signedIn = stored(ndxHome);
    await expect(svc.finishSignIn("docs", first.code, first.state)).rejects.toThrow(/unknown, already used or expired/);
    expect(stored(ndxHome)).toEqual(signedIn);

    await svc.signOut("docs");
    const late = fake.approve(await svc.beginSignIn("docs", REDIRECT));
    clock.now += SIGN_IN_TTL_MS + 1;
    await expect(svc.finishSignIn("docs", late.code, late.state)).rejects.toBeInstanceOf(ConnectionSignInError);
    expect(stored(ndxHome)).toBeUndefined();
    expect(fake.grants).toEqual(["authorization_code"]);
  });

  it("refreshes an access token the server rejects, mid-session, without a sign-in", async () => {
    const fake = await oauthServer();
    const { svc, ndxHome } = service(fake.url);
    await signIn(svc, fake);
    const before = stored(ndxHome)!.tokens;

    fake.expireAccessTokens();
    expect(text(await svc.callTool("docs", "read_item", { id: "1" }))).toBe("item 1");

    expect(fake.grants).toEqual(["authorization_code", "refresh_token"]);
    const after = stored(ndxHome)!.tokens;
    expect(after.access_token).not.toBe(before.access_token);
    expect(after.refresh_token).not.toBe(before.refresh_token);
    expect(fake.hits["/authorize"]).toBeUndefined();
  });

  it("concurrent calls that all meet a rejected token refresh without signing the connection out", async () => {
    const fake = await oauthServer();
    const { svc, ndxHome } = service(fake.url);
    await signIn(svc, fake);

    for (let round = 0; round < 5; round++) {
      fake.expireAccessTokens();
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, (_, i) => svc.callTool("docs", "read_item", { id: String(i) })),
      );
      // A call may lose the race and read unavailable; none may sign the connection out.
      expect(stored(ndxHome)?.tokens?.refresh_token).toMatch(/^rt-/);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    }
    expect(text(await svc.callTool("docs", "read_item", { id: "9" }))).toBe("item 9");
  });

  it("headless: refreshes an expired token before connecting and succeeds; with none valid, reads needs-sign-in without blocking", async () => {
    const fake = await oauthServer();
    const browser = service(fake.url);
    await signIn(browser.svc, fake);
    await browser.svc.close();

    // Another process (the hub's automation) on the same store, past the token's expiry.
    browser.clock.now += fake.expiresIn * 1000;
    fake.expireAccessTokens();
    const hub = service(fake.url, browser);
    const expired = `Bearer ${stored(browser.ndxHome)!.tokens.access_token}`;
    const sentBefore = fake.mcp.authorizations.length;
    expect(text(await hub.svc.callTool("docs", "read_item", { id: "2" }))).toBe("item 2");
    // The refresh ran first, so the expired token was never sent.
    expect(fake.mcp.authorizations.slice(sentBefore)).not.toContain(expired);
    expect(fake.grants).toEqual(["authorization_code", "refresh_token"]);
    await hub.svc.close();

    browser.clock.now += fake.expiresIn * 1000;
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    const again = service(fake.url, browser);
    const [docs] = await again.svc.listConnections();
    expect(docs.status).toEqual({ state: "needs-sign-in", reason: expect.stringContaining("sign in again") });
    expect(fake.hits["/authorize"]).toBeUndefined();

    // Never signed in at all: needs-sign-in before any request is sent.
    const fresh = await oauthServer();
    const never = service(fresh.url);
    expect((await never.svc.listConnections())[0].status).toEqual({ state: "needs-sign-in", reason: NOT_SIGNED_IN });
    expect(fresh.mcp.authorizations).toEqual([]);
    expect(fresh.hits).toEqual({});
  });

  it("a revoked refresh token clears the tokens, keeps the client, and reads 'sign in again'", async () => {
    const fake = await oauthServer();
    const { svc, ndxHome } = service(fake.url);
    await signIn(svc, fake);
    const client = stored(ndxHome)!.client;

    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    const failure = await svc.callTool("docs", "read_item", { id: "1" }).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ConnectionUnavailableError);
    expect((failure as ConnectionUnavailableError).status).toEqual({
      state: "needs-sign-in",
      reason: expect.stringContaining("sign in again"),
    });
    expect(stored(ndxHome)).toEqual({ kind: "oauth", url: fake.url, redirectUrl: REDIRECT, client });

    // Signing in again reuses the kept registration.
    expect(await signIn(svc, fake)).toEqual({ state: "connected" });
    expect(fake.hits["/register"]).toBe(1);
  });

  it("does not send tokens bound to one URL to a connection whose URL changed", async () => {
    const first = await oauthServer();
    const signedIn = service(first.url);
    await signIn(signedIn.svc, first);
    await signedIn.svc.close();

    const moved = await oauthServer();
    const { svc } = service(moved.url, signedIn);
    expect((await svc.listConnections())[0].status).toEqual({ state: "needs-sign-in", reason: URL_CHANGED });
    await expect(svc.callTool("docs", "read_item", { id: "1" })).rejects.toBeInstanceOf(ConnectionUnavailableError);
    expect(moved.mcp.authorizations).toEqual([]);
    expect(moved.hits).toEqual({});
  });

  it("keeps every token and code out of logs, responses, project files and the environment", async () => {
    const fake = await oauthServer();
    const output: string[] = [];
    const capture = (chunk: unknown) => {
      output.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    for (const level of ["log", "warn", "error", "info", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void output.push(args.map(String).join(" ")));
    }
    cleanups.push(() => {
      vi.restoreAllMocks();
    });

    const { svc, projectDir, warnings } = service(fake.url);
    const responses: unknown[] = [];
    await signIn(svc, fake);
    responses.push(await svc.listConnections(), await svc.listTools());
    fake.expireAccessTokens();
    responses.push(await svc.callTool("docs", "read_item", { id: "1" }));
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    responses.push(await svc.callTool("docs", "read_item", { id: "1" }).catch((err: Error) => ({ message: err.message })));
    responses.push(await svc.listConnections());
    const wrongState = fake.approve(await svc.beginSignIn("docs", REDIRECT));
    responses.push(await svc.finishSignIn("docs", wrongState.code, "nope").catch((err: Error) => ({ message: err.message })));

    const surfaces = [
      ...output,
      ...warnings,
      JSON.stringify(responses),
      ...filesUnder(projectDir).map((file) => readFileSync(file, "utf-8")),
      JSON.stringify(process.env),
    ].join("\n");
    expect(fake.issued.length).toBeGreaterThan(4);
    for (const secret of fake.issued) expect(surfaces).not.toContain(secret);
  });
});
