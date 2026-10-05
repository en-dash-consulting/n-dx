/**
 * POST /api/hench/execute reserves its task before the checks it awaits.
 *
 * Two near-simultaneous requests for one task (two tabs, or Start now while
 * the Prepare task modal executes) used to both pass `activeExecutions.has()`
 * while the first was still awaiting claims, and both spawned `ndx work`. The
 * reservation must refuse the second with 409 and be released on every exit,
 * so a refused or failed request never leaves the task unstartable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  spawnManaged: vi.fn(),
  isClaimedByOther: vi.fn(),
  checkTreeConformance: vi.fn(),
}));

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, spawnManaged: mocks.spawnManaged };
});

vi.mock("../../../src/server/rex-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/rex-gateway.js")>();
  return {
    ...actual,
    openClaimsStore: () => ({ isClaimedByOther: mocks.isClaimedByOther }),
    resolveStore: async () => ({ loadDocument: async () => ({ items: [] }) }),
    checkTreeConformance: mocks.checkTreeConformance,
  };
});

import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute, resetHenchRouteStateForTests } from "../../../src/server/routes-hench.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

describe("POST /api/hench/execute — per-task start reservation", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  function post(path: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const execute = (body: Record<string, unknown> = { taskId: "task-1" }) => post("/api/hench/execute", body);

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    mocks.spawnManaged.mockReset();
    mocks.spawnManaged.mockImplementation(() => ({
      done: new Promise(() => {}),
      kill: vi.fn(() => true),
      pid: 4242,
    }));
    mocks.isClaimedByOther.mockReset();
    mocks.isClaimedByOther.mockResolvedValue(null);
    mocks.checkTreeConformance.mockReset();
    mocks.checkTreeConformance.mockResolvedValue(null);

    tmpDir = await mkdtemp(join(tmpdir(), "hench-execute-reservation-"));
    const rexDir = join(tmpDir, ".rex");
    await mkdir(join(rexDir, ".cache"), { recursive: true });
    await mkdir(join(tmpDir, ".hench", "runs"), { recursive: true });
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
    await writeFile(
      join(rexDir, ".cache", "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "reservation",
        items: [{ id: "task-1", title: "Reserved task", status: "pending", level: "task" }],
      }),
    );
    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };

    const started = await startRouteTestServer((req, res) => Promise.resolve(handleHenchRoute(req, res, ctx)));
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("spawns one run for two concurrent requests; the second answers 409 already starting", async () => {
    let releaseClaims!: () => void;
    mocks.isClaimedByOther.mockImplementationOnce(
      () => new Promise((resolve) => { releaseClaims = () => resolve(null); }),
    );

    const first = execute();
    await vi.waitFor(() => expect(mocks.isClaimedByOther).toHaveBeenCalledTimes(1));

    const second = await execute();
    expect(second.status).toBe(409);
    expect((await second.json()).error).toMatch(/already starting/);

    // The check route reports the same refusal without spawning.
    const check = await (await post("/api/hench/execute/check", { taskId: "task-1" })).json();
    expect(check).toMatchObject({ ok: false, status: 409 });

    releaseClaims();
    expect((await first).status).toBe(202);
    expect(mocks.spawnManaged).toHaveBeenCalledTimes(1);

    // Once spawned, the running entry refuses with its run id.
    const third = await execute();
    expect(third.status).toBe(409);
    expect((await third.json()).runId).toBeTruthy();
  });

  it("a different task is not held by another task's reservation", async () => {
    let releaseClaims!: () => void;
    mocks.isClaimedByOther.mockImplementationOnce(
      () => new Promise((resolve) => { releaseClaims = () => resolve(null); }),
    );
    const first = execute();
    await vi.waitFor(() => expect(mocks.isClaimedByOther).toHaveBeenCalledTimes(1));
    const other = await execute({ taskId: "missing-task" });
    expect(other.status).toBe(404);
    releaseClaims();
    expect((await first).status).toBe(202);
  });

  it("releases after a 400 (invalid options)", async () => {
    expect((await execute({ taskId: "task-1", options: { notAnOption: true } })).status).toBe(400);
    expect((await execute()).status).toBe(202);
  });

  it("releases after a 409 (claimed by another worktree)", async () => {
    mocks.isClaimedByOther.mockResolvedValueOnce({
      worktreeRoot: "/elsewhere",
      pid: 1,
      host: "h",
      claimedAt: "2026-10-02T00:00:00.000Z",
      expiresAt: "2026-10-02T01:00:00.000Z",
    });
    expect((await execute()).status).toBe(409);
    expect((await execute()).status).toBe(202);
  });

  it("releases after a 412 (non-conformant PRD tree)", async () => {
    await mkdir(join(ctx.rexDir, "prd_tree"), { recursive: true });
    mocks.checkTreeConformance.mockResolvedValueOnce({ message: "tree needs migration", migratable: true });
    expect((await execute()).status).toBe(412);
    expect((await execute()).status).toBe(202);
  });

  it("releases after the spawn throws", async () => {
    mocks.spawnManaged.mockImplementationOnce(() => { throw new Error("spawn EACCES"); });
    const failed = await execute({ taskId: "task-1", options: { contextNotes: "notes" } });
    expect(failed.status).toBe(500);
    expect((await failed.json()).error).toMatch(/spawn EACCES/);
    expect((await execute()).status).toBe(202);
    expect(mocks.spawnManaged).toHaveBeenCalledTimes(2);
  });

  it("releases after the spawned run fails to start", async () => {
    mocks.spawnManaged.mockImplementationOnce(() => ({
      done: Promise.reject(new Error("spawn ENOENT")),
      kill: vi.fn(() => true),
      pid: undefined,
    }));
    expect((await execute()).status).toBe(202);
    await vi.waitFor(async () => expect((await execute()).status).toBe(202));
    expect(mocks.spawnManaged).toHaveBeenCalledTimes(2);
  });
});
