/**
 * Extension sidecars in the hub: lazy start on `/x/<name>/`, health wait and
 * its 503, idle stop, crash restart with backoff, the memory floor, and
 * shutdown; the proxy's token check, credential stripping and base path. The sidecar is a small fixture script; the launch plan is
 * injected, standing in for `ndx extensions sidecar <name> --json` (tested in
 * the root suite, tests/e2e/cli-extensions.test.js). `ndxCliPlanner` is
 * exercised against a fake CLI that prints what core prints.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SidecarManager, isPidAlive, ndxCliPlanner, startHub } from "../../src/hub/index.js";
import type { HubHandle, PlanResult, SidecarManagerOptions, SidecarPlan } from "../../src/hub/index.js";

const FIXTURE = [
  `const http = require("node:http");`,
  `const mode = process.env.SIDECAR_MODE;`,
  `if (mode === "crash") { console.log("crashing"); process.exit(3); }`,
  `if (mode === "never-healthy") { console.log("hanging"); setInterval(() => {}, 1000); }`,
  `else {`,
  `  const server = http.createServer((req, res) => {`,
  `    if (req.url === "/healthz") { res.writeHead(200); res.end("ok"); return; }`,
  `    if (req.url === "/die") { res.writeHead(200); res.end("bye", () => process.exit(1)); return; }`,
  `    res.writeHead(200, { "Content-Type": "application/json" });`,
  `    res.end(JSON.stringify({ path: req.url, port: process.env.PORT, name: process.env.NDX_EXTENSION_NAME, headers: req.headers }));`,
  `  });`,
  `  server.on("upgrade", (req, socket) => {`,
  `    socket.end("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n" + JSON.stringify({ path: req.url, headers: req.headers }));`,
  `  });`,
  `  server.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("listening on " + process.env.PORT));`,
  `}`,
].join("\n");

let dir: string;
let bin: string;
const managers: SidecarManager[] = [];
const hubs: HubHandle[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ndx-hub-sidecars-"));
  bin = join(dir, "serve.cjs");
  writeFileSync(bin, FIXTURE);
});

afterEach(async () => {
  while (hubs.length) await hubs.pop()!.close({ stopChildren: true });
  while (managers.length) await managers.pop()!.stopAll();
  rmSync(dir, { recursive: true, force: true });
});

function planFor(name: string, mode = "ok", idleStopMinutes = 15): SidecarPlan {
  return {
    name,
    execPath: process.execPath,
    bin,
    cwd: dir,
    env: { ...process.env, NDX_EXTENSION_NAME: name, SIDECAR_MODE: mode },
    health: "/healthz",
    idleStopMinutes,
    logFile: join(dir, "ext", name, "logs", "sidecar.log"),
  };
}

/** A manager whose plan is `mode` for every name, counting how often it was asked. */
function manager(mode = "ok", overrides: Partial<SidecarManagerOptions> = {}): { m: SidecarManager; asked: () => number } {
  let asked = 0;
  const m = new SidecarManager({
    plan: async (name): Promise<PlanResult> => {
      asked++;
      return { ok: true, plan: planFor(name, mode) };
    },
    memoryFloorBytes: 0,
    freeMemory: () => null,
    startTimeoutMs: 10_000,
    healthPollMs: 50,
    stopGraceMs: 2_000,
    ...overrides,
  });
  managers.push(m);
  return { m, asked: () => asked };
}

/** A `log` option and a promise of the first line containing `text`: a gate on the event, not on a clock. */
function logGate(text: string): { log: (message: string) => void; seen: Promise<void> } {
  let resolveSeen!: () => void;
  const seen = new Promise<void>((resolve) => {
    resolveSeen = resolve;
  });
  return { log: (message) => { if (message.includes(text)) resolveSeen(); }, seen };
}

