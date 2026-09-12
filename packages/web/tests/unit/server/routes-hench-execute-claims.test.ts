/**
 * Execute route vs. cross-worktree task claims.
 *
 * `activeExecutions` only ever sees this server's own children, so before
 * claims existed the dashboard would happily start a second agent on a task
 * another checkout was already running — two agents, one PRD item, the same
 * files. The route now asks the repository, not just itself.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute, resetHenchRouteStateForTests, shutdownActiveExecutions } from "../../../src/server/routes-hench.js";
import { openClaimsStore } from "../../../src/server/rex-gateway.js";
import {
  startRouteTestServer,
  closeRouteTestServer,
  removeTestDir,
} from "../../helpers/server-route-test-support.js";

/** A live PID that is not this process, so its claims read as someone else's. */
const LIVE_FOREIGN_PID = process.ppid;

/** The worktree the claim is attributed to — any path but this checkout's. */
const OTHER_WORKTREE = "/elsewhere/checkout";

describe("POST /api/hench/execute — claimed elsewhere", () => {
  let tmpDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    tmpDir = await mkdtemp(join(tmpdir(), "hench-execute-claims-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await mkdir(join(tmpDir, ".hench", "runs"), { recursive: true });

    // A real repository: the claims store lives in the git common dir, and has
    // nothing to read outside one.
    execFileSync("git", ["init", "--quiet"], { cwd: tmpDir, stdio: "ignore" });

    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "Test PRD",
        items: [{ id: "task-1", title: "Contested Task", status: "pending", level: "task" }],
      }, null, 2),
    );

    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };

    const result = await startRouteTestServer((req, res) =>
      Promise.resolve(handleHenchRoute(req, res, ctx)),
    );
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await shutdownActiveExecutions(500).catch(() => {});
    await removeTestDir(tmpDir);
  });

  function execute(taskId: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
  }

  it("returns 409 naming the worktree holding the claim", async () => {
    await openClaimsStore(tmpDir).claim("task-1", {
      pid: LIVE_FOREIGN_PID,
      worktreeRoot: OTHER_WORKTREE,
    });

    const res = await execute("task-1");
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain(OTHER_WORKTREE);
    expect(body.claimedBy).toMatchObject({ worktreeRoot: OTHER_WORKTREE, pid: LIVE_FOREIGN_PID });
  });

  it("does not block on a claim this worktree holds", async () => {
    // Re-running a task this checkout already claimed — after a crash, say — is
    // the operator's own work, not a collision.
    await openClaimsStore(tmpDir).claim("task-1", { pid: LIVE_FOREIGN_PID });

    const res = await execute("task-1");
    expect(res.status).not.toBe(409);
  });

  it("does not block on a claim whose owning process is gone", async () => {
    await mkdir(join(tmpDir, ".git", "ndx"), { recursive: true });
    await writeFile(
      join(tmpDir, ".git", "ndx", "claims.json"),
      JSON.stringify({
        claims: [{
          taskId: "task-1",
          pid: 999_999_999,
          worktreeRoot: OTHER_WORKTREE,
          claimedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }],
      }),
    );

    const res = await execute("task-1");
    expect(res.status).not.toBe(409);
  });
});
