/**
 * Run modes on POST /api/hench/execute — `single`, `iterations`, `loop`.
 *
 * The dashboard could only ever start one task. `hench run` has had
 * `--iterations` and `--loop` all along, so working through a queue meant
 * leaving the dashboard for a terminal; these tests pin that the route now
 * reaches both, and — just as load-bearing — that a request naming no mode
 * produces exactly the argv it always did.
 *
 * The bounds on `iterations` are part of the contract rather than UI polish:
 * the spawned process outlives the tab that started it, so an unbounded count
 * from a form field is a commitment nobody can take back from the browser.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";

const { spawnManagedMock } = vi.hoisted(() => ({ spawnManagedMock: vi.fn() }));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, spawnManaged: spawnManagedMock };
});

import type { ServerContext } from "../../../src/server/types.js";
import {
  handleHenchRoute,
  resetHenchRouteStateForTests,
  MAX_DASHBOARD_ITERATIONS,
} from "../../../src/server/routes-hench.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

describe("POST /api/hench/execute — run modes", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  /** Start `taskId` with `body`, and return the argv the child was spawned with. */
  async function execute(body: Record<string, unknown>) {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", ...body }),
    });
    const data = await res.json().catch(() => ({}));
    const call = spawnManagedMock.mock.calls[0] as [string, string[], unknown] | undefined;
    return { status: res.status, data, args: call ? call[1] : undefined };
  }

  /** Ask `POST /api/hench/execute/check` what `body` would get, without starting it. */
  async function check(body: Record<string, unknown>) {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", ...body }),
    });
    return await res.json() as { ok: boolean; status?: number; error?: string };
  }

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    spawnManagedMock.mockReset();
    spawnManagedMock.mockReturnValue({
      done: new Promise(() => {}),
      kill: vi.fn(() => true),
      pid: 4242,
    });

    tmpDir = await mkdtemp(join(tmpdir(), "hench-execute-modes-"));
    const rexDir = join(tmpDir, ".rex");
    await mkdir(join(rexDir, ".cache"), { recursive: true });
    await mkdir(join(tmpDir, ".hench", "runs"), { recursive: true });
    await writeFile(
      join(rexDir, ".cache", "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "modes",
        items: [{ id: "task-1", title: "Add dark mode toggle", status: "pending", level: "task" }],
      }),
    );

    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
    const started = await startRouteTestServer((req, res) =>
      Promise.resolve(handleHenchRoute(req, res, ctx)),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("sends no mode flag when the request names no mode", async () => {
    // The compatibility case. Every client written before run modes existed
    // sends exactly this body, and must keep getting a one-task run.
    const { status, args } = await execute({});
    expect(status).toBe(202);
    expect(args).toContain("--auto");
    expect(args).not.toContain("--loop");
    expect(args?.some((a) => a.startsWith("--iterations="))).toBe(false);
  });

  it("passes --loop for the loop mode", async () => {
    const { status, args, data } = await execute({ mode: "loop" });
    expect(status).toBe(202);
    expect(args).toContain("--loop");
    // --task still names where to start; hench autoselects from there.
    expect(args).toContain("--task=task-1");
    expect(args).toContain("--auto");
    expect(data.mode).toBe("loop");
  });

  it("passes --iterations=<n> for the iterations mode", async () => {
    const { status, args, data } = await execute({ mode: "iterations", iterations: 4 });
    expect(status).toBe(202);
    expect(args).toContain("--iterations=4");
    expect(args).not.toContain("--loop");
    expect(data).toMatchObject({ mode: "iterations", iterations: 4 });
  });

  it("keeps --reset-deferred alongside a mode flag", async () => {
    // The two are independent: a deferred task still has to be reset before
    // it can run, whether the click starts one task or twenty.
    await writeFile(
      join(ctx.rexDir, ".cache", "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "modes",
        items: [{ id: "task-1", title: "Add dark mode toggle", status: "deferred", level: "task" }],
      }),
    );
    const { args } = await execute({ mode: "loop" });
    expect(args).toContain("--reset-deferred");
    expect(args).toContain("--loop");
    // The project directory stays the final positional argument.
    expect(args?.[args.length - 1]).toBe(tmpDir);
  });

  it("rejects an unknown mode without spawning anything", async () => {
    const { status, data } = await execute({ mode: "epic-by-epic" });
    expect(status).toBe(400);
    expect(data.error).toContain("mode must be one of");
    expect(spawnManagedMock).not.toHaveBeenCalled();
  });

  it("refuses an iterations mode with no count", async () => {
    // Deliberately not defaulted to 1: a client that lost its number would
    // otherwise get a successful one-task run nobody asked for.
    const { status } = await execute({ mode: "iterations" });
    expect(status).toBe(400);
    expect(spawnManagedMock).not.toHaveBeenCalled();
  });

  it.each([1, 0, -3, 2.5, MAX_DASHBOARD_ITERATIONS + 1])(
    "refuses iterations=%s",
    async (iterations) => {
      const { status } = await execute({ mode: "iterations", iterations });
      expect(status).toBe(400);
      expect(spawnManagedMock).not.toHaveBeenCalled();
    },
  );

  it("accepts the documented maximum", async () => {
    const { status, args } = await execute({
      mode: "iterations",
      iterations: MAX_DASHBOARD_ITERATIONS,
    });
    expect(status).toBe(202);
    expect(args).toContain(`--iterations=${MAX_DASHBOARD_ITERATIONS}`);
  });

  it("answers for the mode on execute/check, which the hub asks before queuing", async () => {
    // The hub queues on the strength of this route's answer. A mode only the
    // spawn refused would be admitted, queued, and replayed as a single task —
    // the direct route's 400 turned into a quieter, later, wrong run.
    expect(await check({ mode: "looop" })).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining("mode must be one of"),
    });
    expect(await check({ mode: "iterations" })).toMatchObject({ ok: false, status: 400 });
    expect(await check({ mode: "iterations", iterations: MAX_DASHBOARD_ITERATIONS + 1 }))
      .toMatchObject({ ok: false, status: 400 });
    expect(spawnManagedMock).not.toHaveBeenCalled();
  });

  it("passes a mode it would run on execute/check", async () => {
    expect(await check({ mode: "loop" })).toMatchObject({ ok: true });
    expect(await check({ mode: "iterations", iterations: 3 })).toMatchObject({ ok: true });
    expect(await check({})).toMatchObject({ ok: true });
    expect(spawnManagedMock).not.toHaveBeenCalled();
  });

  it("reports the mode on the execution status", async () => {
    await execute({ mode: "iterations", iterations: 3 });
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute/status`);
    const body = await res.json() as { executions: { mode?: string; iterations?: number }[] };
    expect(body.executions[0]).toMatchObject({ mode: "iterations", iterations: 3 });
  });
});