describe("SidecarManager", () => {
  it("starts on first use on a loopback port and waits for health; concurrent first requests share one start", async () => {
    const { m, asked } = manager();
    const [a, b] = await Promise.all([m.ensure("recon"), m.ensure("recon")]);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect(asked()).toBe(1);

    const port = (a as { port: number }).port;
    const body = await (await fetch(`http://127.0.0.1:${port}/anything`)).json();
    expect(body).toMatchObject({ path: "/anything", port: String(port), name: "recon" });

    const [status] = m.list();
    expect(status).toMatchObject({ name: "recon", state: "running", port });
    expect(isPidAlive(status.pid!)).toBe(true);
    // The fixture logs before it can answer health, and stdout to a file is synchronous.
    const log = readFileSync(planFor("recon").logFile, "utf-8");
    expect(log).toContain(`starting ${bin} on port ${port}`);
    expect(log).toContain(`listening on ${port}`);
  });

  it("answers 503 naming the log file when health never answers, and stops the process", async () => {
    const { m } = manager("never-healthy", { startTimeoutMs: 1_000 });
    const result = await m.ensure("recon");
    const logFile = planFor("recon").logFile;
    expect(result).toMatchObject({ ok: false, status: 503, logFile });
    expect((result as { error: string }).error).toBe(`The recon sidecar did not answer /healthz within 1s. See ${logFile}`);
    expect(m.list()[0]).toMatchObject({ state: "stopped", pid: null, recentCrashes: 1 });
  });

  it("stops an idle sidecar after idleStopMinutes, but never one with a request in flight or an open WebSocket", async () => {
    let now = 1_000_000;
    const { m } = manager("ok", { now: () => now });
    const started = await m.ensure("recon");
    expect(started.ok).toBe(true);
    const pid = m.list()[0].pid!;

    now += 15 * 60_000;
    m.openSocket("recon");
    await m.sweepIdle();
    expect(m.list()[0].state).toBe("running");
    m.closeSocket("recon");

    m.beginRequest("recon");
    now += 15 * 60_000;
    await m.sweepIdle();
    expect(m.list()[0].state).toBe("running");
    m.endRequest("recon");

    now += 14 * 60_000;
    await m.sweepIdle();
    expect(m.list()[0].state).toBe("running");
    now += 60_000;
    await m.sweepIdle();
    expect(m.list()[0]).toMatchObject({ state: "stopped", recentCrashes: 0 });
    // sweepIdle resolves once the stop has waited for the exit.
    expect(isPidAlive(pid)).toBe(false);
  });

  it("restarts a crashed sidecar on the next request", async () => {
    const exited = logGate("exited with code 1");
    const { m, asked } = manager("ok", { log: exited.log });
    const first = await m.ensure("recon");
    const pid = m.list()[0].pid!;
    await fetch(`http://127.0.0.1:${(first as { port: number }).port}/die`).then((r) => r.text());
    await exited.seen;
    expect(m.list()[0].state).toBe("stopped");
    expect(m.list()[0]).toMatchObject({ recentCrashes: 1, lastError: "exited with code 1" });

    const second = await m.ensure("recon");
    expect(second.ok).toBe(true);
    expect(m.list()[0].pid).not.toBe(pid);
    expect(asked()).toBe(2);
  });

  it("backs off after three crashes in five minutes, and starts again once they age out", async () => {
    let now = 5_000_000;
    const { m, asked } = manager("crash", { now: () => now });
    for (let i = 0; i < 3; i++) {
      const result = await m.ensure("recon");
      expect(result).toMatchObject({ ok: false, status: 503 });
      expect((result as { error: string }).error).toMatch(/^The recon sidecar exited with code 3 before answering \/healthz\. See /);
      now += 10_000;
    }
    expect(asked()).toBe(3);

    const refused = await m.ensure("recon");
    expect(refused).toMatchObject({ ok: false, status: 503, retryAfterSeconds: 270 });
    expect((refused as { error: string }).error).toMatch(/^The recon sidecar crashed 3 times in the last 5 minutes; the hub tries again in 270s\. See .*sidecar\.log$/);
    expect(asked()).toBe(3);

    now += 270_000;
    await m.ensure("recon");
    expect(asked()).toBe(4);
  });

  it("refuses to start below the memory floor, without asking n-dx", async () => {
    const { m, asked } = manager("ok", { memoryFloorBytes: 2 * 1024 ** 3, freeMemory: () => 512 * 1024 ** 2 });
    const result = await m.ensure("recon");
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect((result as { error: string }).error).toBe(
      "Not starting the recon sidecar: 512 MB of memory is available, at or below the hub's memory floor of 2048 MB (hub.memoryFloorBytes). Free some memory, or lower the floor.",
    );
    expect(asked()).toBe(0);
    expect(m.list()[0].pid).toBeNull();
  });

  it("answers the plan's refusals as 404 with core's reason, and 503 with no n-dx CLI to ask", async () => {
    const refusing = new SidecarManager({
      plan: async (name) => (name === "ghost"
        ? { ok: false, reason: "none", error: "Error: No installed extension named 'ghost' declares a sidecar" }
        : { ok: false, reason: "refused", error: "Error: unapproved — fix: ndx extensions enable recon" }),
      memoryFloorBytes: 0,
      freeMemory: () => null,
    });
    expect(await refusing.ensure("ghost")).toMatchObject({ ok: false, status: 404, reason: "none" });
    expect(await refusing.ensure("recon")).toMatchObject({
      ok: false,
      status: 404,
      reason: "refused",
      error: "Error: unapproved — fix: ndx extensions enable recon",
    });

    const blind = new SidecarManager({ plan: null, memoryFloorBytes: 0, freeMemory: () => null });
    expect(await blind.ensure("recon")).toMatchObject({ ok: false, status: 503, error: expect.stringMatching(/without an n-dx CLI/) });
    expect(await blind.ensure("Not_A_Name")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("ndxCliPlanner", () => {
  it("parses core's plan, and its refusal", async () => {
    const cli = join(dir, "fake-cli.cjs");
    writeFileSync(cli, [
      `const name = process.argv[4];`,
      `if (process.argv[2] !== "extensions" || process.argv[3] !== "sidecar" || process.argv[5] !== "--json") process.exit(9);`,
      `if (name === "recon") { console.log(JSON.stringify({ name, bin: "/x/serve.js", health: "/", idleStopMinutes: 15 })); process.exit(0); }`,
      `console.log(JSON.stringify({ error: "Error: no sidecar", reason: "none" })); console.error("Error: no sidecar"); process.exit(2);`,
    ].join("\n"));
    const plan = ndxCliPlanner(cli, dir);
    expect(await plan("recon")).toMatchObject({ ok: true, plan: { name: "recon", bin: "/x/serve.js" } });
    expect(await plan("ghost")).toEqual({ ok: false, reason: "none", error: "Error: no sidecar" });
  });
});

describe("hub /x/<name>/", () => {
  it("starts the sidecar on the first request, forwards with the prefix stripped, and stops it on close", async () => {
    let asked = 0;
    const hub = await startHub({
      port: 0,
      homeDir: join(dir, "home"),
      keepAlive: true,
      healthIntervalMs: 60_000,
      sidecars: {
        plan: async (name) => {
          asked++;
          return { ok: true, plan: planFor(name) };
        },
        memoryFloorBytes: 0,
        freeMemory: () => null,
        healthPollMs: 50,
        stopGraceMs: 2_000,
      },
    });
    hubs.push(hub);

    const res = await fetch(`http://127.0.0.1:${hub.port}/x/recon/page?q=1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ path: "/page?q=1", name: "recon" });
    // The bare mount redirects to its trailing slash, so the app's relative links resolve under it.
    const bare = await fetch(`http://127.0.0.1:${hub.port}/x/recon?q=2`, { redirect: "manual" });
    expect(bare.status).toBe(308);
    expect(bare.headers.get("location")).toBe("/x/recon/?q=2");
    expect((await (await fetch(`http://127.0.0.1:${hub.port}/x/recon`)).json()).path).toBe("/");
    expect(asked).toBe(1);

    const bad = await fetch(`http://127.0.0.1:${hub.port}/x/Bad_Name/`);
    expect(bad.status).toBe(404);
    expect(await bad.json()).toMatchObject({ reason: "none" });

    const served = await fetch(`http://127.0.0.1:${hub.port}/x/recon/`).then((r) => r.json());
    expect(readFileSync(planFor("recon").logFile, "utf-8")).toContain("starting");

    hubs.pop();
    await hub.close({ stopChildren: false });
    // No sidecar survives its hub, whatever happens to the project servers.
    const port = Number(served.port);
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
  });

  it("answers a refused start with its status, error and log file", async () => {
    const hub = await startHub({
      port: 0,
      homeDir: join(dir, "home"),
      keepAlive: true,
      healthIntervalMs: 60_000,
      sidecars: {
        plan: async (name) => ({ ok: true, plan: planFor(name, "crash") }),
        memoryFloorBytes: 0,
        freeMemory: () => null,
        healthPollMs: 50,
      },
    });
    hubs.push(hub);

    const res = await fetch(`http://127.0.0.1:${hub.port}/x/recon/`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.log).toBe(planFor("recon").logFile);
    expect(body.error).toContain(body.log);
  });

  it("answers a disabled or unapproved name 404 with the reason", async () => {
    const hub = await startHub({
      port: 0,
      homeDir: join(dir, "home"),
      keepAlive: true,
      healthIntervalMs: 60_000,
      sidecars: {
        plan: async () => ({ ok: false, reason: "refused", error: "Error: the sidecar of recon is not started: it is disabled" }),
        memoryFloorBytes: 0,
        freeMemory: () => null,
      },
    });
    hubs.push(hub);

    const res = await fetch(`http://127.0.0.1:${hub.port}/x/recon/`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Error: the sidecar of recon is not started: it is disabled", reason: "refused" });
  });

  describe("with the per-user token", () => {
    let hub: HubHandle;
    let token: string;
    let asked: number;

    beforeEach(async () => {
      asked = 0;
      const tokenFile = join(dir, "home", "auth.token");
      hub = await startHub({
        port: 0,
        homeDir: join(dir, "home"),
        tokenFile,
        keepAlive: true,
        healthIntervalMs: 60_000,
        sidecars: {
          plan: async (name) => {
            asked++;
            return { ok: true, plan: planFor(name) };
          },
          memoryFloorBytes: 0,
          freeMemory: () => null,
          healthPollMs: 50,
          stopGraceMs: 2_000,
        },
      });
      hubs.push(hub);
      token = readFileSync(tokenFile, "utf-8").trim();
    });

    /** The raw response to a WebSocket handshake; the fixture answers and closes, so the end of the socket is the end of the answer. */
    function handshake(path: string, headers: string): Promise<string> {
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

    it("refuses a request without the token before the sidecar is started", async () => {
      expect((await fetch(`http://127.0.0.1:${hub.port}/x/recon/`)).status).toBe(401);
      expect((await handshake("/x/recon/ws", "")).split("\r\n")[0]).toBe("HTTP/1.1 401 Unauthorized");
      // Never asked for a plan, so nothing was started.
      expect(asked).toBe(0);
    });

    it("forwards HTTP without the token header, cookie or bearer, and with X-Ndx-Base-Path", async () => {
      const viaHeader = await fetch(`http://127.0.0.1:${hub.port}/x/recon/page`, {
        headers: { "X-Ndx-Token": token, Cookie: `theme=dark; ndx_token=${token}; sid=7`, "X-Ndx-Base-Path": "/forged/" },
      });
      expect(viaHeader.status).toBe(200);
      const seen = (await viaHeader.json()).headers as Record<string, string>;
      expect(seen["x-ndx-token"]).toBeUndefined();
      expect(seen.cookie).toBe("theme=dark; sid=7");
      expect(seen["x-ndx-base-path"]).toBe("/x/recon/");

      const viaBearer = await fetch(`http://127.0.0.1:${hub.port}/x/recon/`, { headers: { Authorization: `Bearer ${token}`, Cookie: `ndx_token=${token}` } });
      const bearerSeen = (await viaBearer.json()).headers as Record<string, string>;
      expect(bearerSeen.authorization).toBeUndefined();
      expect(bearerSeen.cookie).toBeUndefined();
      expect(JSON.stringify(bearerSeen)).not.toContain(token);
    });

    it("pipes a WebSocket with the prefix stripped, the token removed and X-Ndx-Base-Path added", async () => {
      const answer = await handshake("/x/recon/ws?a=1", `X-Ndx-Token: ${token}\r\nCookie: ndx_token=${token}; sid=7\r\n`);
      const [head, body] = answer.split("\r\n\r\n");
      expect(head.split("\r\n")[0]).toBe("HTTP/1.1 101 Switching Protocols");
      const seen = JSON.parse(body) as { path: string; headers: Record<string, string> };
      expect(seen.path).toBe("/ws?a=1");
      expect(seen.headers["x-ndx-token"]).toBeUndefined();
      expect(seen.headers.cookie).toBe("sid=7");
      expect(seen.headers["x-ndx-base-path"]).toBe("/x/recon/");
      expect(JSON.stringify(seen.headers)).not.toContain(token);
    });
  });
});
