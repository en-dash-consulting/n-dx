/**
 * `POST /api/hench/runs/reconcile` and the liveness fields on the audit and
 * health endpoints.
 *
 * The scenario these cover: a run file says `status: "running"` but the process
 * that wrote it is gone (crash, reboot, kill -9). Nothing on disk ever corrects
 * that, so the dashboard's active-task list accumulates runs nothing executes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute, resetHenchRouteStateForTests } from "../../../src/server/routes-hench.js";
import { closeRouteTestServer, TEST_HOST } from "../../helpers/server-route-test-support.js";

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const result = handleHenchRoute(req, res, ctx);
      if (result instanceof Promise) {
        result.then((handled) => {
          if (!handled) { res.writeHead(404); res.end("Not found"); }
        });
      } else if (!result) {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(0, TEST_HOST, () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

describe("running-task reconciliation", () => {
  let tmpDir: string;
  let runsDir: string;
  let locksDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let base: string;

  /** Write a run file recorded as still running on this host. */
  async function writeRunningRun(
    id: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    const startedAt = new Date(Date.now() - 50 * 3_600_000).toISOString();
    await writeFile(
      join(runsDir, `${id}.json`),
      JSON.stringify({
        id,
        taskId: `task-${id}`,
        taskTitle: `Task ${id}`,
        status: "running",
        startedAt,
        lastActivityAt: startedAt,
        host: hostname(),
        turns: 3,
        model: "claude-opus-5",
        tokenUsage: { input: 10, output: 5 },
        ...overrides,
      }, null, 2),
    );
  }

  async function readRun(id: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(runsDir, `${id}.json`), "utf-8"));
  }

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    tmpDir = await mkdtemp(join(tmpdir(), "hench-reconcile-"));
    runsDir = join(tmpDir, ".hench", "runs");
    locksDir = join(tmpDir, ".hench", "locks");
    await mkdir(runsDir, { recursive: true });
    await mkdir(locksDir, { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    ({ server, port } = await startTestServer(ctx));
    base = `http://${TEST_HOST}:${port}`;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Audit ───────────────────────────────────────────────────────────

  it("marks a run with no live process as orphaned and endable", async () => {
    await writeRunningRun("a");

    const data = await (await fetch(`${base}/api/hench/audit`)).json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].liveness).toBe("orphaned");
    expect(data.entries[0].canEnd).toBe(true);
    expect(data.entries[0].livenessReason).toContain("No hench process");
    expect(data.liveness).toMatchObject({ total: 1, orphaned: 1, live: 0 });
  });

  it("marks a run held by a live lock as live, not orphaned", async () => {
    await writeRunningRun("a");
    await writeFile(
      join(locksDir, `${process.pid}.lock`),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), taskId: "task-a" }),
    );

    const data = await (await fetch(`${base}/api/hench/audit`)).json();
    expect(data.entries[0].liveness).toBe("live");
    expect(data.entries[0].canEnd).toBe(false);
    expect(data.entries[0].pid).toBe(process.pid);
  });

  it("withholds judgment on a run recorded by another machine", async () => {
    await writeRunningRun("a", { host: "some-other-box" });

    const data = await (await fetch(`${base}/api/hench/audit`)).json();
    expect(data.entries[0].liveness).toBe("foreign");
    expect(data.entries[0].canEnd).toBe(false);
  });

  it("reports liveness alongside staleness on the health endpoint", async () => {
    await writeRunningRun("a");

    const data = await (await fetch(`${base}/api/hench/runs/health`)).json();
    expect(data.activeRuns).toBe(1);
    expect(data.orphanedRuns).toBe(1);
    expect(data.runs[0].stale).toBe(true);
    expect(data.runs[0].liveness).toBe("orphaned");
  });

  // ── Reconcile ───────────────────────────────────────────────────────

  it("ends every orphaned run and leaves a reason on each", async () => {
    await writeRunningRun("a");
    await writeRunningRun("b");

    const res = await fetch(`${base}/api/hench/runs/reconcile`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ended).toBe(2);
    expect(data.dryRun).toBe(false);

    for (const id of ["a", "b"]) {
      const run = await readRun(id);
      expect(run.status).toBe("failed");
      expect(run.error).toContain("Ended by audit reconciliation");
      expect(run.finishedAt).toBeTruthy();
    }
  });

  it("writes nothing on a dry run but reports what it would end", async () => {
    await writeRunningRun("a");

    const res = await fetch(`${base}/api/hench/runs/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    const data = await res.json();
    expect(data.dryRun).toBe(true);
    expect(data.ended).toBe(0);
    expect(data.eligible).toBe(1);
    expect((await readRun("a")).status).toBe("running");
  });

  it("refuses to end a run a live process holds", async () => {
    await writeRunningRun("a");
    await writeFile(
      join(locksDir, `${process.pid}.lock`),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), taskId: "task-a" }),
    );

    const data = await (await fetch(`${base}/api/hench/runs/reconcile`, { method: "POST" })).json();
    expect(data.ended).toBe(0);
    expect(data.outcomes[0]).toMatchObject({ liveness: "live", eligible: false, ended: false });
    expect((await readRun("a")).status).toBe("running");
  });

  it("refuses to end a run from another machine even with includeUnknown", async () => {
    // A foreign run is not unverified-but-probably-dead; this host simply has
    // no standing to judge it, and that does not change with a wider flag.
    await writeRunningRun("a", { host: "some-other-box" });

    const data = await (await fetch(`${base}/api/hench/runs/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeUnknown: true }),
    })).json();
    expect(data.ended).toBe(0);
    expect((await readRun("a")).status).toBe("running");
  });

  it("ends an unverified run only when includeUnknown is set", async () => {
    const startedAt = new Date().toISOString();
    await writeRunningRun("a", { startedAt, lastActivityAt: startedAt });
    // An untagged lock from a process started at the same time: it could be
    // this run's, so the default sweep leaves it alone.
    await writeFile(
      join(locksDir, `${process.pid}.lock`),
      JSON.stringify({ pid: process.pid, startedAt }),
    );

    const first = await (await fetch(`${base}/api/hench/runs/reconcile`, { method: "POST" })).json();
    expect(first.ended).toBe(0);
    expect(first.outcomes[0].liveness).toBe("unknown");
    expect((await readRun("a")).status).toBe("running");

    const second = await (await fetch(`${base}/api/hench/runs/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeUnknown: true }),
    })).json();
    expect(second.ended).toBe(1);
    expect((await readRun("a")).status).toBe("failed");
  });

  it("restricts the sweep to the run ids given", async () => {
    await writeRunningRun("a");
    await writeRunningRun("b");

    const data = await (await fetch(`${base}/api/hench/runs/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runIds: ["a"] }),
    })).json();
    expect(data.ended).toBe(1);
    expect((await readRun("a")).status).toBe("failed");
    expect((await readRun("b")).status).toBe("running");
  });

  it("leaves already-finished runs untouched", async () => {
    await writeRunningRun("done", { status: "completed", finishedAt: new Date().toISOString() });

    const data = await (await fetch(`${base}/api/hench/runs/reconcile`, { method: "POST" })).json();
    expect(data.ended).toBe(0);
    expect(data.outcomes).toHaveLength(0);
    expect((await readRun("done")).status).toBe("completed");
  });

  it("is idempotent — a second sweep ends nothing", async () => {
    await writeRunningRun("a");

    expect((await (await fetch(`${base}/api/hench/runs/reconcile`, { method: "POST" })).json()).ended).toBe(1);
    const second = await (await fetch(`${base}/api/hench/runs/reconcile`, { method: "POST" })).json();
    expect(second.ended).toBe(0);
  });

  it("rejects a malformed body rather than sweeping with defaults", async () => {
    await writeRunningRun("a");

    const res = await fetch(`${base}/api/hench/runs/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await readRun("a")).status).toBe("running");
  });

  it("answers with an empty sweep when no runs directory exists", async () => {
    await rm(runsDir, { recursive: true, force: true });

    const res = await fetch(`${base}/api/hench/runs/reconcile`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ended).toBe(0);
    expect(data.outcomes).toEqual([]);
  });
});
