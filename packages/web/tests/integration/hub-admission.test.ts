import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHub, registryPath } from "../../src/hub/index.js";
import type { HubHandle, ProjectRecord } from "../../src/hub/index.js";

/**
 * The admission gate in front of two projects, with room for one run.
 *
 * The children here are fake: small HTTP servers that answer the two
 * endpoints the gate uses — `/api/status` so the hub adopts them, and
 * `/api/hench/execute/status` so it can count what is in flight — plus
 * `/api/hench/execute` to record what actually reached them. Real dashboard
 * servers would work too and take a second each to start; what is under test
 * is the hub's arithmetic and its queue, not theirs.
 */

interface FakeChild {
  server: Server;
  port: number;
  dir: string;
  /** Executions the child reports as in flight. */
  running: Set<string>;
  /** Execute requests that actually arrived, in order. */
  received: Array<{ taskId: string; workspace: string | null }>;
}

async function startFakeChild(dir: string): Promise<FakeChild> {
  const child: Partial<FakeChild> & { running: Set<string>; received: FakeChild["received"] } = {
    dir,
    running: new Set<string>(),
    received: [],
  };

  const server = createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    const json = (status: number, body: unknown): void => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
      res.end(text);
    };

    if (url === "/api/status") return json(200, { projectDir: dir });
    if (url === "/api/hench/execute/status") {
      return json(200, {
        executions: [...child.running].map((taskId) => ({ taskId, status: "running" })),
      });
    }
    if (url === "/api/hench/execute" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const taskId = (JSON.parse(body || "{}") as { taskId?: string }).taskId ?? "";
        const header = req.headers["x-ndx-workspace"];
        child.received.push({ taskId, workspace: (Array.isArray(header) ? header[0] : header) ?? null });
        child.running.add(taskId);
        json(200, { runId: `run-${taskId}`, taskId });
      });
      return;
    }
    json(404, { error: "not found" });
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

  return { ...(child as FakeChild), server, port };
}

function record(id: string, dir: string, port: number): ProjectRecord {
  return {
    id,
    name: id,
    repoRoot: dir,
    worktrees: [dir],
    ndxBin: "/nonexistent/ndx",
    port,
    // A pid the hub will find alive, so `attach` adopts the child rather than
    // trying to respawn it with the bogus ndxBin above.
    pid: process.pid,
    lastSeen: new Date().toISOString(),
  };
}

