/**
 * Frame keys through a real hub (docs/extensions/hub-api.md, "Frame keys"):
 * `POST /api/hub/extensions/:name/frame` and the proxy's `/x/<name>/~f/<key>/`.
 *
 * The hub runs with the per-user token, one registered project (a real
 * project server, so this needs a fresh build), an injected extension list
 * and launch plan, and an injected clock for the keys. The sidecar is a
 * fixture that echoes what it received.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";
import { removeTempDir } from "../helpers/temp-dir.js";
import { FRAME_CSP, startHub } from "../../src/hub/index.js";
import type { ExtensionListing, HubHandle, ListResult } from "../../src/hub/index.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const NDX_BIN = join(WEB_PKG, "dist/cli/index.js");
const MINUTE = 60_000;

const SIDECAR = [
  `const http = require("node:http");`,
  `process.stdin.resume(); process.stdin.on("end", () => process.exit(0));`,
  `const server = http.createServer((req, res) => {`,
  `  if (req.url === "/healthz") { res.writeHead(200); res.end("ok"); return; }`,
  `  const own = req.url.startsWith("/own-csp") ? { "Content-Security-Policy": "default-src 'self'", "Referrer-Policy": "unsafe-url" } : {};`,
  `  if (req.url.startsWith("/own-cors")) Object.assign(own, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true", "Vary": "Accept-Encoding" });`,
  `  if (req.method === "OPTIONS") own["X-Reached-Sidecar"] = "yes";`,
  `  res.writeHead(200, { "Content-Type": "application/json", ...own });`,
  `  res.end(JSON.stringify({ path: req.url, name: process.env.NDX_EXTENSION_NAME, headers: req.headers }));`,
  `});`,
  `server.on("upgrade", (req, socket) => {`,
  `  socket.end("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n" + JSON.stringify({ path: req.url, headers: req.headers }));`,
  `});`,
  `server.listen(Number(process.env.PORT), "127.0.0.1");`,
].join("\n");

function listing(name: string, state: ExtensionListing["state"], tab = true): ExtensionListing {
  return {
    name,
    packageName: `ndx-${name}`,
    version: "1.0.0",
    source: "user",
    state,
    reason: state === "enabled" ? "" : `${name} is ${state}`,
    dir: `/extensions/node_modules/ndx-${name}`,
    manifest: {
      apiVersion: 1,
      name,
      ndxVersion: ">=0.0.0",
      sidecar: { bin: "serve.cjs", health: "/healthz", idleStopMinutes: 15 },
      ...(tab ? { sidecarTab: { label: "Tab", path: "/tab?project={projectId}&root={repoRoot}" } } : {}),
    },
  };
}

const LISTED: ListResult = {
  ok: true,
  extensions: [
    listing("recon", "enabled"),
    listing("other", "enabled"),
    listing("plain", "enabled", false),
    listing("later", "disabled"),
    listing("pending", "unapproved"),
    listing("future", "incompatible"),
  ],
  errors: [],
};

let dir: string;
let repo: string;
let hub: HubHandle;
let token: string;
let now = 1_000_000;
/** Names the injected launch plan refuses, as core does a disabled or removed extension. */
const refused = new Set<string>();
let planned: string[] = [];

