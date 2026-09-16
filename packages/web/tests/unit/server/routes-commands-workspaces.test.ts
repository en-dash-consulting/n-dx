import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerResponse } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import {
  getCommandJobStatusesForTests,
  handleCommandsRoute,
  newJobStatus,
  startAsyncJob,
} from "../../../src/server/routes-commands.js";
import { startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

/**
 * Job trackers and the .sourcevision writer lock are per workspace: a job
 * started from worktree A neither blocks nor reports in worktree B. Driven
 * with `startAsyncJob` and a Node one-liner in place of a CLI, so no real
 * analysis runs and the timing is deterministic (the child sleeps 1.5 s).
 */
describe("routes-commands per-workspace state", () => {
  let dirA: string;
  let dirB: string;
  let ctxA: ServerContext;
  let ctxB: ServerContext;
  const servers: RouteTestServer[] = [];

  const sleepBin = process.execPath;
  const sleepArgs = ["-e", "setTimeout(() => {}, 1500)"];

  function fakeRes(): ServerResponse & { statusCode: number } {
    const res = { statusCode: 0, writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() } as unknown as ServerResponse & { statusCode: number };
    (res.writeHead as unknown as ReturnType<typeof vi.fn>).mockImplementation((code: number) => { res.statusCode = code; return res; });
    return res;
  }

  beforeEach(async () => {
    dirA = await mkdtemp(join(tmpdir(), "cmd-ws-a-"));
    dirB = await mkdtemp(join(tmpdir(), "cmd-ws-b-"));
    ctxA = { projectDir: dirA, svDir: join(dirA, ".sourcevision"), rexDir: join(dirA, ".rex"), dev: false, workspace: "a" };
    ctxB = { projectDir: dirB, svDir: join(dirB, ".sourcevision"), rexDir: join(dirB, ".rex"), dev: false, workspace: "b" };
  });

  afterEach(async () => {
    while (servers.length) await servers.pop()!.close();
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  });

  it("the .sourcevision writer lock is held per workspace", () => {
    // A takes A's lock.
    const r1 = fakeRes();
    startAsyncJob(r1, newJobStatus(), "CI check", sleepBin, sleepArgs, ctxA, 10_000, undefined, undefined, "CI check");
    expect(r1.statusCode).toBe(202);

    // B is not blocked by A's writer.
    const r2 = fakeRes();
    startAsyncJob(r2, newJobStatus(), "CI check", sleepBin, sleepArgs, ctxB, 10_000, undefined, undefined, "CI check");
    expect(r2.statusCode).toBe(202);

    // A second writer in A is — and the 409 names A's running job.
    const r3 = fakeRes();
    startAsyncJob(r3, newJobStatus(), "refresh", sleepBin, sleepArgs, ctxA, 10_000, undefined, undefined, "refresh");
    expect(r3.statusCode).toBe(409);
    const body = JSON.parse((r3.end as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
    expect(body.runningJob).toBe("CI check");
  });

  it("a job running in A is reported only by A's status endpoint", async () => {
    const serverA = await startRouteTestServer((req, res) => Promise.resolve(handleCommandsRoute(req, res, ctxA)));
    const serverB = await startRouteTestServer((req, res) => Promise.resolve(handleCommandsRoute(req, res, ctxB)));
    servers.push(serverA, serverB);

    // Drive A's own ci tracker — the object the route serializes — with the sleeper.
    startAsyncJob(fakeRes(), getCommandJobStatusesForTests(ctxA).ci, "CI check", sleepBin, sleepArgs, ctxA, 10_000);

    const inA = await (await fetch(`${serverA.baseUrl}/api/commands/ci/status`)).json();
    const inB = await (await fetch(`${serverB.baseUrl}/api/commands/ci/status`)).json();
    expect(inA.running).toBe(true);
    expect(inB.running).toBe(false);
    expect(inB.startedAt).toBeNull();

    // Every other tracker is distinct per workspace too.
    const a = getCommandJobStatusesForTests(ctxA);
    const b = getCommandJobStatusesForTests(ctxB);
    for (const key of ["ci", "reshape", "svAnalyze", "refresh", "selfHeal", "init"] as const) {
      expect(a[key]).not.toBe(b[key]);
    }
    // Same workspace, same object — the anchor keeps today's behaviour.
    expect(getCommandJobStatusesForTests({ ...ctxA }).ci).toBe(a.ci);
  });
});
