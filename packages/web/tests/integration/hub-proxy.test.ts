/**
 * Hub reverse proxy — /p/:id/*, the sole-project root alias, and the
 * WebSocket upgrade path.
 *
 * The child here is a stub speaking the child contract (port file,
 * /api/status) extended to echo what it receives — method, path, headers,
 * body — so every proxy property is observable from the outside: the /p/:id
 * prefix is stripped, query strings survive, POST bodies stream through,
 * browser-origin metadata is removed after the hub's own edge gate, and the
 * upgrade handshake reaches the child and pipes bytes both ways.
 *
 * The real `web serve` behind the hub is deliberately not booted here — the
 * hub's contract is the child interface, and the dashboard's own behaviour
 * at / is covered by its direct suites (see hub-daemon.test.ts for the same
 * argument on spawn/attach).
 *
 * @see packages/web/src/hub/proxy.ts
 * @see packages/web/src/hub/hub.ts — routing and root alias
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHub, type HubHandle } from "../../src/hub/hub.js";

/**
 * A stub child that echoes requests and speaks just enough RFC 6455 to
 * prove the upgrade was proxied: it completes the handshake and sends one
 * unmasked text frame ("hello <path>"), then echoes raw bytes back.
 */
const ECHO_SERVER = `
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.argv[process.argv.length - 1];

const server = createServer((req, res) => {
  if (req.url === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, pid: process.pid }));
    return;
  }
  let body = "";
  req.setEncoding("utf-8");
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      echo: true,
      method: req.method,
      url: req.url,
      body,
      origin: req.headers.origin ?? null,
      secFetchSite: req.headers["sec-fetch-site"] ?? null,
      host: req.headers.host ?? null,
    }));
  });
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\\r\\n" +
    "Upgrade: websocket\\r\\nConnection: Upgrade\\r\\n" +
    "Sec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n",
  );
  const greeting = Buffer.from("hello " + req.url);
  socket.write(Buffer.concat([Buffer.from([0x81, greeting.length]), greeting]));
  socket.on("data", (chunk) => socket.write(chunk)); // raw echo
});

server.listen(0, "127.0.0.1", () => {
  writeFileSync(join(repoRoot, ".n-dx-web.port"), String(server.address().port) + "\\n");
});
process.on("SIGTERM", () => process.exit(0));
`;

const hubUrl = (hub: HubHandle, path: string) => `http://127.0.0.1:${hub.port}${path}`;

interface EchoBody {
  echo: boolean;
  method: string;
  url: string;
  body: string;
  origin: string | null;
  secFetchSite: string | null;
  host: string | null;
}

