/**
 * The hub keeps tracker sync ticking (story 45): every registered project
 * whose local config sets a rule not off gets `POST /api/tracker/sync/tick`
 * through the hub's own proxy with the per-user token, on start and then each
 * interval; a project with every rule off gets none, and a server that is not
 * healthy is skipped. The children enforce the token as the real server does.
 */

import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registryPath, startHub, type HubHandle } from "../../src/hub/index.js";

interface Child {
  server: Server;
  port: number;
  dir: string;
  /** Tick requests that arrived, as "METHOD path token". */
  ticks: string[];
}

async function startChild(prefix: string, token: string, options: { healthy: boolean }): Promise<Child> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const ticks: string[] = [];
  const server = createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-ndx-token"] !== token) return json(401, { error: "unauthorized" });
    if (url === "/api/status") return options.healthy ? json(200, { projectDir: dir }) : json(503, { error: "down" });
    if (url === "/api/tracker/sync/tick") {
      // The prefix is set only by the hub's proxy: a tick posted straight to the child would carry none.
      ticks.push(`${req.method} ${url} ${req.headers["x-ndx-token"]} via ${req.headers["x-forwarded-prefix"] ?? "(direct)"}`);
      return json(200, { state: "ran", entries: [], queued: 0 });
    }
    json(404, { error: "not found" });
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
  return { server, port, dir, ticks };
}

function rules(child: Child, value: Record<string, string>): void {
  writeFileSync(join(child.dir, ".n-dx.local.json"), JSON.stringify({ trackerSync: { connection: "caos", rules: value } }));
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("hub tracker sync clock", () => {
  let home: string;
  let token: string;
  let on: Child;
  let off: Child;
  let down: Child;
  let hub: HubHandle | null = null;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "hub-tracker-sync-"));
    token = "t".repeat(48);
    writeFileSync(join(home, "auth.token"), token + "\n", { mode: 0o600 });
    on = await startChild("hub-tracker-on-", token, { healthy: true });
    off = await startChild("hub-tracker-off-", token, { healthy: true });
    down = await startChild("hub-tracker-down-", token, { healthy: false });
    rules(on, { "run-started": "dry-run", "pr-merged": "off" });
    rules(off, { "run-started": "off" });
    rules(down, { "pr-merged": "on" });
    // Adopted children; the down one records no pid, so the hub never stops or kills a process for it.
    const record = (id: string, c: Child, pid: number | null) => ({
      id, name: id, repoRoot: c.dir, worktrees: [c.dir], port: c.port, pid, lastSeen: null,
    });
    writeFileSync(registryPath(home), JSON.stringify({
      version: 1,
      projects: { on: record("on", on, process.pid), off: record("off", off, process.pid), down: record("down", down, null) },
    }));
  });

  afterEach(async () => {
    await hub?.close({ stopChildren: false });
    hub = null;
    for (const child of [on, off, down]) {
      await new Promise<void>((resolve) => child.server.close(() => resolve()));
      rmSync(child.dir, { recursive: true, force: true });
    }
    rmSync(home, { recursive: true, force: true });
  });

  it("ticks only a healthy project with a rule on, through the proxy with the per-user token, then each interval", async () => {
    hub = await startHub({ port: 0, homeDir: home, tokenFile: join(home, "auth.token"), healthIntervalMs: 40, trackerSync: { intervalMs: 300 } });

    await waitFor(() => on.ticks.length >= 1, 4_000);
    expect(on.ticks[0]).toBe(`POST /api/tracker/sync/tick ${token} via /p/on`);
    // A second tick comes only after the interval.
    await waitFor(() => on.ticks.length >= 2, 4_000);
    expect(off.ticks).toEqual([]);
    expect(down.ticks).toEqual([]);
  });
});
