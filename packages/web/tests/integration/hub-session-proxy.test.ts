/**
 * The hub serves the hub-scope Sidecar session at `/hub/session/…` by
 * forwarding to `/api/sidecar/hub/…` on the project server that hosts it,
 * HTTP and WebSocket, only past the hub's request guard. The host is the
 * lock's holder while it is healthy, else the first healthy project; a host
 * the proxy cannot reach is passed over until its next health check.
 *
 * The project servers here are plain HTTP servers recording what reaches
 * them; the hub is its real guard and proxy over a stub project list.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect } from "node:net";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HubSessionHostPicker,
  handleHubRoute,
  handleProxyRequest,
  handleProxyUpgrade,
  hubSessionHostLockPath,
  type Hub,
  type ProjectView,
} from "../../src/hub/index.js";
import { handlePublicHubRequest } from "../../src/hub/proxy.js";
import { guardHubRequest, isPublicOnlyHubRequest, upgradeRefusal } from "../../src/hub/request-guard.js";
import { FEATURE_DISABLED_HEADER } from "../../src/shared/index.js";

const TOKEN = "per-user-token";

interface Upstream {
  server: Server;
  port: number;
  seen: Array<{ url: string; token: string | undefined }>;
  upgrades: string[];
  /** Answer as a project whose web.sidecar gate is closed. */
  sidecarOff: boolean;
  /** What the host's hub-lens read reports. */
  lensAvailable: boolean;
}