async function register(hub: HubHandle, id: string, repoRoot: string, ndxBin: string): Promise<void> {
  const res = await fetch(hubUrl(hub, "/api/hub/projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, repoRoot, ndxBin }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
}

/**
 * Open a WebSocket upgrade against the hub and collect the child's greeting
 * frame plus the echo of one byte sequence we send.
 */
function wsRoundTrip(port: number, path: string): Promise<{ status: number; received: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": Buffer.from("0123456789abcdef").toString("base64"),
        "Sec-WebSocket-Version": "13",
      },
    });
    req.on("response", (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, received: Buffer.alloc(0) });
    });
    req.on("upgrade", (res, socket, head) => {
      // Bytes the child sent right after the 101 (its greeting frame) arrive
      // in `head`, not as a later data event.
      const chunks: Buffer[] = [head];
      const probe = Buffer.from("ping-bytes");
      socket.write(probe);
      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        const all = Buffer.concat(chunks);
        // greeting frame (2-byte header + payload) then the raw echo
        if (all.includes(probe)) {
          socket.destroy();
          resolve({ status: res.statusCode ?? 101, received: all });
        }
      });
      socket.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("hub reverse proxy", () => {
  let baseDir: string;
  let stubBin: string;
  let repoA: string;
  let repoB: string;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ndx-hub-proxy-"));
    stubBin = join(baseDir, "echo-server.mjs");
    repoA = await mkdtemp(join(baseDir, "repo-a-"));
    repoB = await mkdtemp(join(baseDir, "repo-b-"));
    await writeFile(stubBin, ECHO_SERVER, "utf-8");
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("proxies /p/:id/* with the prefix stripped and everything else intact", async () => {
    const hub = await startHub(0, { hubDir: join(baseDir, "state-1"), quiet: true, healthCheckIntervalMs: 60_000 });
    try {
      await register(hub, "alpha", repoA, stubBin);

      // Path stripped, query preserved.
      const get = await fetch(hubUrl(hub, "/p/alpha/api/search?q=hub%20proxy"));
      expect(get.status).toBe(200);
      const gotten = (await get.json()) as EchoBody;
      expect(gotten.url).toBe("/api/search?q=hub%20proxy");

      // POST body streams through; browser-origin metadata is stripped after
      // the hub's own edge gate accepted it (hub-port origin = trusted).
      const post = await fetch(hubUrl(hub, "/p/alpha/api/things"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: `http://127.0.0.1:${hub.port}`,
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({ n: 42 }),
      });
      expect(post.status).toBe(200);
      const posted = (await post.json()) as EchoBody;
      expect(posted.method).toBe("POST");
      expect(posted.body).toBe('{"n":42}');
      expect(posted.origin, "Origin must not reach the child").toBeNull();
      expect(posted.secFetchSite, "Sec-Fetch-* must not reach the child").toBeNull();
      expect(posted.host).toContain("127.0.0.1"); // rewritten to the child

      // Bare /p/:id redirects into the slashed form (document base).
      const bare = await fetch(hubUrl(hub, "/p/alpha"), { redirect: "manual" });
      expect(bare.status).toBe(308);
      expect(bare.headers.get("location")).toBe("/p/alpha/");

      // Unknown project.
      const unknown = await fetch(hubUrl(hub, "/p/nope/api/status"));
      expect(unknown.status).toBe(404);

      // WebSocket upgrade under the project prefix.
      const ws = await wsRoundTrip(hub.port, "/p/alpha/live?x=1");
      expect(ws.status).toBe(101);
      expect(ws.received.toString()).toContain("hello /live?x=1");
      expect(ws.received.toString()).toContain("ping-bytes");
    } finally {
      await hub.close();
    }
  }, 60_000);

  it("rejects a cross-origin mutation at the edge, before any child sees it", async () => {
    const hub = await startHub(0, { hubDir: join(baseDir, "state-1"), quiet: true, healthCheckIntervalMs: 60_000 });
    try {
      const evil = await fetch(hubUrl(hub, "/p/alpha/api/things"), {
        method: "POST",
        headers: { Origin: "http://evil.example" },
        body: "{}",
      });
      expect(evil.status).toBe(403);
    } finally {
      await hub.close();
    }
  }, 60_000);

  it("aliases the root to the sole registered project, transparently", async () => {
    const hub = await startHub(0, { hubDir: join(baseDir, "state-1"), quiet: true, healthCheckIntervalMs: 60_000 });
    try {
      // state-1 still has alpha registered from the first test's registry.
      const status = await fetch(hubUrl(hub, "/api/status"));
      expect(status.status).toBe(200);
      expect(((await status.json()) as { ok?: boolean }).ok).toBe(true);

      const mcp = await fetch(hubUrl(hub, "/mcp/rex"), { method: "POST", body: "{}" });
      expect(((await mcp.json()) as EchoBody).url).toBe("/mcp/rex");

      const page = await fetch(hubUrl(hub, "/prd/task-1"));
      expect(((await page.json()) as EchoBody).url).toBe("/prd/task-1");

      // The hub's own API is never shadowed by the alias.
      const health = await fetch(hubUrl(hub, "/api/hub/health"));
      expect(health.status).toBe(200);

      // Root WebSocket upgrade reaches the sole project too.
      const ws = await wsRoundTrip(hub.port, "/");
      expect(ws.status).toBe(101);
      expect(ws.received.toString()).toContain("hello /");
    } finally {
      await hub.close();
    }
  }, 60_000);

  it("with several projects, root APIs answer 409 and / serves the home page", async () => {
    const hub = await startHub(0, { hubDir: join(baseDir, "state-1"), quiet: true, healthCheckIntervalMs: 60_000 });
    try {
      await register(hub, "beta", repoB, stubBin);

      for (const path of ["/api/status", "/data/prd.json", "/mcp/rex"]) {
        const res = await fetch(hubUrl(hub, path));
        expect(res.status, path).toBe(409);
        const body = (await res.json()) as { projects: string[] };
        expect(body.projects.sort()).toEqual(["alpha", "beta"]);
      }

      const home = await fetch(hubUrl(hub, "/"));
      expect(home.status).toBe(200);
      expect(home.headers.get("content-type")).toContain("text/html");
      const html = await home.text();
      expect(html).toContain("/p/alpha/");
      expect(html).toContain("/p/beta/");

      // Scoped access still works with several projects registered.
      const scoped = await fetch(hubUrl(hub, "/p/beta/api/status"));
      expect(scoped.status).toBe(200);
    } finally {
      await hub.close();
    }
  }, 60_000);
});
