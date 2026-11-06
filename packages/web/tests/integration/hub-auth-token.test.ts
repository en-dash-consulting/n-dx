/**
 * The per-user token, end to end through a real hub and a real spawned
 * project server: the hub requires it, passes it to the child it spawns,
 * probes the child with it, and lets a browser in only through a landing
 * nonce exchanged for a session credential (header) and single-use WebSocket
 * tickets. The old `ndx_token` cookie is no credential anywhere.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";
import { removeTempDir } from "../helpers/temp-dir.js";
import { startHub } from "../../src/hub/index.js";
import type { HubHandle } from "../../src/hub/index.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const NDX_BIN = join(WEB_PKG, "dist/cli/index.js");

let home: string;
let repo: string;
let repoB: string;
let hub: HubHandle;
let token: string;
let tokenFile: string;

const base = () => `http://127.0.0.1:${hub.port}`;
const withToken = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), "X-Ndx-Token": token } });

function wsHandshake(path: string, headers: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(hub.port, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${hub.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Origin: http://127.0.0.1:${hub.port}\r\n${headers}` +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    let buffer = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`no handshake response for ${path}`)); }, 10_000);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      if (buffer.includes("\r\n")) { clearTimeout(timer); socket.destroy(); resolvePromise(buffer.split("\r\n")[0]); }
    });
    socket.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

beforeAll(async () => {
  assertFreshServerBuild();
  home = mkdtempSync(join(tmpdir(), "ndx-hub-auth-home-"));
  repo = mkdtempSync(join(tmpdir(), "ndx-hub-auth-repo-"));
  repoB = mkdtempSync(join(tmpdir(), "ndx-hub-auth-repo-b-"));
  tokenFile = join(home, "auth.token");
  hub = await startHub({ port: 0, selfBin: NDX_BIN, homeDir: home, tokenFile, healthIntervalMs: 60_000, supervisor: { portFileTimeoutMs: 30_000, stopGraceMs: 3_000 } });
  token = readFileSync(tokenFile, "utf-8").trim();
}, 60_000);

afterAll(async () => {
  await hub?.close({ stopChildren: true });
  // Retry: on Windows a stopped child's handles on the repo dir are not always released when close() resolves (EBUSY).
  for (const dir of [home, repo, repoB]) await removeTempDir(dir);
}, 30_000);

describe("hub with a per-user token", () => {
  it("creates the token file with owner-only modes and requires it on its own API", async () => {
    expect(token.length).toBeGreaterThanOrEqual(32);
    if (process.platform !== "win32") expect(statSync(tokenFile).mode & 0o777).toBe(0o600);

    const anon = await fetch(`${base()}/api/hub/health`);
    expect(anon.status).toBe(401);
    expect(anon.headers.get("www-authenticate")).toContain("Bearer");

    expect((await fetch(`${base()}/api/hub/health`, withToken())).status).toBe(200);
    expect((await fetch(`${base()}/api/hub/health`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    // A cookie on localhost reaches every port, so it is no credential.
    expect((await fetch(`${base()}/api/hub/health`, { headers: { Cookie: `ndx_token=${token}` } })).status).toBe(401);
  });

  it("refuses an unauthenticated registration, so the spawn route needs the token as well as a good Origin", async () => {
    const res = await fetch(`${base()}/api/hub/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${hub.port}` },
      body: JSON.stringify({ id: "nope", repoRoot: repo, ndxBin: NDX_BIN }),
    });
    expect(res.status).toBe(401);
    expect((await (await fetch(`${base()}/api/hub/projects`, withToken())).json()).projects).toEqual([]);
  });

  it("registers with the token, starts the child with the same token, and probes it successfully", async () => {
    const res = await fetch(`${base()}/api/hub/projects`, withToken({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "alpha", repoRoot: repo, ndxBin: NDX_BIN }),
    }));
    const body = await res.json();
    expect([200, 201], JSON.stringify(body)).toContain(res.status);
    // Healthy means the hub's own probe — which sends the header — was answered 200 by the child.
    expect(body.project.status.state).toBe("healthy");

    // The child itself demands the token: direct requests to its port without one are 401.
    const childPort = body.project.status.port as number;
    expect(typeof childPort).toBe("number");
    expect((await fetch(`http://127.0.0.1:${childPort}/api/status`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${childPort}/api/status`, withToken())).status).toBe(200);
  }, 60_000);

  it("refuses the old cookie through the proxy, as a page on another loopback port would send it", async () => {
    expect((await fetch(`${base()}/p/alpha/api/status`)).status).toBe(401);
    const cookie = await fetch(`${base()}/p/alpha/api/status`, {
      headers: { Cookie: `ndx_token=${token}`, Origin: "http://localhost:5173", "Sec-Fetch-Site": "same-site" },
    });
    expect(cookie.status).toBe(401);
    const ok = await fetch(`${base()}/p/alpha/api/status`, withToken());
    expect(ok.status).toBe(200);
    expect((await ok.json()).projectDir).toBe(repo);
  });

  it("refuses the connections routes through the proxy without a credential; a sign-in's return is only the shell", async () => {
    expect((await fetch(`${base()}/p/alpha/api/connections`)).status).toBe(401);
    const navigation = await fetch(`${base()}/p/alpha/api/connections`, { headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" } });
    expect(navigation.status).toBe(401);
    for (const action of ["oauth/start", "oauth/finish", "sign-out"]) {
      const res = await fetch(`${base()}/p/alpha/api/connections/docs/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${hub.port}` },
        body: JSON.stringify({ code: "c", state: "s", redirectUrl: `${base()}/oauth/callback` }),
      });
      expect(res.status, action).toBe(401);
    }
    // With the token the request reaches the project server, whose web.sidecar gate answers.
    const gated = await fetch(`${base()}/p/alpha/api/connections`, withToken());
    expect(gated.status).toBe(403);
    expect(gated.headers.get("x-ndx-feature-disabled")).toBe("web.sidecar");
  });

  it("relays a sign-in's return at the hub origin to the project's callback page, reading no credential", async () => {
    const query = `?code=the-code&state=${encodeURIComponent(`alpha~~docs~${"n".repeat(43)}`)}&iss=${encodeURIComponent("https://as.example")}`;
    // The authorization server's redirect: a cross-site navigation with no credential.
    const relayed = await fetch(`${base()}/oauth/callback${query}`, {
      redirect: "manual",
      headers: { Accept: "text/html", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" },
    });
    expect(relayed.status).toBe(302);
    expect(relayed.headers.get("location")).toBe(`/p/alpha/oauth/callback${query}`);
    expect(relayed.headers.get("set-cookie")).toBeNull();

    // The project's callback is its public page shell; it acts on nothing in its URL.
    const landing = await fetch(`${base()}/p/alpha/oauth/callback${query}`, { headers: { Accept: "text/html" } });
    expect(landing.status).toBe(200);
    const html = await landing.text();
    expect(html).toContain("ndxAuth");
    expect(html).not.toContain("the-code");

    const unknown = await fetch(`${base()}/oauth/callback?code=c&state=${encodeURIComponent(`gamma~~docs~${"n".repeat(43)}`)}`, { redirect: "manual" });
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("Sign-in not finished");
  });

  it("serves the page shell to a navigation without a credential, and nothing else", async () => {
    const page = await fetch(`${base()}/p/alpha/`, { headers: { Accept: "text/html" } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("ndxAuth");
    expect(html).not.toContain(token);
    expect(page.headers.get("set-cookie")).toBeNull();
    // The hub's own pages: the chooser shell carries no project, and its API is closed.
    const home = await fetch(`${base()}/hub`, { headers: { Accept: "text/html" } });
    expect(home.status).toBe(200);
    expect(await home.text()).not.toContain(repo);
    expect((await fetch(`${base()}/api/hub/overview`)).status).toBe(401);
    // A deep link to data, rather than the shell, is a sign-in page.
    const data = await fetch(`${base()}/p/alpha/api/status`, { headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" } });
    expect(data.status).toBe(401);
    expect(await data.text()).toContain("ndx start");
  });

  it("exchanges a nonce once for a session that works through the proxy, and never for the token", async () => {
    const minted = await fetch(`${base()}/api/auth/nonce`, withToken({ method: "POST" }));
    expect(minted.status).toBe(200);
    const { nonce } = await minted.json();
    expect(nonce).not.toBe(token);

    const exchange = () => fetch(`${base()}/p/alpha/api/auth/session`, { method: "POST", headers: { "X-Ndx-Nonce": nonce } });
    const first = await exchange();
    expect(first.status).toBe(200);
    const { credential } = await first.json();
    expect(credential).not.toBe(token);
    expect((await exchange()).status).toBe(401);

    const ok = await fetch(`${base()}/p/alpha/api/status`, { headers: { "X-Ndx-Token": credential } });
    expect(ok.status).toBe(200);
    expect((await fetch(`${base()}/api/hub/overview`, { headers: { "X-Ndx-Token": credential } })).status).toBe(200);
    // The session is the hub's: the child never sees it, and refuses it directly.
    const childPort = ((await (await fetch(`${base()}/api/hub/projects/alpha`, withToken())).json()).project.status.port) as number;
    expect((await fetch(`http://127.0.0.1:${childPort}/api/status`, { headers: { "X-Ndx-Token": credential } })).status).toBe(401);
    // A session cannot mint the nonces that would mint more sessions.
    expect((await fetch(`${base()}/api/auth/nonce`, { method: "POST", headers: { "X-Ndx-Token": credential } })).status).toBe(401);
  });

  it("requires a single-use ticket (or the token header) on the WebSocket handshake", async () => {
    expect(await wsHandshake("/p/alpha/", "")).toMatch(/^HTTP\/1\.1 401/);
    expect(await wsHandshake("/p/alpha/", `Cookie: ndx_token=${token}\r\n`)).toMatch(/^HTTP\/1\.1 401/);
    expect(await wsHandshake("/p/alpha/?ndx_ticket=forged", "")).toMatch(/^HTTP\/1\.1 401/);

    const { nonce } = await (await fetch(`${base()}/api/auth/nonce`, withToken({ method: "POST" }))).json();
    const { credential } = await (await fetch(`${base()}/api/auth/session`, { method: "POST", headers: { "X-Ndx-Nonce": nonce } })).json();
    const { ticket } = await (await fetch(`${base()}/p/alpha/api/auth/ws-ticket`, { method: "POST", headers: { "X-Ndx-Token": credential } })).json();
    expect(await wsHandshake(`/p/alpha/?ndx_ticket=${ticket}`, "")).toMatch(/^HTTP\/1\.1 101/);
    expect(await wsHandshake(`/p/alpha/?ndx_ticket=${ticket}`, "")).toMatch(/^HTTP\/1\.1 401/);
    expect(await wsHandshake("/p/alpha/", `X-Ndx-Token: ${token}\r\n`)).toMatch(/^HTTP\/1\.1 101/);
  }, 30_000);

  it("mints a landing nonce at the root with several projects registered, rather than proxying it (409)", async () => {
    // A hub built before landing nonces sent the root request to its project
    // proxy, which answers 409 once two projects are registered — and `ndx
    // start` printed no sign-in link. The current hub answers it itself.
    const res = await fetch(`${base()}/api/hub/projects`, withToken({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "beta", repoRoot: repoB, ndxBin: NDX_BIN }),
    }));
    expect([200, 201]).toContain(res.status);
    const health = await (await fetch(`${base()}/api/hub/health`, withToken())).json();
    expect(health.projects).toBeGreaterThanOrEqual(2);

    const minted = await fetch(`${base()}/api/auth/nonce`, withToken({ method: "POST" }));
    expect(minted.status).toBe(200);
    expect(typeof (await minted.json()).nonce).toBe("string");
  }, 60_000);

  it("reports the build it runs on /api/hub/health, so ndx start can tell an older hub from its own", async () => {
    const pkg = JSON.parse(readFileSync(join(WEB_PKG, "package.json"), "utf-8"));
    const health = await (await fetch(`${base()}/api/hub/health`, withToken())).json();
    expect(health.build.version).toBe(pkg.version);
    // assertFreshServerBuild() guarantees the stamp, so a null here means the
    // hub stopped finding it — and ndx start would skip the hash comparison.
    const stamp = JSON.parse(readFileSync(join(WEB_PKG, "dist", ".build-stamp.json"), "utf-8"));
    expect(health.build.sourceHash).toBe(stamp.sourceHash);
  });
});
