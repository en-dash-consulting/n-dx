/**
 * The hub daemon end to end: register projects, real child servers come up,
 * list, delete, shutdown, and restart with re-attach/respawn.
 *
 * Children are the compiled `dist/cli/index.js serve`, so this needs a fresh
 * build (see built-server-guard.ts). Each child is a full dashboard server on
 * an ephemeral port; startup takes a second or two, hence the long timeouts.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";
import { startHub, isPidAlive, loadRegistry, readHubPidFile, hubPidPath } from "../../src/hub/index.js";
import type { HubHandle, ProjectView } from "../../src/hub/index.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const NDX_BIN = join(WEB_PKG, "dist/cli/index.js");

const HUB_OPTS = {
  port: 0,
  healthIntervalMs: 60_000,
  supervisor: { portFileTimeoutMs: 30_000, stopGraceMs: 3_000 },
};

let home: string;
let repoA: string;
let repoB: string;
const hubs: HubHandle[] = [];

async function api(hub: HubHandle, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${hub.port}${path}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function register(hub: HubHandle, id: string, repoRoot: string): Promise<ProjectView> {
  const { status, body } = await api(hub, "/api/hub/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, repoRoot, ndxBin: NDX_BIN }),
  });
  expect([200, 201], JSON.stringify(body)).toContain(status);
  return body.project as ProjectView;
}

async function waitForExit(pid: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`pid ${pid} still alive after ${timeoutMs}ms`);
}

beforeAll(() => {
  assertFreshServerBuild();
  home = mkdtempSync(join(tmpdir(), "ndx-hub-home-"));
  repoA = mkdtempSync(join(tmpdir(), "ndx-hub-repo-a-"));
  repoB = mkdtempSync(join(tmpdir(), "ndx-hub-repo-b-"));
});

afterEach(async () => {
  // Every test closes its own hubs; this is the safety net for a failed assertion.
  while (hubs.length) await hubs.pop()!.close({ stopChildren: true });
});

describe("hub daemon", () => {
  it("registers two projects, brings both servers up, lists them, stops one, stops the rest on shutdown", async () => {
    const hub = await startHub({ ...HUB_OPTS, homeDir: home });
    hubs.push(hub);

    const health = await api(hub, "/api/hub/health");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, pid: process.pid, port: hub.port, projects: 0 });
    expect(readHubPidFile(hubPidPath(home))).toMatchObject({ pid: process.pid, port: hub.port });

    const a = await register(hub, "alpha", repoA);
    const b = await register(hub, "beta", repoB);
    for (const p of [a, b]) {
      expect(p.status.state, JSON.stringify(p.status)).toBe("healthy");
      expect(p.port).toBeGreaterThan(0);
      expect(p.pid).toBeGreaterThan(0);
    }
    expect(a.port).not.toBe(b.port);

    // Each child really is a dashboard server for its directory.
    const statusA = await (await fetch(`http://127.0.0.1:${a.port}/api/status`)).json();
    expect(statusA.projectDir).toBe(repoA);

    const list = await api(hub, "/api/hub/projects");
    expect(list.body.projects.map((p: ProjectView) => [p.id, p.port])).toEqual([["alpha", a.port], ["beta", b.port]]);

    // The registry on disk carries pid and port.
    const persisted = loadRegistry(hub.registryPath);
    expect(persisted.projects.alpha).toMatchObject({ repoRoot: repoA, pid: a.pid, port: a.port, ndxBin: NDX_BIN });

    // Delete stops that child and forgets it.
    const del = await api(hub, "/api/hub/projects/alpha", { method: "DELETE" });
    expect(del.status).toBe(200);
    await waitForExit(a.pid!);
    expect((await api(hub, "/api/hub/projects")).body.projects.map((p: ProjectView) => p.id)).toEqual(["beta"]);
    expect((await api(hub, "/api/hub/projects/alpha", { method: "DELETE" })).status).toBe(404);
    expect(loadRegistry(hub.registryPath).projects.alpha).toBeUndefined();

    // Shutdown stops the rest and removes the hub pid file.
    await hub.close();
    hubs.pop();
    await waitForExit(b.pid!);
    expect(readHubPidFile(hubPidPath(home))).toBeNull();
    // The registry keeps beta, unrunning, for the next hub start.
    expect(loadRegistry(hub.registryPath).projects.beta).toMatchObject({ pid: null, port: null });
  }, 120_000);

  it("re-attaches to a live child on restart and respawns a dead one", async () => {
    const first = await startHub({ ...HUB_OPTS, homeDir: home });
    hubs.push(first);
    const registered = await register(first, "beta", repoB);
    expect(registered.status.state).toBe("healthy");
    const { pid, port } = registered;

    // Hub goes away, child keeps serving.
    await first.close({ stopChildren: false });
    hubs.pop();
    expect(isPidAlive(pid!)).toBe(true);

    const second = await startHub({ ...HUB_OPTS, homeDir: home });
    hubs.push(second);
    const attached = (await api(second, "/api/hub/projects/beta")).body.project as ProjectView;
    expect(attached.status).toMatchObject({ state: "healthy", attached: true });
    expect([attached.pid, attached.port]).toEqual([pid, port]);

    // Child dies behind the hub's back; the next hub start finds a dead pid and respawns.
    await second.close({ stopChildren: false });
    hubs.pop();
    process.kill(pid!, "SIGKILL");
    await waitForExit(pid!);

    const third = await startHub({ ...HUB_OPTS, homeDir: home });
    hubs.push(third);
    const respawned = (await api(third, "/api/hub/projects/beta")).body.project as ProjectView;
    expect(respawned.status).toMatchObject({ state: "healthy", attached: false });
    expect(respawned.pid).not.toBe(pid);
    expect(isPidAlive(respawned.pid!)).toBe(true);

    await third.close();
    hubs.pop();
    await waitForExit(respawned.pid!);
  }, 180_000);

  it("rejects malformed registrations and unknown routes", async () => {
    const hub = await startHub({ ...HUB_OPTS, homeDir: mkdtempSync(join(tmpdir(), "ndx-hub-home-2-")) });
    hubs.push(hub);

    const bad = await api(hub, "/api/hub/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "x", repoRoot: "relative", ndxBin: NDX_BIN }),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/repoRoot/);

    expect((await api(hub, "/api/hub/projects", { method: "POST", body: "{ nope" })).status).toBe(400);
    expect((await api(hub, "/api/hub/projects/nope")).status).toBe(404);
    expect((await api(hub, "/api/hub/nothing")).status).toBe(405);
    expect((await api(hub, "/api/other")).status).toBe(404);
    await hub.close();
    hubs.pop();
  }, 30_000);
});

afterAll(() => {
  for (const dir of [home, repoA, repoB]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
