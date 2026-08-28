/**
 * Regression coverage for "Start Working" (POST /api/hench/execute) on a
 * real, non-monorepo project.
 *
 * `handleExecute` used to resolve the hench binary itself:
 * `<projectDir>/node_modules/.bin/hench`, falling back to
 * `<projectDir>/packages/hench/dist/cli/index.js`. The fallback is only
 * ever correct when `projectDir` *is* the n-dx monorepo — every real
 * analyzed project has no `packages/hench` directory, so "Start Working"
 * failed immediately with `MODULE_NOT_FOUND` (confirmed live against a real
 * external project during this session). The fix routes through `ndx work`
 * via `resolveNdxBin` (the same cross-install resolution ladder every other
 * command trigger in routes-commands.ts already uses — project-local
 * node_modules/.bin/ndx, the NDX_CLI_PATH/N_DX_CLI_PATH env vars the
 * launching CLI sets for every child it spawns, this server's own module
 * graph, then the monorepo dogfood path) instead of hench directly.
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
import { handleHenchRoute, resetHenchRouteStateForTests } from "../../../src/server/routes-hench.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

describe("POST /api/hench/execute — binary resolution on a real external project", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let envBackup: Record<string, string | undefined>;

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    spawnManagedMock.mockReset();
    // The child never needs to actually finish for this test — just capture
    // what it was spawned with.
    spawnManagedMock.mockReturnValue({
      done: new Promise(() => {}),
      kill: vi.fn(() => true),
      pid: 4242,
    });

    // Simulate a server NOT launched via `ndx start` (no inherited CLI path
    // env vars) and a target project that is a real external repo: no
    // node_modules/.bin/{ndx,hench}, no packages/{core,hench} dirs at all —
    // exactly car-track's shape.
    envBackup = { NDX_CLI_PATH: process.env.NDX_CLI_PATH, N_DX_CLI_PATH: process.env.N_DX_CLI_PATH };
    delete process.env.NDX_CLI_PATH;
    delete process.env.N_DX_CLI_PATH;

    tmpDir = await mkdtemp(join(tmpdir(), "hench-execute-external-"));
    const rexDir = join(tmpDir, ".rex");
    const henchDir = join(tmpDir, ".hench");
    await mkdir(rexDir, { recursive: true });
    await mkdir(henchDir, { recursive: true });
    await mkdir(join(henchDir, "runs"), { recursive: true });
    await mkdir(join(rexDir, ".cache"), { recursive: true });
    await writeFile(
      join(rexDir, ".cache", "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "car-track",
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
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("spawns `ndx work`, not a hench binary resolved under the target project", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(202);

    expect(spawnManagedMock).toHaveBeenCalledTimes(1);
    const [binPath, binArgs] = spawnManagedMock.mock.calls[0] as [string, string[], unknown];

    // Never the old broken path shape.
    expect(binPath).not.toContain(join(tmpDir, "node_modules", ".bin", "hench"));
    expect(binArgs.join(" ")).not.toContain(join(tmpDir, "packages", "hench"));
    expect(binArgs).not.toContain("run");

    // The `ndx work` shape: `work`, then the same flags the old code sent.
    expect(binArgs).toContain("work");
    expect(binArgs).toContain("--task=task-1");
    expect(binArgs).toContain("--auto");
    expect(binArgs[binArgs.length - 1]).toBe(tmpDir);
  });

  it("adds --reset-deferred when the task status is deferred", async () => {
    await writeFile(
      join(ctx.rexDir, ".cache", "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "car-track",
        items: [{ id: "task-1", title: "Add dark mode toggle", status: "deferred", level: "task" }],
      }),
    );

    await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });

    const [, binArgs] = spawnManagedMock.mock.calls[0] as [string, string[], unknown];
    expect(binArgs).toContain("--reset-deferred");
  });
});