beforeAll(async () => {
  assertFreshServerBuild();
  dir = mkdtempSync(join(tmpdir(), "ndx-hub-frame-"));
  repo = mkdtempSync(join(tmpdir(), "ndx-hub-frame-repo-"));
  writeFileSync(join(dir, "serve.cjs"), SIDECAR);
  const tokenFile = join(dir, "home", "auth.token");
  hub = await startHub({
    port: 0,
    homeDir: join(dir, "home"),
    tokenFile,
    keepAlive: true,
    healthIntervalMs: 60_000,
    supervisor: { portFileTimeoutMs: 30_000, stopGraceMs: 3_000 },
    listExtensions: async () => LISTED,
    frameKeys: { now: () => now },
    sidecars: {
      plan: async (name) => {
        planned.push(name);
        if (refused.has(name)) return { ok: false, reason: "refused", error: `${name} is disabled` };
        return {
          ok: true,
          plan: {
            name,
            execPath: process.execPath,
            bin: join(dir, "serve.cjs"),
            cwd: tmpdir(),
            env: { ...process.env, NDX_EXTENSION_NAME: name },
            health: "/healthz",
            idleStopMinutes: 15,
            logFile: join(dir, "ext", name, "sidecar.log"),
          },
        };
      },
      memoryFloorBytes: 0,
      freeMemory: () => null,
      healthPollMs: 50,
      stopGraceMs: 2_000,
    },
  });
  token = readFileSync(tokenFile, "utf-8").trim();
  const reg = await fetch(`${base()}/api/hub/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ndx-Token": token },
    body: JSON.stringify({ id: "alpha", repoRoot: repo, ndxBin: NDX_BIN }),
  });
  expect(reg.status, await reg.text()).toBe(201);
}, 60_000);

afterAll(async () => {
  await hub?.close({ stopChildren: true });
  await removeTempDir(dir);
  await removeTempDir(repo);
});

beforeEach(async () => {
  refused.clear();
  // Each test starts from a stopped sidecar, so `planned` says whether a request reached it.
  for (const name of ["recon", "other"]) {
    await fetch(`${base()}/api/hub/extensions/${name}/stop`, { method: "POST", headers: { "X-Ndx-Token": token } });
  }
  planned = [];
});

function base(): string {
  return `http://127.0.0.1:${hub.port}`;
}

async function issue(name = "recon", query = "?project=alpha", prefix = ""): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base()}${prefix}/api/hub/extensions/${name}/frame${query}`, { method: "POST", headers: { "X-Ndx-Token": token } });
  return { status: res.status, body: await res.json() };
}

async function keyedUrl(name = "recon"): Promise<{ url: string; key: string }> {
  const { status, body } = await issue(name);
  expect(status, JSON.stringify(body)).toBe(200);
  const key = /^\/x\/[^/]+\/~f\/([^/]+)\//.exec(body.url)![1];
  return { url: body.url, key };
}

/** The raw answer to a WebSocket handshake on the hub; the fixture answers and closes. */
function handshake(path: string, headers = ""): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let buffer = "";
    const socket = connect(hub.port, "127.0.0.1", () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${hub.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${headers}` +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    socket.on("data", (chunk) => { buffer += chunk.toString("utf-8"); });
    socket.on("close", () => resolvePromise(buffer));
    socket.on("error", reject);
  });
}

describe("POST /api/hub/extensions/:name/frame", () => {
  it("answers { apiVersion, url, expiresAt } with the key inside the finished URL", async () => {
    for (const [query, prefix] of [["?project=alpha", ""], ["", "/p/alpha"]]) {
      const { status, body } = await issue("recon", query, prefix);
      expect(status, JSON.stringify(body)).toBe(200);
      expect(Object.keys(body).sort()).toEqual(["apiVersion", "expiresAt", "url"]);
      expect(body.apiVersion).toBe(1);
      expect(body.url).toMatch(/^\/x\/recon\/~f\/[A-Za-z0-9_-]{43}\/tab\?/);
      expect(body.url.endsWith(`/tab?project=alpha&root=${encodeURIComponent(repo)}`)).toBe(true);
      expect(Date.parse(body.expiresAt)).toBe(now + 15 * MINUTE);
    }
  });

  it("is 404 for an unregistered project, an unknown extension, one not enabled, approved and compatible, and one without a tab", async () => {
    expect((await issue("recon", "?project=ghost")).status).toBe(404);
    expect((await issue("recon", "", "/p/ghost")).status).toBe(404);
    for (const name of ["nobody", "later", "pending", "future", "plain", "Not_A_Name"]) {
      expect((await issue(name)).status, name).toBe(404);
    }
    expect((await issue("recon", "")).status).toBe(400);
  });

  it("needs the token and refuses a foreign Origin", async () => {
    expect((await fetch(`${base()}/api/hub/extensions/recon/frame?project=alpha`, { method: "POST" })).status).toBe(401);
    const foreign = await fetch(`${base()}/api/hub/extensions/recon/frame?project=alpha`, {
      method: "POST",
      headers: { "X-Ndx-Token": token, Origin: "http://evil.example" },
    });
    expect(foreign.status).toBe(403);
  });
});

describe("a frame key is refused with 401 everywhere but its own extension's paths, before any sidecar starts", () => {
  it("on /p/<id>/api/* and /api/hub/*, however it is presented", async () => {
    const { key } = await keyedUrl();
    const presentations: Array<Record<string, string>> = [
      { "X-Ndx-Token": key },
      { Authorization: `Bearer ${key}` },
      { Cookie: `ndx_token=${key}` },
    ];
    for (const headers of presentations) {
      expect((await fetch(`${base()}/p/alpha/api/status`, { headers })).status).toBe(401);
      expect((await fetch(`${base()}/p/alpha/api/sidecar/sessions/s1/cards/c1`, { method: "POST", headers })).status).toBe(401);
      expect((await fetch(`${base()}/api/hub/extensions`, { headers })).status).toBe(401);
      expect((await fetch(`${base()}/api/hub/extensions/recon/frame?project=alpha`, { method: "POST", headers })).status).toBe(401);
    }
    // The key in a project path is not a keyed path.
    expect((await fetch(`${base()}/p/alpha/~f/${key}/api/status`)).status).toBe(401);
    expect(planned).toEqual([]);
  });

  it("on another extension's /x/<other>/ path, with an unknown key, and with an expired one", async () => {
    const { key } = await keyedUrl();
    const wrongExtension = await fetch(`${base()}/x/other/~f/${key}/`);
    expect(wrongExtension.status).toBe(401);
    // A keyed refusal is a keyed response: sandboxed and Referer-free like the rest.
    expect(wrongExtension.headers.get("content-security-policy")).toBe(FRAME_CSP);
    expect(wrongExtension.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await fetch(`${base()}/x/recon/~f/${"A".repeat(43)}/`)).status).toBe(401);
    // Without the key, the plain mount still needs the token.
    expect((await fetch(`${base()}/x/recon/`)).status).toBe(401);

    now += 15 * MINUTE;
    expect((await fetch(`${base()}/x/recon/~f/${key}/`)).status).toBe(401);
    expect(planned).toEqual([]);
  });
});