let home: string;
let upstreams: Upstream[];
let projects: ProjectView[];
let hubServer: Server;
let hubPort: number;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function startUpstream(): Promise<Upstream> {
  const seen: Upstream["seen"] = [];
  const upgrades: string[] = [];
  const upstream: Upstream = { server: undefined as unknown as Server, port: 0, seen, upgrades, sidecarOff: false, lensAvailable: false };
  const server = createServer((req: IncomingMessage, res) => {
    seen.push({ url: req.url ?? "", token: req.headers["x-ndx-token"] as string | undefined });
    if (upstream.sidecarOff) {
      res.writeHead(403, { "Content-Type": "application/json", [FEATURE_DISABLED_HEADER]: "web.sidecar" });
      res.end(JSON.stringify({ kind: "feature_disabled", feature: "web.sidecar" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/api/sidecar/hub/lens") {
      res.end(JSON.stringify({ lens: { id: "hub", available: upstream.lensAvailable }, ceiling: 1 }));
      return;
    }
    res.end(JSON.stringify({ port: (server.address() as { port: number }).port }));
  });
  server.on("upgrade", (req, socket) => {
    upgrades.push(req.url ?? "");
    socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  });
  upstream.server = server;
  upstream.port = await listen(server);
  upstreams.push(upstream);
  return upstream;
}

function project(id: string, port: number, state = "healthy", lastHealthAt = "t1"): ProjectView {
  return {
    id, name: id, repoRoot: `/repo/${id}`, worktrees: [`/repo/${id}`], ndxBin: "/x.js", port, pid: 1, lastSeen: null,
    status: { state, pid: 1, port, attached: false, respawns: 0, lastHealthAt, lastError: null },
  } as ProjectView;
}

function hubGet(path: string, token: string | null = TOKEN): Promise<Response> {
  return fetch(`http://127.0.0.1:${hubPort}${path}`, { headers: token ? { "X-Ndx-Token": token } : {} });
}

function wsHandshake(path: string, token: string | null = TOKEN): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(hubPort, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${hubPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
        + (token ? `X-Ndx-Token: ${token}\r\n` : "")
        + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      if (buffer.includes("\r\n")) {
        socket.destroy();
        resolve(buffer.split("\r\n")[0]);
      }
    });
    socket.on("error", reject);
  });
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "hub-session-proxy-"));
  upstreams = [];
  projects = [];
  const hub = {
    token: TOKEN,
    listProjects: () => projects,
    getProject: (id: string) => projects.find((p) => p.id === id) ?? null,
    sessionHosts: new HubSessionHostPicker(home),
  } as unknown as Hub;
  hubServer = createServer((req, res) => {
    if (guardHubRequest(req, res, hubPort, TOKEN)) return;
    // As hub.ts: a request with no credential gets only what is public.
    if (isPublicOnlyHubRequest(req)) {
      void handlePublicHubRequest(req, res, hub);
      return;
    }
    void handleHubRoute(req, res, hub).then((handled) => {
      if (!handled) void handleProxyRequest(req, res, hub);
    });
  });
  hubServer.on("upgrade", (req, socket, head) => {
    const refusal = upgradeRefusal(req, hubPort, TOKEN);
    if (refusal) {
      socket.end(`HTTP/1.1 ${refusal}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    handleProxyUpgrade(req, socket, head, hub);
  });
  hubPort = await listen(hubServer);
});

afterEach(async () => {
  for (const server of [hubServer, ...upstreams.map((u) => u.server)]) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  rmSync(home, { recursive: true, force: true });
});

describe("/hub/session/ through the hub", () => {
  it("answers 401 without the token and forwards nothing", async () => {
    const a = await startUpstream();
    projects = [project("a", a.port)];
    expect((await hubGet("/hub/session/sessions", null)).status).toBe(401);
    expect(await wsHandshake("/hub/session/ws", null)).toBe("HTTP/1.1 401 Unauthorized");
    expect(a.seen).toEqual([]);
    expect(a.upgrades).toEqual([]);
  });

  it("serves a credential-less navigation to the drawer page from the host, with the per-user token and no query", async () => {
    const a = await startUpstream();
    projects = [project("a", a.port)];
    const res = await fetch(`http://127.0.0.1:${hubPort}/hub/session/drawer?x=1`, { headers: { accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(a.seen).toEqual([{ url: "/api/sidecar/hub/drawer", token: TOKEN }]);
  });

  it("says whether the hub session can run only on the overview read that asks, as the host's lens reports", async () => {
    const a = await startUpstream();
    projects = [project("a", a.port)];
    expect((await (await hubGet("/api/hub/overview")).json()).hubSession).toBeUndefined();
    expect(a.seen.some((s) => s.url.endsWith("/lens"))).toBe(false);
    expect((await (await hubGet("/api/hub/overview?hubSession=1")).json()).hubSession).toBe(false);
    a.lensAvailable = true;
    expect((await (await hubGet("/api/hub/overview?hubSession=1")).json()).hubSession).toBe(true);
    expect((await hubGet("/api/hub/overview?hubSession=1", null)).status).toBe(401);
  });

  it("refuses every other credential-less hub-session request and forwards nothing", async () => {
    const a = await startUpstream();
    projects = [project("a", a.port)];
    const base = `http://127.0.0.1:${hubPort}`;
    const html = { accept: "text/html" };
    const refused = [
      await fetch(`${base}/hub/session/drawer`), // not a navigation
      await fetch(`${base}/hub/session/drawer`, { method: "HEAD", headers: html }),
      await fetch(`${base}/hub/session/drawer/x`, { headers: html }),
      await fetch(`${base}/hub/session/lens`, { headers: html }),
      await fetch(`${base}/hub/session/snapshot`),
      await fetch(`${base}/hub/session`, { headers: html }),
      await fetch(`${base}/hub/session/sessions`, { method: "POST", headers: { ...html, "content-type": "application/json" }, body: "{}" }),
    ];
    expect(refused.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401, 401]);
    expect(await wsHandshake("/hub/session/drawer", null)).toBe("HTTP/1.1 401 Unauthorized");
    expect(a.seen).toEqual([]);
    expect(a.upgrades).toEqual([]);
  });

  it("forwards HTTP and WebSocket to the first healthy project's hub-session routes, without a token parameter", async () => {
    const a = await startUpstream();
    const b = await startUpstream();
    projects = [project("a", a.port, "unreachable"), project("b", b.port)];
    const res = await hubGet("/hub/session/sessions/s-1/frames?after=2&ndx_token=leak");
    expect(res.status).toBe(200);
    expect(b.seen).toEqual([{ url: "/api/sidecar/hub/sessions/s-1/frames?after=2", token: TOKEN }]);
    expect(await wsHandshake("/hub/session/ws")).toBe("HTTP/1.1 101 Switching Protocols");
    expect(b.upgrades).toEqual(["/api/sidecar/hub/ws"]);
    expect(a.seen).toEqual([]);
  });

  it("keeps sending the session to the lock's holder while it is healthy", async () => {
    const a = await startUpstream();
    const b = await startUpstream();
    projects = [project("a", a.port), project("b", b.port)];
    mkdirSync(join(home, "hub", "sidecar"), { recursive: true });
    writeFileSync(hubSessionHostLockPath(home), JSON.stringify({ pid: process.pid, port: b.port, acquiredAt: "" }));
    await hubGet("/hub/session/sessions");
    expect(b.seen).toHaveLength(1);
    expect(a.seen).toHaveLength(0);
  });

  it("picks another host when the host is unregistered or dies, and returns to it after a newer health check", async () => {
    const a = await startUpstream();
    const b = await startUpstream();
    projects = [project("a", a.port), project("b", b.port)];
    await hubGet("/hub/session/sessions");
    expect(a.seen).toHaveLength(1);

    projects = [project("b", b.port)];
    await hubGet("/hub/session/sessions");
    expect(b.seen).toHaveLength(1);

    // A dies with its health check still reading healthy: one 502, then the next request moves on.
    projects = [project("a", a.port), project("b", b.port)];
    a.server.closeAllConnections?.();
    await new Promise((resolve) => a.server.close(resolve));
    expect((await hubGet("/hub/session/sessions")).status).toBe(502);
    expect((await hubGet("/hub/session/sessions")).status).toBe(200);
    expect(b.seen).toHaveLength(2);

    // Respawned on the same port, and a newer health check answered.
    a.server.listen(a.port, "127.0.0.1");
    await new Promise((resolve) => a.server.once("listening", resolve));
    projects = [project("a", a.port, "healthy", "t2"), project("b", b.port)];
    await hubGet("/hub/session/sessions");
    expect(a.seen).toHaveLength(2);
  });

  it("passes over a host whose web.sidecar is off, so the project that has it on hosts the session", async () => {
    const a = await startUpstream();
    const b = await startUpstream();
    a.sidecarOff = true;
    projects = [project("a", a.port), project("b", b.port)];
    // The first request is refused by a's gate and marks it; the next moves on.
    const first = await hubGet("/hub/session/sessions");
    expect(first.status).toBe(403);
    expect((await first.json()).feature).toBe("web.sidecar");
    const second = await hubGet("/hub/session/sessions");
    expect(second.status).toBe(200);
    expect(b.seen).toEqual([{ url: "/api/sidecar/hub/sessions", token: TOKEN }]);
    expect(a.seen).toHaveLength(1);
  });

  it("answers a refusal naming web.sidecar when no project has it on", async () => {
    const a = await startUpstream();
    const b = await startUpstream();
    a.sidecarOff = true;
    b.sidecarOff = true;
    projects = [project("a", a.port), project("b", b.port)];
    expect((await hubGet("/hub/session/sessions")).status).toBe(403); // a refuses, is marked
    expect((await hubGet("/hub/session/sessions")).status).toBe(403); // b refuses, is marked
    const res = await hubGet("/hub/session/sessions");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.feature).toBe("web.sidecar");
    expect(body.error).toContain("web.sidecar");
    expect(a.seen).toHaveLength(1);
    expect(b.seen).toHaveLength(1);
  });

  it("answers 503 when no registered project is healthy", async () => {
    projects = [];
    const res = await hubGet("/hub/session/sessions");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("hub session");
    expect(await wsHandshake("/hub/session/ws")).toBe("HTTP/1.1 503 Service Unavailable");
  });
});
