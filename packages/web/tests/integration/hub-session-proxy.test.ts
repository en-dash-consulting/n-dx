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
  MAX_HUB_SESSION_BODY_BYTES,
  handleProxyRequest,
  handleProxyUpgrade,
  hubSessionHostLockPath,
  type Hub,
  type ProjectView,
} from "../../src/hub/index.js";
import { guardHubRequest, upgradeRefusal } from "../../src/hub/request-guard.js";
import { FEATURE_DISABLED_HEADER } from "../../src/shared/index.js";

const TOKEN = "per-user-token";

interface Upstream {
  server: Server;
  port: number;
  seen: Array<{ url: string; token: string | undefined }>;
  upgrades: string[];
  /** Every request that arrived, with its body. */
  requests: Array<{ method: string; url: string; headers: IncomingMessage["headers"]; body: string }>;
  /** Answer as a project whose web.sidecar gate is closed. */
  sidecarOff: boolean;
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
  const upstream: Upstream = { server: undefined as unknown as Server, port: 0, seen, upgrades, requests: [], sidecarOff: false };
  const requests: Upstream["requests"] = [];
  upstream.requests = requests;
  const server = createServer((req: IncomingMessage, res) => {
    seen.push({ url: req.url ?? "", token: req.headers["x-ndx-token"] as string | undefined });
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (upstream.sidecarOff) {
        res.writeHead(403, { "Content-Type": "application/json", [FEATURE_DISABLED_HEADER]: "web.sidecar" });
        res.end(JSON.stringify({ kind: "feature_disabled", feature: "web.sidecar" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ port: (server.address() as { port: number }).port }));
    });
  });
  server.on("upgrade", (req, socket) => {
    upgrades.push(req.url ?? "");
    if (upstream.sidecarOff) {
      const body = JSON.stringify({ kind: "feature_disabled", feature: "web.sidecar" });
      socket.end(
        `HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\n${FEATURE_DISABLED_HEADER}: web.sidecar\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
      );
      return;
    }
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
    void handleProxyRequest(req, res, hub);
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
    // a refuses the first request, is marked, and the same request goes to b.
    const first = await hubGet("/hub/session/sessions");
    expect(first.status).toBe(200);
    expect((await first.json()).port).toBe(b.port);
    expect(b.seen).toEqual([{ url: "/api/sidecar/hub/sessions", token: TOKEN }]);
    expect(a.seen).toHaveLength(1);
    // a is skipped from then on.
    expect((await hubGet("/hub/session/sessions")).status).toBe(200);
    expect(a.seen).toHaveLength(1);
    expect(b.seen).toHaveLength(2);
  });

  it("replays a POST's method, headers and body on the next host after a sidecar-off refusal", async () => {
    const a = await startUpstream();
    const b = await startUpstream();
    a.sidecarOff = true;
    projects = [project("a", a.port), project("b", b.port)];
    const payload = JSON.stringify({ text: "hello", pad: "x".repeat(5000) });
    const res = await fetch(`http://127.0.0.1:${hubPort}/hub/session/sessions/s-1/turns`, {
      method: "POST",
      headers: { "X-Ndx-Token": TOKEN, "Content-Type": "application/json", "X-Custom": "kept" },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).port).toBe(b.port);
    expect(a.requests).toHaveLength(1);
    expect(b.requests).toHaveLength(1);
    const replay = b.requests[0];
    expect(replay).toMatchObject({ method: "POST", url: "/api/sidecar/hub/sessions/s-1/turns", body: payload });
    expect(replay.headers["content-type"]).toBe("application/json");
    expect(replay.headers["x-custom"]).toBe("kept");
    expect(a.requests[0].body).toBe(payload);
  });

  it("refuses a body over the buffering limit with 413 and forwards nothing", async () => {
    const a = await startUpstream();
    projects = [project("a", a.port)];
    const res = await fetch(`http://127.0.0.1:${hubPort}/hub/session/sessions/s-1/turns`, {
      method: "POST",
      headers: { "X-Ndx-Token": TOKEN, "Content-Type": "text/plain" },
      body: "x".repeat(MAX_HUB_SESSION_BODY_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(a.seen).toEqual([]);
  });

  it("answers 413, not a reset, to a chunked body with no Content-Length that outgrows the limit", async () => {
    const a = await startUpstream();
    projects = [project("a", a.port)];
    const statusLine = await new Promise<string>((resolve, reject) => {
      const socket = connect(hubPort, "127.0.0.1", () => {
        socket.write(
          `POST /hub/session/sessions/s-1/turns HTTP/1.1\r\nHost: 127.0.0.1:${hubPort}\r\n`
          + `X-Ndx-Token: ${TOKEN}\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n`,
        );
        // Keep streaming past the limit; the hub must drain it and still answer.
        const chunk = Buffer.alloc(64 * 1024, "x");
        const frame = Buffer.concat([Buffer.from(`${chunk.length.toString(16)}\r\n`), chunk, Buffer.from("\r\n")]);
        let sent = 0;
        const pump = (): void => {
          while (sent <= MAX_HUB_SESSION_BODY_BYTES + chunk.length) {
            sent += chunk.length;
            if (!socket.write(frame)) {
              socket.once("drain", pump);
              return;
            }
          }
          socket.write("0\r\n\r\n");
        };
        pump();
      });
      let buffer = "";
      socket.on("data", (data) => {
        buffer += data.toString("latin1");
        if (buffer.includes("\r\n")) {
          socket.destroy();
          resolve(buffer.split("\r\n")[0]);
        }
      });
      // A destroyed request socket surfaces here (reset) or as a close with no answer.
      socket.on("error", reject);
      socket.on("close", () => reject(new Error("connection closed before a status line")));
    });
    expect(statusLine).toBe("HTTP/1.1 413 Payload Too Large");
    expect(a.seen).toEqual([]);
  });

  it("retries a WebSocket upgrade a sidecar-off host refused on the next host before answering the client", async () => {
    const a = await startUpstream();
    const b = await startUpstream();
    a.sidecarOff = true;
    projects = [project("a", a.port), project("b", b.port)];
    expect(await wsHandshake("/hub/session/ws")).toBe("HTTP/1.1 101 Switching Protocols");
    expect(a.upgrades).toEqual(["/api/sidecar/hub/ws"]);
    expect(b.upgrades).toEqual(["/api/sidecar/hub/ws"]);
    // a stays skipped.
    expect(await wsHandshake("/hub/session/ws")).toBe("HTTP/1.1 101 Switching Protocols");
    expect(a.upgrades).toHaveLength(1);
    expect(b.upgrades).toHaveLength(2);
  });

  it("answers 403 to an upgrade when no project has web.sidecar on", async () => {
    const a = await startUpstream();
    a.sidecarOff = true;
    projects = [project("a", a.port)];
    expect(await wsHandshake("/hub/session/ws")).toBe("HTTP/1.1 403 Forbidden");
  });

  it("answers a refusal naming web.sidecar only when no healthy host remains", async () => {
    const a = await startUpstream();
    const b = await startUpstream();
    a.sidecarOff = true;
    b.sidecarOff = true;
    projects = [project("a", a.port), project("b", b.port)];
    const res = await hubGet("/hub/session/sessions"); // a refuses, then b refuses: nobody left
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.feature).toBe("web.sidecar");
    expect(body.error).toContain("web.sidecar");
    expect(a.seen).toHaveLength(1);
    expect(b.seen).toHaveLength(1);
    // Both are skipped now: the next request is answered without reaching either.
    expect((await hubGet("/hub/session/sessions")).status).toBe(403);
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