describe("a keyed request", () => {
  it("reaches the sidecar with ~f/<key> stripped, X-Ndx-Base-Path set and no hub credential", async () => {
    const { url, key } = await keyedUrl();
    const res = await fetch(`${base()}${url}`, {
      headers: { "X-Ndx-Token": token, Authorization: `Bearer ${token}`, Cookie: `theme=dark; ndx_token=${token}` },
    });
    expect(res.status).toBe(200);
    const seen = await res.json();
    expect(seen.name).toBe("recon");
    expect(seen.path).toBe(url.slice(`/x/recon/~f/${key}`.length));
    expect(seen.path.startsWith("/tab?project=alpha")).toBe(true);
    expect(seen.headers["x-ndx-base-path"]).toBe(`/x/recon/~f/${key}/`);
    expect(seen.headers["x-ndx-token"]).toBeUndefined();
    expect(seen.headers.authorization).toBeUndefined();
    expect(seen.headers.cookie).toBe("theme=dark");
    expect(JSON.stringify(seen.headers)).not.toContain(token);
  });

  it("is answered with the CSP sandbox and Referrer-Policy: no-referrer, which a sidecar cannot loosen", async () => {
    const { key } = await keyedUrl();
    for (const path of ["/", "/own-csp"]) {
      const res = await fetch(`${base()}/x/recon/~f/${key}${path}`);
      expect(res.status).toBe(200);
      const csp = res.headers.get("content-security-policy")!;
      expect(csp.startsWith(FRAME_CSP)).toBe(true);
      expect(FRAME_CSP).toBe("sandbox allow-scripts allow-forms allow-popups allow-downloads");
      expect(csp).not.toContain("allow-same-origin");
      expect(csp).not.toContain("allow-top-navigation");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      await res.body?.cancel();
    }
    // The redirect to the trailing slash is keyed too.
    const bare = await fetch(`${base()}/x/recon/~f/${key}`, { redirect: "manual" });
    expect(bare.status).toBe(308);
    expect(bare.headers.get("location")).toBe(`/x/recon/~f/${key}/`);
    expect(bare.headers.get("content-security-policy")).toBe(FRAME_CSP);
    expect(bare.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("accepts the sandboxed page's Origin: null, and refuses a foreign Origin", async () => {
    const { key } = await keyedUrl();
    expect((await fetch(`${base()}/x/recon/~f/${key}/form`, { method: "POST", headers: { Origin: "null" } })).status).toBe(200);
    const foreign = await fetch(`${base()}/x/recon/~f/${key}/form`, { method: "POST", headers: { Origin: "http://evil.example" } });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("content-security-policy")).toBe(FRAME_CSP);
  });

  it("makes the sandboxed page's response readable: Allow-Origin null, Vary: Origin, never credentials, whatever the sidecar sent", async () => {
    const { key } = await keyedUrl();
    const plain = await fetch(`${base()}/x/recon/~f/${key}/data`, { headers: { Origin: "null" } });
    expect(plain.status).toBe(200);
    expect(plain.headers.get("access-control-allow-origin")).toBe("null");
    expect(plain.headers.get("vary")).toBe("Origin");
    expect(plain.headers.get("access-control-allow-credentials")).toBeNull();
    await plain.body?.cancel();

    const own = await fetch(`${base()}/x/recon/~f/${key}/own-cors`, { headers: { Origin: "null" } });
    expect(own.headers.get("access-control-allow-origin")).toBe("null");
    expect(own.headers.get("vary")).toBe("Accept-Encoding, Origin");
    expect(own.headers.get("access-control-allow-credentials")).toBeNull();
    await own.body?.cancel();

    // No Origin: nothing added.
    const none = await fetch(`${base()}/x/recon/~f/${key}/data`);
    expect(none.headers.get("access-control-allow-origin")).toBeNull();
    await none.body?.cancel();
  });

  it("answers a keyed preflight with Origin: null itself, 204, without reaching the sidecar", async () => {
    const { key } = await keyedUrl();
    const res = await fetch(`${base()}/x/recon/~f/${key}/data`, {
      method: "OPTIONS",
      headers: { Origin: "null", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type, x-custom" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("null");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-methods")).toBe("PUT");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type, x-custom");
    expect(res.headers.get("access-control-max-age")).toBe("600");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("x-reached-sidecar")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBe(FRAME_CSP);

    // A bad key is 401, not a preflight answer.
    const stale = await fetch(`${base()}/x/recon/~f/nope/data`, { method: "OPTIONS", headers: { Origin: "null", "Access-Control-Request-Method": "PUT" } });
    expect(stale.status).toBe(401);
  });

  it("slides the key's window with use, and the key goes stale after idleStopMinutes without it", async () => {
    const { key } = await keyedUrl();
    now += 10 * MINUTE;
    expect((await fetch(`${base()}/x/recon/~f/${key}/`)).status).toBe(200);
    now += 10 * MINUTE;
    expect((await fetch(`${base()}/x/recon/~f/${key}/`)).status).toBe(200);
    now += 15 * MINUTE;
    expect((await fetch(`${base()}/x/recon/~f/${key}/`)).status).toBe(401);
  });
});

describe("dropping keys", () => {
  it("drops an extension's keys when it is disabled or removed (core stops its sidecar), and only its keys", async () => {
    const { key } = await keyedUrl();
    const { key: otherKey } = await keyedUrl("other");
    expect((await fetch(`${base()}/x/recon/~f/${key}/`)).status).toBe(200);
    const stop = await fetch(`${base()}/api/hub/extensions/recon/stop`, { method: "POST", headers: { "X-Ndx-Token": token } });
    expect(stop.status).toBe(200);
    expect((await fetch(`${base()}/x/recon/~f/${key}/`)).status).toBe(401);
    expect((await fetch(`${base()}/x/other/~f/${otherKey}/`)).status).toBe(200);
  });

  it("drops them when n-dx refuses the extension's launch (a revoked approval no command named)", async () => {
    const { key } = await keyedUrl();
    refused.add("recon");
    expect((await fetch(`${base()}/x/recon/~f/${key}/`)).status).toBe(404);
    refused.delete("recon");
    expect((await fetch(`${base()}/x/recon/~f/${key}/`)).status).toBe(401);
  });
});

describe("a keyed WebSocket upgrade", () => {
  it("is piped with ~f/<key> stripped, X-Ndx-Base-Path set and no hub credential", async () => {
    const { key } = await keyedUrl();
    const answer = await handshake(`/x/recon/~f/${key}/ws?a=1`, `X-Ndx-Token: ${token}\r\nCookie: ndx_token=${token}; sid=7\r\nOrigin: null\r\n`);
    const [head, body] = answer.split("\r\n\r\n");
    expect(head.split("\r\n")[0]).toBe("HTTP/1.1 101 Switching Protocols");
    const seen = JSON.parse(body) as { path: string; headers: Record<string, string> };
    expect(seen.path).toBe("/ws?a=1");
    expect(seen.headers["x-ndx-base-path"]).toBe(`/x/recon/~f/${key}/`);
    expect(seen.headers.cookie).toBe("sid=7");
    expect(JSON.stringify(seen.headers)).not.toContain(token);
  });

  it("is refused on another extension's path, with an unknown, expired or dropped key, and with a foreign Origin", async () => {
    const status = async (path: string, headers = ""): Promise<string> => (await handshake(path, headers)).split("\r\n")[0];
    const { key } = await keyedUrl();
    expect(await status(`/x/other/~f/${key}/ws`)).toBe("HTTP/1.1 401 Unauthorized");
    expect(await status(`/x/recon/~f/${"A".repeat(43)}/ws`)).toBe("HTTP/1.1 401 Unauthorized");
    expect(await status(`/x/recon/~f/${key}/ws`, "Origin: http://evil.example\r\n")).toBe("HTTP/1.1 403 Forbidden");
    expect(planned).toEqual([]);

    now += 15 * MINUTE;
    expect(await status(`/x/recon/~f/${key}/ws`)).toBe("HTTP/1.1 401 Unauthorized");

    const { key: fresh } = await keyedUrl();
    await fetch(`${base()}/api/hub/extensions/recon/stop`, { method: "POST", headers: { "X-Ndx-Token": token } });
    expect(await status(`/x/recon/~f/${fresh}/ws`)).toBe("HTTP/1.1 401 Unauthorized");
    expect(planned).toEqual([]);
  });
});
