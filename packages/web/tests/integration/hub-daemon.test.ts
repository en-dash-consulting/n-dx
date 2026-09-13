/**
 * Hub daemon skeleton — the PR 8 acceptance scenario, end to end.
 *
 * A hub on a free port registers two projects, spawns a child server per
 * project, lists them with their bound ports, stops one on DELETE, and takes
 * the rest down with it on shutdown. The registry survives a hub restart:
 * children whose pid is still alive are re-attached (same pid), dead ones are
 * respawned (new pid).
 *
 * The children here are a stub server honouring the child contract — accept
 * `serve --port=0 <repoRoot>`, bind an ephemeral loopback port, write it to
 * `<repoRoot>/.n-dx-web.port`, answer GET /api/status with 200 — rather than
 * the real `web serve`. The hub's contract is with that interface, not with
 * the dashboard: booting two full dashboards would test the server (already
 * covered by port-zero-reporting and friends) at ~100× the cost, while the
 * spawn/attach/health logic under test here would be exercised identically.
 * The `.mjs` bin is also what exercises the script-bin seam the hub provides
 * for exactly this purpose.
 *
 * @see packages/web/src/hub/hub.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHub, type HubHandle } from "../../src/hub/hub.js";
import { isPidAlive } from "../../src/hub/children.js";
import { HUB_PID_FILENAME, REGISTRY_FILENAME } from "../../src/hub/registry.js";

/** A minimal server honouring the hub's child contract. */
const STUB_SERVER = `
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// argv: <script> serve --port=0 <repoRoot>
const repoRoot = process.argv[process.argv.length - 1];

const server = createServer((req, res) => {
  if (req.url === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, pid: process.pid, projectDir: repoRoot }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(0, "127.0.0.1", () => {
  writeFileSync(join(repoRoot, ".n-dx-web.port"), String(server.address().port) + "\\n");
});

process.on("SIGTERM", () => process.exit(0));
`;

interface ProjectWire {
  id: string;
  port: number;
  pid: number;
  reachable: boolean;
}

const hubUrl = (hub: HubHandle, path: string) => `http://127.0.0.1:${hub.port}${path}`;

async function registerProject(hub: HubHandle, id: string, repoRoot: string, ndxBin: string) {
  const res = await fetch(hubUrl(hub, "/api/hub/projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, repoRoot, ndxBin }),
  });
  const body = (await res.json()) as { project?: ProjectWire; error?: string };
  return { status: res.status, project: body.project, error: body.error };
}

async function listProjects(hub: HubHandle): Promise<ProjectWire[]> {
  const res = await fetch(hubUrl(hub, "/api/hub/projects"));
  expect(res.status).toBe(200);
  return ((await res.json()) as { projects: ProjectWire[] }).projects;
}

/** Is anything answering /api/status on this port? */
async function childAnswers(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(1_000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function waitFor(cond: () => Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("hub daemon", () => {
  let baseDir: string;
  let hubDir: string;
  let stubBin: string;
  let repoA: string;
  let repoB: string;
  const liveHubs: HubHandle[] = [];

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ndx-hub-daemon-"));
    hubDir = join(baseDir, "hub-state");
    stubBin = join(baseDir, "stub-ndx.mjs");
    repoA = await mkdtemp(join(baseDir, "repo-a-"));
    repoB = await mkdtemp(join(baseDir, "repo-b-"));
    await writeFile(stubBin, STUB_SERVER, "utf-8");
  });

  afterAll(async () => {
    for (const hub of liveHubs) {
      await hub.close().catch(() => {});
    }
    await rm(baseDir, { recursive: true, force: true });
  });

  async function boot(): Promise<HubHandle> {
    const hub = await startHub(0, { hubDir, quiet: true, healthCheckIntervalMs: 60_000 });
    liveHubs.push(hub);
    return hub;
  }

  it("registers, lists, deletes, survives restart, and stops children on shutdown", async () => {
    // ── Start on a free port, register two projects ───────────────────────
    const hub1 = await boot();
    expect(hub1.port).toBeGreaterThan(0);

    const health = await fetch(hubUrl(hub1, "/api/hub/health"));
    expect(health.status).toBe(200);
    await access(join(hubDir, HUB_PID_FILENAME)); // pid file present while running

    const a = await registerProject(hub1, "alpha", repoA, stubBin);
    expect(a.status, a.error).toBe(201);
    const b = await registerProject(hub1, "beta", repoB, stubBin);
    expect(b.status, b.error).toBe(201);

    // Both children actually came up on their reported ports.
    expect(await childAnswers(a.project!.port)).toBe(true);
    expect(await childAnswers(b.project!.port)).toBe(true);

    // The listing carries both, with ports.
    const listed = await listProjects(hub1);
    expect(listed.map((p) => p.id).sort()).toEqual(["alpha", "beta"]);
    for (const p of listed) expect(p.port).toBeGreaterThan(0);

    // Re-registering an already-running project is idempotent, not a respawn.
    const again = await registerProject(hub1, "alpha", repoA, stubBin);
    expect(again.status).toBe(200);
    expect(again.project!.pid).toBe(a.project!.pid);

    // ── DELETE stops that child and only that child ───────────────────────
    const del = await fetch(hubUrl(hub1, "/api/hub/projects/alpha"), { method: "DELETE" });
    expect(del.status).toBe(200);
    await waitFor(async () => !(await childAnswers(a.project!.port)), "alpha's child to stop");
    expect(await childAnswers(b.project!.port)).toBe(true);
    expect((await listProjects(hub1)).map((p) => p.id)).toEqual(["beta"]);

    // ── Registry survives a hub crash: re-attach the live child ───────────
    const betaPid = b.project!.pid;
    await hub1.close({ stopChildren: false }); // simulate a crashed hub
    expect(await childAnswers(b.project!.port)).toBe(true); // orphan still up

    const hub2 = await boot();
    const attached = await listProjects(hub2);
    expect(attached).toHaveLength(1);
    expect(attached[0]!.id).toBe("beta");
    expect(attached[0]!.pid, "a live child is re-attached, not respawned").toBe(betaPid);
    expect(attached[0]!.port).toBe(b.project!.port);

    // ── Hub shutdown stops the remaining children ─────────────────────────
    await hub2.close();
    await waitFor(async () => !(await childAnswers(b.project!.port)), "beta's child to stop on hub shutdown");
    expect(isPidAlive(betaPid)).toBe(false);

    // ── Registry survives a clean restart: dead child is respawned ────────
    await access(join(hubDir, REGISTRY_FILENAME)); // the registry is still on disk
    const hub3 = await boot();
    const respawned = await listProjects(hub3);
    expect(respawned).toHaveLength(1);
    expect(respawned[0]!.id).toBe("beta");
    expect(respawned[0]!.pid, "a dead child is respawned with a fresh pid").not.toBe(betaPid);
    expect(await childAnswers(respawned[0]!.port)).toBe(true);

    await hub3.close();
    await waitFor(async () => !(await childAnswers(respawned[0]!.port)), "respawned child to stop");
  }, 120_000);

  it("rejects a registration it cannot act on", async () => {
    const hub = await boot();

    const missing = await fetch(hubUrl(hub, "/api/hub/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "x" }),
    });
    expect(missing.status).toBe(400);

    const badBin = await registerProject(hub, "ghost", repoA, join(baseDir, "no-such-bin.mjs"));
    expect(badBin.status).toBe(502);

    const unknownDelete = await fetch(hubUrl(hub, "/api/hub/projects/never-registered"), {
      method: "DELETE",
    });
    expect(unknownDelete.status).toBe(404);

    await hub.close();
  }, 60_000);
});
