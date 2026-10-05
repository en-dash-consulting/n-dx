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
  received: Array<{ taskId: string; workspace: string | null; options?: Record<string, unknown> }>;
  /** The admission header on each `GET /api/live` that arrived. */
  liveAdmission: Array<string | null>;
  /** Tasks this server refuses, on execute and on check alike — as a real one would. */
  refuse: Map<string, { status: number; error: string }>;
  /** False plays a server from before `POST /api/hench/execute/check` existed. */
  hasCheckRoute: boolean;
  /** Check requests that arrived. */
  checks: string[];
}

async function startFakeChild(dir: string): Promise<FakeChild> {
  const child: Partial<FakeChild> & Pick<FakeChild, "running" | "received" | "liveAdmission" | "refuse" | "hasCheckRoute" | "checks"> = {
    dir,
    running: new Set<string>(),
    received: [],
    liveAdmission: [],
    refuse: new Map(),
    hasCheckRoute: true,
    checks: [],
  };

  const server = createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    const json = (status: number, body: unknown): void => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
      res.end(text);
    };

    if (url === "/api/status") {
      // Shaped like a real project server's: the hub's overview reads the
      // per-tool sections, not just projectDir.
      return json(200, {
        projectDir: dir,
        sv: { analyzedAt: "2026-09-16T09:00:00.000Z" },
        rex: { exists: true, percentComplete: 37, nextTaskTitle: "Next thing" },
        hench: { activeRuns: child.running.size },
      });
    }
    // A real project server strips the `/w/<key>` slot itself; the hub forwards it.
    if (url.endsWith("/api/live") || /\/api\/hench\/prep\/[^/]+$/.test(url)) {
      const header = req.headers["x-ndx-hub-admission"];
      child.liveAdmission.push((Array.isArray(header) ? header[0] : header) ?? null);
      return json(200, {});
    }
    if (url === "/api/git/status") {
      return json(200, { isRepo: true, branch: "main", dirty: false, files: [] });
    }
    if (url === "/api/hench/execute/status") {
      return json(200, {
        executions: [...child.running].map((taskId) => ({ taskId, status: "running" })),
      });
    }
    if (url === "/api/hench/execute/check" && req.method === "POST" && child.hasCheckRoute) {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const taskId = (JSON.parse(body || "{}") as { taskId?: string }).taskId ?? "";
        child.checks.push(taskId);
        const refusal = child.refuse.get(taskId);
        json(200, refusal ? { ok: false, status: refusal.status, error: refusal.error, taskId } : { ok: true });
      });
      return;
    }
    if (url === "/api/hench/execute" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as {
          taskId?: string;
          options?: Record<string, unknown>;
          mode?: string;
          iterations?: number;
        };
        const taskId = parsed.taskId ?? "";
        const refusal = child.refuse.get(taskId);
        if (refusal) {
          json(refusal.status, { error: refusal.error, taskId });
          return;
        }
        const header = req.headers["x-ndx-workspace"];
        child.received.push({
          taskId,
          workspace: (Array.isArray(header) ? header[0] : header) ?? null,
          ...(parsed.options ? { options: parsed.options } : {}),
          ...(parsed.mode ? { mode: parsed.mode } : {}),
          ...(parsed.iterations !== undefined ? { iterations: parsed.iterations } : {}),
        });
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
  /** The gate's available-memory reading; null is a machine that could not be read. */
  let freeMemory: number | null = 8 * 1024 * 1024 * 1024;

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

  async function startTestHub(maxSessions = 1, memoryFloorBytes = 1_000): Promise<HubHandle> {
    hub = await startHub({
      port: 0,
      homeDir: home,
      healthIntervalMs: 60_000,
      limits: { maxSessions, memoryFloorBytes },
      freeMemory: () => freeMemory,
      drainIntervalMs: 50,
    });
    return hub;
  }

  const execute = (
    port: number,
    path: string,
    taskId: string,
    headers: Record<string, string> = {},
    options?: Record<string, unknown>,
    /** Top-level fields beside `options` — today the run mode and its count. */
    extra: Record<string, unknown> = {},
  ) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ taskId, ...(options ? { options } : {}), ...extra }),
    });

  it("replays a queued run's options when it is admitted", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");

    const options = { model: "claude-opus-5", review: true, maxTurns: 12, contextNotes: "Keep it small." };
    const queued = await execute(h.port, "/p/beta/api/hench/execute", "task-2", {}, options);
    expect(queued.status).toBe(202);
    const body = await queued.json();
    expect(Object.keys(body)).toEqual(expect.arrayContaining(["queued", "position", "reason"]));
    // The server's own 202 echoes the options it accepted; so does the queued one.
    expect(body.options).toEqual(options);

    alpha.running.delete("task-1");
    await waitFor(() => beta.received.length === 1, 4_000);
    expect(beta.received[0]).toEqual({ taskId: "task-2", workspace: null, options });
  });

  it("replays a queued run's mode, so a loop does not come back as one task", async () => {
    // The entry is what gets replayed, not the original request — the client
    // that sent it got its 202 and is gone. A mode that did not survive the
    // queue would start a single task under a 202 that said "until done".
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");

    const queued = await execute(h.port, "/p/beta/api/hench/execute", "task-2", {}, undefined, { mode: "loop" });
    expect(queued.status).toBe(202);
    expect(await queued.json()).toMatchObject({ queued: true, mode: "loop" });

    alpha.running.delete("task-1");
    await waitFor(() => beta.received.length === 1, 4_000);
    expect(beta.received[0]).toEqual({ taskId: "task-2", workspace: null, mode: "loop" });
  });

  it("replays an iterations count with its mode", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");

    await execute(
      h.port, "/p/beta/api/hench/execute", "task-2", {}, { model: "claude-opus-5" },
      { mode: "iterations", iterations: 4 },
    );

    alpha.running.delete("task-1");
    await waitFor(() => beta.received.length === 1, 4_000);
    expect(beta.received[0]).toEqual({
      taskId: "task-2",
      workspace: null,
      options: { model: "claude-opus-5" },
      mode: "iterations",
      iterations: 4,
    });
  });

  it("sends a single run with no mode at all, as it always did", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    await execute(h.port, "/p/beta/api/hench/execute", "task-2", {}, undefined, { mode: "single" });

    alpha.running.delete("task-1");
    await waitFor(() => beta.received.length === 1, 4_000);
    expect(beta.received[0]).toEqual({ taskId: "task-2", workspace: null });
  });

  it("forwards a count its mode cannot accept rather than queuing it", async () => {
    // Same rule as a rejected option: queuing it would turn the project
    // server's 400 into a run silently dropped when its turn came.
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");

    const res = await execute(
      h.port, "/p/beta/api/hench/execute", "task-2", {}, undefined,
      { mode: "iterations", iterations: 0 },
    );
    // Forwarded, not queued: the project server answers for its own request.
    expect(res.status).not.toBe(202);
    await waitFor(() => beta.received.length === 1, 4_000);
    expect(beta.received[0]).toMatchObject({ taskId: "task-2", mode: "iterations", iterations: 0 });
  });

  it("never serves contextNotes text from the queue, scoped or not", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    const secret = "private notes for beta's agent";
    await execute(h.port, "/p/beta/api/hench/execute", "task-2", {}, { model: "claude-opus-5", contextNotes: secret });

    for (const path of ["/api/hub/queue", "/p/beta/api/hub/queue", "/p/alpha/api/hub/queue"]) {
      const text = await (await fetch(`http://127.0.0.1:${h.port}${path}`)).text();
      expect(text).not.toContain(secret);
      expect(text).not.toContain("contextNotes");
    }
    const queue = await (await fetch(`http://127.0.0.1:${h.port}/api/hub/queue`)).json();
    expect(queue.entries[0]).toMatchObject({
      taskId: "task-2",
      options: { model: "claude-opus-5" },
      hasNotes: true,
    });
  });

  it("takes the newer options when a queued task is asked for again, keeping its place", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    await execute(h.port, "/p/beta/api/hench/execute", "task-2", {}, { fresh: true });
    await execute(h.port, "/p/beta/api/hench/execute", "task-3");

    const again = await (await execute(h.port, "/p/beta/api/hench/execute", "task-2", {}, { maxTurns: 7 })).json();
    expect(again).toMatchObject({ queued: true, position: 1, queueLength: 2 });

    alpha.running.delete("task-1");
    await waitFor(() => beta.received.length === 1, 4_000);
    expect(beta.received[0]).toEqual({ taskId: "task-2", workspace: null, options: { maxTurns: 7 } });
  });

  it("answers the project server's refusal at enqueue time instead of 202 queued", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");

    // Shape-valid options the server refuses — a model gone from its catalog.
    const error = 'Run option "model": Model "claude-live-only" is not in the claude catalog.';
    beta.refuse.set("task-2", { status: 400, error });
    const res = await execute(h.port, "/p/beta/w/feature/api/hench/execute", "task-2", {}, { model: "claude-live-only" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error, taskId: "task-2" });
    expect(beta.checks).toEqual(["task-2"]);

    const queue = await (await fetch(`http://127.0.0.1:${h.port}/api/hub/queue`)).json();
    expect(queue.entries).toEqual([]);

    // Nothing was queued: the next run queued behind it is the first to arrive.
    expect((await execute(h.port, "/p/beta/api/hench/execute", "task-3")).status).toBe(202);
    alpha.running.delete("task-1");
    await waitFor(() => beta.received.length === 1, 4_000);
    expect(beta.received.map((r) => r.taskId)).toEqual(["task-3"]);
  });

  it("shows a queued entry its server refused at replay as dropped, with the server's status and reason", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    expect((await execute(h.port, "/p/beta/api/hench/execute", "task-2", {}, { fresh: true })).status).toBe(202);

    // The task became blocked while it waited.
    const error = 'Task is blocked by "Other" (t-9, pending). Finish or unblock it first.';
    beta.refuse.set("task-2", { status: 409, error });
    alpha.running.delete("task-1");

    const queueUrl = `http://127.0.0.1:${h.port}/p/beta/api/hub/queue`;
    await waitFor(async () => ((await (await fetch(queueUrl)).json()).dropped ?? []).length === 1, 4_000);
    const queue = await (await fetch(queueUrl)).json();
    expect(queue.entries).toEqual([]);
    expect(queue.dropped).toEqual([
      expect.objectContaining({ projectId: "beta", taskId: "task-2", options: { fresh: true }, status: 409, error }),
    ]);
    // Narrowed like entries: another project's viewer does not see it.
    const alphaQueue = await (await fetch(`http://127.0.0.1:${h.port}/p/alpha/api/hub/queue`)).json();
    expect(alphaQueue.dropped).toEqual([]);
  });

  it("queues as before behind a server that has no check route", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    beta.hasCheckRoute = false;

    // A 404 from the check is no verdict — and is never taken as a start.
    expect((await execute(h.port, "/p/beta/api/hench/execute", "task-2")).status).toBe(202);
    expect(beta.received).toEqual([]);
  });

  it("forwards options it cannot accept to the project server rather than queuing them", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");

    // The project server owns the 400; queuing would drop the run silently later.
    const res = await execute(h.port, "/p/beta/api/hench/execute", "task-2", {}, { bogus: "--x" });
    expect(res.status).toBe(200);
    expect(beta.received).toEqual([{ taskId: "task-2", workspace: null, options: { bogus: "--x" } }]);
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

  it("starts the run on an idle Mac, where os.freemem() would have queued it", async () => {
    // 16 GB Mac: 115 MB free pages, 3.9 GB available once inactive, speculative
    // and purgeable pages are counted. Against a 2 GB floor the old reading
    // queued every dashboard run; the shared one admits.
    const GIB = 1024 ** 3;
    const h = await startTestHub(4, 2 * GIB);
    freeMemory = Math.round(3.9 * GIB);

    const res = await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    expect(res.status).toBe(200);
    expect(alpha.received.map((r) => r.taskId)).toEqual(["task-1"]);

    const queue = await (await fetch(`http://127.0.0.1:${h.port}/api/hub/queue`)).json();
    expect(queue).toMatchObject({ memoryPaused: false, availableBytes: Math.round(3.9 * GIB) });
  });

  it("admits when the machine cannot be read at all, and reports no pause", async () => {
    const h = await startTestHub(4, 2 * 1024 ** 3);
    freeMemory = null;

    const res = await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    expect(res.status).toBe(200);

    const queue = await (await fetch(`http://127.0.0.1:${h.port}/api/hub/queue`)).json();
    expect(queue).toMatchObject({ memoryPaused: false, freeMemoryBytes: null, pressure: "unknown" });
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

  it("answers its own queue endpoint under a project prefix — the only address a viewer has", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    expect((await execute(h.port, "/p/alpha/api/hench/execute", "task-2")).status).toBe(202);
    expect((await execute(h.port, "/p/beta/api/hench/execute", "task-3")).status).toBe(202);

    // What the viewer's fetch actually looks like: installBasePathFetch has
    // rewritten /api/hub/queue to sit under the page's base path.
    const res = await fetch(`http://127.0.0.1:${h.port}/p/alpha/api/hub/queue`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Scoped: alpha sees its own queued run, not beta's.
    expect(body.entries.map((e: { taskId: string }) => e.taskId)).toEqual(["task-2"]);
    // But the machine's numbers are the machine's — waiting behind another
    // project's run is exactly what needs explaining.
    expect(body).toMatchObject({ running: 1, queuedTotal: 2, limits: { maxSessions: 1 } });

    // Unscoped, the whole machine's queue.
    const all = await (await fetch(`http://127.0.0.1:${h.port}/api/hub/queue`)).json();
    expect(all.entries.map((e: { taskId: string }) => e.taskId)).toEqual(["task-2", "task-3"]);
    expect(all.queuedTotal).toBeUndefined();
  });

  it("the queue a viewer reads moves without it reloading anything", async () => {
    const h = await startTestHub(1);
    const read = async () => (await (await fetch(`http://127.0.0.1:${h.port}/p/beta/api/hub/queue`)).json());

    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    expect((await read()).entries).toEqual([]);

    await execute(h.port, "/p/beta/w/feature/api/hench/execute", "task-2");
    const queued = await read();
    expect(queued.entries).toHaveLength(1);
    // The workspace rides along, so a strip showing one worktree can tell.
    expect(queued.entries[0]).toMatchObject({ taskId: "task-2", workspace: "feature" });

    // The run is released; the next read shows an empty queue. No reload, no
    // socket — the same URL, answered again.
    alpha.running.delete("task-1");
    await waitFor(() => beta.received.length === 1, 4_000);
    expect((await read()).entries).toEqual([]);
  });

  it("serves the home page at / with a card per project, from live child data", async () => {
    const h = await startTestHub(4);
    alpha.running.add("task-running");

    const res = await fetch(`http://127.0.0.1:${h.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();

    // Both projects, each linking to its own dashboard and Runs view.
    expect(html).toContain(">alpha<");
    expect(html).toContain(">beta<");
    expect(html).toContain('href="/p/alpha/hench-runs"');
    expect(html).toContain('href="/p/beta/"');
    expect(html).toContain(alpha.dir);
    // The fake child reports one execution in flight, and the card says so.
    expect(html).toContain("1 running");
    // Theme bootstrap is inline, so the page never flashes the wrong one.
    expect(html).toContain('localStorage.getItem("sv-theme")');
  });

  it("serves the same cards as JSON plus markup, for the page's refresh tick", async () => {
    const h = await startTestHub(4);
    const res = await fetch(`http://127.0.0.1:${h.port}/api/hub/overview`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.projects.map((p: { id: string }) => p.id).sort()).toEqual(["alpha", "beta"]);
    const card = body.projects.find((p: { id: string }) => p.id === "alpha");
    expect(card).toMatchObject({ reachable: true, url: "/p/alpha/", state: "healthy" });
    // The markup the tick swaps in is the server's own, not a second renderer.
    expect(body.html).toContain('href="/p/alpha/hench-runs"');
    expect(Date.parse(body.generatedAt)).not.toBeNaN();
  });

  it("404s the hub API under an unknown project prefix", async () => {
    const h = await startTestHub(1);
    const res = await fetch(`http://127.0.0.1:${h.port}/p/nope/api/hub/queue`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("nope");
  });

  it("states its admission state on a proxied GET /api/live, and drops a client's copy", async () => {
    const h = await startTestHub(1);
    await execute(h.port, "/p/alpha/api/hench/execute", "task-1");
    expect((await execute(h.port, "/p/beta/api/hench/execute", "task-2")).status).toBe(202);

    const spoofed = JSON.stringify({ running: 0, maxSessions: 99, queued: 0 });
    await fetch(`http://127.0.0.1:${h.port}/p/beta/w/feature/api/live`, { headers: { "x-ndx-hub-admission": spoofed } });
    expect(beta.liveAdmission).toEqual([
      JSON.stringify({ running: 1, maxSessions: 1, queued: 1, availableBytes: 8 * 1024 ** 3, pressure: "normal", memoryPaused: false }),
    ]);
  });

  it("states it on a proxied prep read too, including that memory is what holds runs back", async () => {
    const h = await startTestHub(4);
    freeMemory = 500;
    await fetch(`http://127.0.0.1:${h.port}/p/beta/api/hench/prep/task-1`);
    expect(beta.liveAdmission).toEqual([
      JSON.stringify({ running: 0, maxSessions: 4, queued: 0, availableBytes: 500, pressure: "critical", memoryPaused: true }),
    ]);
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
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
