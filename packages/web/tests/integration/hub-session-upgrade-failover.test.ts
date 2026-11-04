/**
 * A hub session WebSocket fails over past a real project server whose
 * web.sidecar is off. The hub's upgrade failover waits for that host's 403
 * naming web.sidecar; `hub-session-proxy.test.ts` checks the hub half against
 * stub upstreams that answer it by hand, so nothing there fails if the project
 * server's upgrade path stops applying the gate.
 *
 * Both project servers are the built server, each in its own process
 * (startServer has no close handle, so the child's exit is the teardown). The
 * hub is its real guard and proxy over a stub project list, as in
 * `hub-session-proxy.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";
import { removeTempDir } from "../helpers/temp-dir.js";
import { HubSessionHostPicker, handleProxyUpgrade, type Hub, type ProjectView } from "../../src/hub/index.js";
import { upgradeRefusal } from "../../src/hub/request-guard.js";
import { FEATURE_DISABLED_HEADER } from "../../src/shared/index.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY_URL = pathToFileURL(join(WEB_PKG, "dist/server/start.js")).href;
const TOKEN = "per-user-token";
const HUB_WS = "/hub/session/ws";
const UPSTREAM_WS = "/api/sidecar/hub/ws";

let root: string;
const children: ChildProcess[] = [];
const sockets: Socket[] = [];
let off: number;
let on: number;
let hubServer: Server;
let hubPort: number;

/** Boot the built server on a fresh project with web.sidecar `sidecar`, with `home` as its ndx home; returns its port. */
async function boot(name: string, sidecar: boolean, home: string): Promise<number> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ features: { web: { sidecar } } }), "utf-8");
  const script = join(dir, "driver.mjs");
  await writeFile(script, `
import { startServer } from ${JSON.stringify(SERVER_ENTRY_URL)};
const { port } = await startServer(${JSON.stringify(dir)}, 0, {});
console.log("NDX_PORT=" + port);
setInterval(() => {}, 60_000);
`, "utf-8");
  const env: NodeJS.ProcessEnv = { ...process.env, N_DX_HOME: home };
  delete env["NDX_HOME"];
  const child = spawn(process.execPath, [script], { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  return new Promise<number>((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error(`server on ${dir} printed no port:\n${out}`)), 60_000);
    child.stdout!.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const match = /NDX_PORT=(\d+)/.exec(out);
      if (match) {
        clearTimeout(timer);
        resolvePort(Number(match[1]));
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server on ${dir} exited (${code}) before printing its port:\n${out}`));
    });
  });
}

function project(id: string, port: number): ProjectView {
  return {
    id, name: id, repoRoot: `/repo/${id}`, worktrees: [`/repo/${id}`], ndxBin: "/x.js", port, pid: 1, lastSeen: null,
    status: { state: "healthy", pid: 1, port, attached: false, respawns: 0, lastHealthAt: "t1", lastError: null },
  } as ProjectView;
}

/** Open a WebSocket handshake to `port` at `path`; resolves with the response head once it has arrived. The socket stays open. */
function handshake(port: number, path: string): Promise<string> {
  return new Promise((resolveHead, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Ndx-Token: ${TOKEN}\r\n`
        + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    sockets.push(socket);
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("latin1");
      const end = buffer.indexOf("\r\n\r\n");
      if (end !== -1) resolveHead(buffer.slice(0, end));
    });
    socket.on("error", reject);
  });
}

async function activeConnections(port: number): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/api/ws/health`);
  return ((await res.json()) as { activeConnections: number }).activeConnections;
}

describe("a hub session upgrade across two real project servers", () => {
  beforeAll(async () => {
    assertFreshServerBuild();
    root = await mkdtemp(join(tmpdir(), "ndx-hub-upgrade-failover-"));
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    [off, on] = await Promise.all([boot("off", false, home), boot("on", true, home)]);
    // The sidecar-off project is listed first, so the hub tries it first.
    const projects = [project("off", off), project("on", on)];
    const hub = {
      token: TOKEN,
      listProjects: () => projects,
      getProject: (id: string) => projects.find((p) => p.id === id) ?? null,
      sessionHosts: new HubSessionHostPicker(home),
    } as unknown as Hub;
    hubServer = createServer((_req, res) => { res.writeHead(404); res.end(); });
    hubServer.on("upgrade", (req, socket, head) => {
      const refusal = upgradeRefusal(req, hubPort, TOKEN);
      if (refusal) {
        socket.end(`HTTP/1.1 ${refusal}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        return;
      }
      handleProxyUpgrade(req, socket, head, hub);
    });
    await new Promise<void>((done) => hubServer.listen(0, "127.0.0.1", done));
    hubPort = (hubServer.address() as { port: number }).port;
  }, 120_000);

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    if (hubServer) {
      hubServer.closeAllConnections?.();
      await new Promise((done) => hubServer.close(done));
    }
    for (const child of children) child.kill();
    await Promise.all(children.map((child) => child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((done) => child.once("exit", done))));
    if (root) await removeTempDir(root);
  });

  it("is refused by the sidecar-off server with 403 naming web.sidecar, and no 101", async () => {
    const head = await handshake(off, UPSTREAM_WS);
    expect(head.split("\r\n")[0]).toBe("HTTP/1.1 403 Forbidden");
    expect(head.toLowerCase()).toContain(`${FEATURE_DISABLED_HEADER}: web.sidecar`);
    expect(head).not.toContain("101");
  });

  it("is still accepted on every other path by the sidecar-off server", async () => {
    expect((await handshake(off, "/")).split("\r\n")[0]).toBe("HTTP/1.1 101 Switching Protocols");
  });

  it("is accepted by the sidecar-on server", async () => {
    expect((await handshake(on, UPSTREAM_WS)).split("\r\n")[0]).toBe("HTTP/1.1 101 Switching Protocols");
  });

  it("through the hub is connected to the second server when the first has web.sidecar off", async () => {
    const offBefore = await activeConnections(off);
    const onBefore = await activeConnections(on);
    expect((await handshake(hubPort, HUB_WS)).split("\r\n")[0]).toBe("HTTP/1.1 101 Switching Protocols");
    expect(await activeConnections(on)).toBe(onBefore + 1);
    expect(await activeConnections(off)).toBe(offBefore);
  });
});
