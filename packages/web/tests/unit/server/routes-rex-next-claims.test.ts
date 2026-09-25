import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

/**
 * GET /api/rex/next and /api/rex/dashboard skip tasks another worktree holds
 * (WM2047, PR E). The Execute route refuses a claimed task with 409, so a
 * suggestion that ignored claims was a suggestion Execute then rejected. The
 * selection must exclude exactly the set Execute's check consults — foreign
 * live claims for the request's workspace — and say which higher-priority
 * task was passed over, so the card can name the holder.
 */

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const result = handleRexRoute(req, res, ctx);
      if (result instanceof Promise ? await result : result) return;
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

// t-high outranks t-low, so an unclaimed tree always suggests t-high.
const PRD = {
  schema: "rex/v1",
  title: "Next vs claims",
  items: [
    { id: "e1", title: "Epic", status: "in_progress", level: "epic", children: [
      { id: "t-high", title: "High priority task", status: "pending", level: "task", priority: "critical" },
      { id: "t-low", title: "Lower priority task", status: "pending", level: "task", priority: "medium" },
    ] },
  ],
};

const FOREIGN_WORKTREE = "/repos/app/.claude/worktrees/feature-x";

describe("next-task reads vs live claims", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  const children: ChildProcess[] = [];

  beforeEach(async () => {
    tmpDir = realpathSync.native(await mkdtemp(join(tmpdir(), "rex-next-claims-")));
    const rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(PRD));
    execFileSync("git", ["init", "--quiet"], { cwd: tmpDir, stdio: "ignore" });
    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    for (const c of children.splice(0)) c.kill();
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  /** A live process to hold a claim — a finished pid reads as a dead holder. */
  function liveHolder(): number {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    children.push(child);
    return child.pid!;
  }

  async function writeClaim(taskId: string, worktreeRoot: string, pid: number): Promise<void> {
    await mkdir(join(tmpDir, ".git", "ndx"), { recursive: true });
    await writeFile(
      join(tmpDir, ".git", "ndx", "claims.json"),
      JSON.stringify({
        version: 1,
        claims: {
          [taskId]: {
            taskId, worktreeRoot, pid, host: "box",
            claimedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      }),
    );
  }

  it("suggests the highest-priority task when nothing is claimed", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/rex/next`);
    const body = await res.json();
    expect(body.task.id).toBe("t-high");
    expect(body.skipped).toBeUndefined();
  });

  it("skips a foreign live claim and names the passed-over task and its worktree", async () => {
    await writeClaim("t-high", FOREIGN_WORKTREE, liveHolder());

    const res = await fetch(`http://127.0.0.1:${port}/api/rex/next`);
    const body = await res.json();
    // The suggestion is a task Execute will accept: its 409 check is
    // membership in exactly this foreign-claims set.
    expect(body.task.id).toBe("t-low");
    expect(body.skipped).toMatchObject({
      taskId: "t-high",
      title: "High priority task",
      worktree: "feature-x",
      worktreeRoot: FOREIGN_WORKTREE,
    });
  });

  it("does not exclude a claim held by the served worktree itself", async () => {
    await writeClaim("t-high", tmpDir, process.pid);

    const res = await fetch(`http://127.0.0.1:${port}/api/rex/next`);
    const body = await res.json();
    expect(body.task.id).toBe("t-high");
    expect(body.skipped).toBeUndefined();
  });

  it("the dashboard's next task agrees, with the same skipped entry", async () => {
    await writeClaim("t-high", FOREIGN_WORKTREE, liveHolder());

    const res = await fetch(`http://127.0.0.1:${port}/api/rex/dashboard`);
    const body = await res.json();
    expect(body.nextTask.id).toBe("t-low");
    expect(body.nextTaskSkipped).toMatchObject({ taskId: "t-high", worktree: "feature-x" });
  });

  it("reports null with no unclaimed task left, still naming what was skipped", async () => {
    const singleTask = {
      ...PRD,
      items: [{ id: "e1", title: "Epic", status: "in_progress", level: "epic", children: [
        { id: "t-high", title: "High priority task", status: "pending", level: "task", priority: "critical" },
      ] }],
    };
    await writeFile(join(tmpDir, ".rex", "prd.json"), JSON.stringify(singleTask));
    await writeClaim("t-high", FOREIGN_WORKTREE, liveHolder());

    const res = await fetch(`http://127.0.0.1:${port}/api/rex/next`);
    const body = await res.json();
    expect(body.task).toBeNull();
    expect(body.skipped).toMatchObject({ taskId: "t-high", worktree: "feature-x" });
  });
});
