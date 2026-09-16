/**
 * The hub's reverse proxy against a real project server: explicit
 * `/p/<id>/…` addressing, the single-project root alias, the multi-project
 * 409, and a WebSocket upgrade forwarded through the prefix.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
let repoA: string;
let repoB: string;
let hub: HubHandle;

async function register(id: string, repoRoot: string): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${hub.port}/api/hub/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, repoRoot, ndxBin: NDX_BIN }),
  });
  const body = await res.json();
  expect([200, 201], JSON.stringify(body)).toContain(res.status);
  expect(body.project.status.state).toBe("healthy");
}

/** Raw WebSocket handshake; resolves with the status line the hub returned. */
function wsHandshake(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(hub.port, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${hub.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    let buffer = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`no handshake response for ${path}`)); }, 10_000);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      if (buffer.includes("\r\n")) {
        clearTimeout(timer);
        socket.destroy();
        resolvePromise(buffer.split("\r\n")[0]);
      }
    });
    socket.on("error", (err) => { clearTimeout(timer); reject(err); });
    socket.on("close", () => { clearTimeout(timer); if (!buffer) reject(new Error(`socket closed without a response for ${path}`)); });
  });
}

beforeAll(async () => {
  assertFreshServerBuild();
  home = mkdtempSync(join(tmpdir(), "ndx-hub-proxy-home-"));
  repoA = mkdtempSync(join(tmpdir(), "ndx-hub-proxy-a-"));
  repoB = mkdtempSync(join(tmpdir(), "ndx-hub-proxy-b-"));
  hub = await startHub({ port: 0, homeDir: home, healthIntervalMs: 60_000, supervisor: { portFileTimeoutMs: 30_000, stopGraceMs: 3_000 } });
}, 60_000);

afterAll(async () => {
  await hub?.close({ stopChildren: true });
  for (const dir of [home, repoA, repoB]) rmSync(dir, { recursive: true, force: true });
}, 30_000);

describe("hub reverse proxy", () => {
  it("with no project: / lists nothing, everything else is 404", async () => {
    const root = await fetch(`http://127.0.0.1:${hub.port}/`);
    expect(root.status).toBe(200);
    expect(root.headers.get("content-type")).toContain("text/html");
    expect(await root.text()).toContain("No project is registered");
    expect((await fetch(`http://127.0.0.1:${hub.port}/api/status`)).status).toBe(404);
    expect(await wsHandshake("/")).toMatch(/^HTTP\/1\.1 404/);
  });

  it("proxies /p/<id>/… to that project's server with the prefix stripped", async () => {
    await register("alpha", repoA);

    const status = await fetch(`http://127.0.0.1:${hub.port}/p/alpha/api/status`);
    expect(status.status).toBe(200);
    expect((await status.json()).projectDir).toBe(repoA);

    // The page itself, at the prefix with and without a trailing slash.
    for (const path of ["/p/alpha", "/p/alpha/"]) {
      const page = await fetch(`http://127.0.0.1:${hub.port}${path}`);
      expect(page.status, path).toBe(200);
      expect(page.headers.get("content-type"), path).toContain("text/html");
    }

    // A server-issued root-relative redirect comes back under the prefix.
    const redirect = await fetch(`http://127.0.0.1:${hub.port}/p/alpha/landing`, { redirect: "manual" });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe("/p/alpha/");

    expect((await fetch(`http://127.0.0.1:${hub.port}/p/nope/api/status`)).status).toBe(404);
  }, 60_000);

  it("forwards a WebSocket upgrade under the prefix", async () => {
    expect(await wsHandshake("/p/alpha")).toMatch(/^HTTP\/1\.1 101/);
    expect(await wsHandshake("/p/alpha/")).toMatch(/^HTTP\/1\.1 101/);
    expect(await wsHandshake("/p/nope")).toMatch(/^HTTP\/1\.1 404/);
  });

  it("aliases the root to the sole project, including the socket", async () => {
    const status = await fetch(`http://127.0.0.1:${hub.port}/api/status`);
    expect(status.status).toBe(200);
    expect((await status.json()).projectDir).toBe(repoA);
    expect((await fetch(`http://127.0.0.1:${hub.port}/`)).headers.get("content-type")).toContain("text/html");
    expect(await wsHandshake("/")).toMatch(/^HTTP\/1\.1 101/);
  });

  it("with two projects: / lists them, root API calls are 409 with the ids, /p/ still works", async () => {
    await register("beta", repoB);

    const root = await fetch(`http://127.0.0.1:${hub.port}/`);
    expect(root.status).toBe(200);
    const html = await root.text();
    expect(html).toContain("/p/alpha/");
    expect(html).toContain("/p/beta/");

    const conflict = await fetch(`http://127.0.0.1:${hub.port}/api/status`);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).projects).toEqual(["alpha", "beta"]);
    expect(await wsHandshake("/")).toMatch(/^HTTP\/1\.1 409/);

    expect((await (await fetch(`http://127.0.0.1:${hub.port}/p/beta/api/status`)).json()).projectDir).toBe(repoB);
    expect((await (await fetch(`http://127.0.0.1:${hub.port}/p/alpha/api/status`)).json()).projectDir).toBe(repoA);
  }, 60_000);
});