describe("hub admission gate", () => {
  let home: string;
  let alpha: FakeChild;
  let beta: FakeChild;
  let hub: HubHandle | null = null;
  let freeMemory = 8 * 1024 * 1024 * 1024;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "hub-admission-"));
    alpha = await startFakeChild(mkdtempSync(join(tmpdir(), "hub-admission-alpha-")));
    beta = await startFakeChild(mkdtempSync(join(tmpdir(), "hub-admission-beta-")));
    freeMemory = 8 * 1024 * 1024 * 1024;

    writeFileSync(registryPath(home), JSON.stringify({
      version: 1,
      projects: {
        alpha: record("alpha", alpha.dir, alpha.port),
        beta: record("beta", beta.dir, beta.port),
      },
    }));
  });

  afterEach(async () => {
    await hub?.close({ stopChildren: false });
    hub = null;
    for (const child of [alpha, beta]) {
      await new Promise<void>((resolve) => child.server.close(() => resolve()));
      rmSync(child.dir, { recursive: true, force: true });
    }
    rmSync(home, { recursive: true, force: true });
  });

  async function startTestHub(maxSessions = 1): Promise<HubHandle> {
    hub = await startHub({
      port: 0,
      homeDir: home,
      healthIntervalMs: 60_000,
      limits: { maxSessions, memoryFloorBytes: 1_000 },
      freeMemory: () => freeMemory,
      drainIntervalMs: 50,
    });
    return hub;
  }

  const execute = (port: number, path: string, taskId: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ taskId }),
    });

  it("forwards the first run and queues the second, across projects", async () => {
    const h = await startTestHub(1);

    // Alpha's run has room and goes straight through.
    const first = await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    expect(first.status).toBe(200);
    expect(alpha.received.map((r) => r.taskId)).toEqual(["task-1"]);

    // Beta's is over the machine's cap, even though beta itself is idle.
    const second = await execute(h.port, "/p/beta/api/hench/execute", "task-2");
    expect(second.status).toBe(202);
    const body = await second.json();
    expect(body).toMatchObject({
      queued: true,
      position: 1,
      reason: "at-capacity",
      taskId: "task-2",
      projectId: "beta",
      running: 1,
      limits: { maxSessions: 1 },
    });
    expect(beta.received).toEqual([]);
  });

  it("releases the queue in order once the machine has room", async () => {
    const h = await startTestHub(1);

    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    expect((await execute(h.port, "/p/beta/api/hench/execute", "task-2")).status).toBe(202);
    expect((await execute(h.port, "/p/alpha/api/hench/execute", "task-3")).status).toBe(202);

    // Alpha's first run finishes; the drain tick starts the head of the queue.
    alpha.running.delete("task-1");
    await waitFor(() => beta.received.length === 1, 4_000);
    expect(beta.received[0].taskId).toBe("task-2");
    // task-3 is still waiting behind it — one slot, one release.
    expect(alpha.received.map((r) => r.taskId)).toEqual(["task-1"]);

    beta.running.delete("task-2");
    await waitFor(() => alpha.received.length === 2, 4_000);
    expect(alpha.received.map((r) => r.taskId)).toEqual(["task-1", "task-3"]);
  });

  it("carries the workspace a queued run was asked for", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");

    // Addressed through the /w/<key>/ slot rather than the header.
    expect((await execute(h.port, "/p/beta/w/feature/api/hench/execute", "task-2")).status).toBe(202);

    alpha.running.delete("task-1");
    await waitFor(() => beta.received.length === 1, 4_000);
    expect(beta.received[0]).toEqual({ taskId: "task-2", workspace: "feature" });
  });

  it("queues everything while free memory is below the floor, and says so", async () => {
    const h = await startTestHub(4);
    freeMemory = 500;

    const res = await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ queued: true, reason: "low-memory", position: 1 });
    expect(alpha.received).toEqual([]);

    const queue = await (await fetch(`http://127.0.0.1:${h.port}/api/hub/queue`)).json();
    expect(queue).toMatchObject({ memoryPaused: true, freeMemoryBytes: 500 });
    expect(queue.entries).toHaveLength(1);

    // Memory recovers: the same queued run is released without asking again.
    freeMemory = 8 * 1024 * 1024 * 1024;
    await waitFor(() => alpha.received.length === 1, 4_000);
    expect(alpha.received[0].taskId).toBe("task-1");
  });

  it("does not queue the same task twice when the button is clicked again", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");

    const first = await (await execute(h.port, "/p/beta/api/hench/execute", "task-2")).json();
    const again = await (await execute(h.port, "/p/beta/api/hench/execute", "task-2")).json();
    expect(first.position).toBe(1);
    expect(again.position).toBe(1);
    expect(again.queueLength).toBe(1);
  });

  it("leaves requests that are not executes alone", async () => {
    const h = await startTestHub(1);
    // Fill the machine, then check an unrelated POST still reaches the child.
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    const res = await fetch(`http://127.0.0.1:${h.port}/p/beta/api/status`);
    expect(res.status).toBe(200);
    expect((await res.json()).projectDir).toBe(beta.dir);
  });

  it("reports its limits and what is running on the queue endpoint", async () => {
    const h = await startTestHub(2);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");

    const queue = await (await fetch(`http://127.0.0.1:${h.port}/api/hub/queue`)).json();
    expect(queue).toMatchObject({
      running: 1,
      limits: { maxSessions: 2, memoryFloorBytes: 1_000 },
      memoryPaused: false,
      entries: [],
    });
  });
});

/** Poll until `predicate` holds, or fail the test with a timeout. */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
