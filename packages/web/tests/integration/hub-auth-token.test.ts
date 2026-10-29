/**
 * The per-user token, end to end through a real hub and a real spawned
 * project server: the hub requires it, passes it to the child it spawns,
 * probes the child with it, and lets a browser in only through a landing
 * nonce exchanged for a session credential (header) and single-use WebSocket
 * tickets. The old `ndx_token` cookie is no credential anywhere.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";
import { startHub } from "../../src/hub/index.js";
import type { HubHandle } from "../../src/hub/index.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const NDX_BIN = join(WEB_PKG, "dist/cli/index.js");

let home: string;
let repo: string;
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
  tokenFile = join(home, "auth.token");
  hub = await startHub({ port: 0, selfBin: NDX_BIN, homeDir: home, tokenFile, healthIntervalMs: 60_000, supervisor: { portFileTimeoutMs: 30_000, stopGraceMs: 3_000 } });
  token = readFileSync(tokenFile, "utf-8").trim();
}, 60_000);

afterAll(async () => {
  await hub?.close({ stopChildren: true });
  // Retry: on Windows a stopped child's handles on the repo dir are not always released when close() resolves (EBUSY).
  for (const dir of [home, repo]) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
});
