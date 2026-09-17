import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute, resetHenchRouteStateForTests, shutdownActiveExecutions } from "../../../src/server/routes-hench.js";
import { startRouteTestServer, removeTestDir, type RouteTestServer } from "../../helpers/server-route-test-support.js";

/**
 * Active executions are per workspace: a task started from worktree A shows
 * in A's status and audit, not in B's, and A's second start of the same task
 * is the only one refused.
 *
 * The route really spawns, so the entry lives exactly as long as the child —
 * and a temp project resolves no `ndx`, so the child used to be `node
 * <projectDir>/packages/core/cli.js`, which exits with MODULE_NOT_FOUND in
 * tens of milliseconds. That deletes the entry, and the duplicate start below
 * then gets a 202: the assertion was racing four HTTP round-trips against a
 * failing node boot, and lost in CI. `NDX_CLI_PATH` (rung 1 of resolveNdxBin)
 * points the spawn at a stub that just sleeps, so the child outlives the test
 * by construction and `shutdownActiveExecutions` is what ends it.
 */
describe("routes-hench per-workspace executions", () => {
  let dirA: string;
  let dirB: string;
  let binDir: string;
  let serverA: RouteTestServer;
  let serverB: RouteTestServer;
  let envBackup: Record<string, string | undefined>;

  async function project(dir: string): Promise<ServerContext> {
    const rexDir = join(dir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await mkdir(join(dir, ".hench", "runs"), { recursive: true });
    await writeFile(join(rexDir, "prd.json"), JSON.stringify({
      schema: "rex/v1", title: "PRD",
      items: [{ id: "task-1", title: "A task", status: "pending", level: "task" }],
    }));
    return { projectDir: dir, svDir: join(dir, ".sourcevision"), rexDir, dev: false, workspace: dir.endsWith("a") ? "a" : "b" };
  }

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    // Stand-in for `ndx work`: stays alive until SIGTERM (node's default
    // handler ends it), so an execution entry is only removed by shutdown.
    binDir = await mkdtemp(join(tmpdir(), "hench-ws-bin-"));
    const stub = join(binDir, "ndx-stub.cjs");
    await writeFile(stub, "setTimeout(() => process.exit(0), 60_000);\n");
    envBackup = { NDX_CLI_PATH: process.env["NDX_CLI_PATH"], N_DX_CLI_PATH: process.env["N_DX_CLI_PATH"] };
    process.env["NDX_CLI_PATH"] = stub;
    delete process.env["N_DX_CLI_PATH"];

    dirA = await mkdtemp(join(tmpdir(), "hench-ws-a-"));
    dirB = await mkdtemp(join(tmpdir(), "hench-ws-b-"));
    const ctxA = await project(dirA);
    const ctxB = await project(dirB);
    serverA = await startRouteTestServer((req, res) => Promise.resolve(handleHenchRoute(req, res, ctxA)));
    serverB = await startRouteTestServer((req, res) => Promise.resolve(handleHenchRoute(req, res, ctxB)));
  });

  afterEach(async () => {
    await serverA.close();
    await serverB.close();
    await shutdownActiveExecutions(500).catch(() => {});
    await removeTestDir(dirA);
    await removeTestDir(dirB);
    await removeTestDir(binDir);
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("an execution started in A is visible only in A", async () => {
    const start = await fetch(`${serverA.baseUrl}/api/hench/execute`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(start.status).toBe(202);

    const statusA = await (await fetch(`${serverA.baseUrl}/api/hench/execute/status`)).json();
    const statusB = await (await fetch(`${serverB.baseUrl}/api/hench/execute/status`)).json();
    expect(statusA.executions.map((e: { taskId: string }) => e.taskId)).toEqual(["task-1"]);
    expect(statusB.executions).toEqual([]);

    const auditB = await (await fetch(`${serverB.baseUrl}/api/hench/audit`)).json();
    expect(auditB.entries.filter((e: { source: string }) => e.source === "dashboard")).toEqual([]);
    expect(auditB.systemInfo.activeExecutions).toBe(0);

    // The same task id is free in B and busy in A.
    const againA = await fetch(`${serverA.baseUrl}/api/hench/execute`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(againA.status).toBe(409);
    const inB = await fetch(`${serverB.baseUrl}/api/hench/execute`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(inB.status).toBe(202);

    // Shutdown reaches both workspaces' executions.
    const result = await shutdownActiveExecutions(500);
    expect(result.terminated + result.failed).toBe(2);
  }, 30_000);
});
