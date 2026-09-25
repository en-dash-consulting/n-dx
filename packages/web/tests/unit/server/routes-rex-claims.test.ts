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
 * GET /api/rex/claims — the live claims in the repository's shared store, as
 * the dashboard renders them: task title joined from this workspace's PRD,
 * the claiming worktree's basename for the chip, and whether the claim is
 * held from the served checkout. Dead-pid claims are not live and do not
 * appear; outside a repository the list is empty.
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

const PRD = {
  schema: "rex/v1",
  title: "Claims",
  items: [
    { id: "e1", title: "Epic", status: "in_progress", level: "epic", children: [
      { id: "t-known", title: "Known task", status: "pending", level: "task" },
    ] },
  ],
};

describe("GET /api/rex/claims", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  const children: ChildProcess[] = [];

  beforeEach(async () => {
    tmpDir = realpathSync.native(await mkdtemp(join(tmpdir(), "rex-claims-api-")));
    const rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(PRD));
    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    for (const c of children.splice(0)) c.kill();
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** A live process to hold a claim — a finished pid reads as a dead holder. */
  function liveHolder(): number {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    children.push(child);
    return child.pid!;
  }

  async function writeClaims(claims: Record<string, unknown>): Promise<void> {
    await mkdir(join(tmpDir, ".git", "ndx"), { recursive: true });
    await writeFile(join(tmpDir, ".git", "ndx", "claims.json"), JSON.stringify({ version: 1, claims }));
  }

  it("answers an empty list outside a git repository", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/rex/claims`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claims).toEqual([]);
    expect(body.servedWorktree).toBe(tmpDir);
  });

  it("lists live claims with the worktree label, title from this PRD, and whether they are held here", async () => {
    execFileSync("git", ["init", "--quiet"], { cwd: tmpDir, stdio: "ignore" });
    const otherPid = liveHolder();
    const soon = new Date(Date.now() + 60_000).toISOString();
    await writeClaims({
      "t-known": {
        taskId: "t-known", worktreeRoot: "/repos/app/.claude/worktrees/feature-x", pid: otherPid, host: "box",
        claimedAt: "2026-09-16T10:00:00.000Z", expiresAt: soon,
      },
      "t-elsewhere-only": {
        taskId: "t-elsewhere-only", worktreeRoot: "/repos/app/.claude/worktrees/feature-y", pid: otherPid, host: "box",
        claimedAt: "2026-09-16T10:01:00.000Z", expiresAt: soon,
      },
      "t-mine": {
        taskId: "t-mine", worktreeRoot: tmpDir, pid: process.pid, host: "box",
        claimedAt: "2026-09-16T10:02:00.000Z", expiresAt: soon,
      },
      "t-dead": {
        taskId: "t-dead", worktreeRoot: "/repos/app/.claude/worktrees/feature-z", pid: 2 ** 22 + 4242, host: "box",
        claimedAt: "2026-09-16T09:00:00.000Z", expiresAt: soon,
      },
      "t-expired": {
        taskId: "t-expired", worktreeRoot: "/repos/app/.claude/worktrees/feature-z", pid: otherPid, host: "box",
        claimedAt: "2026-09-16T08:00:00.000Z", expiresAt: "2026-09-16T08:00:01.000Z",
      },
      // A hold left by a finished run: the pid is dead on purpose, and the
      // claim is still live because it carries a reason.
      "t-held": {
        taskId: "t-held", worktreeRoot: "/repos/app/.claude/worktrees/feature-w", pid: 2 ** 22 + 4243, host: "box",
        claimedAt: "2026-09-16T09:30:00.000Z", expiresAt: soon, reason: "uncommitted-work",
      },
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/rex/claims`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.servedWorktree).toBe(tmpDir);
    expect(body.claims.map((c: { taskId: string }) => c.taskId)).toEqual(["t-held", "t-known", "t-elsewhere-only", "t-mine"]);

    const [held, known, elsewhere, mine] = body.claims;
    // The reason rides along on a held claim, and only there — a live run's
    // claim must not grow the field, so the dashboard can tell them apart.
    expect(held).toMatchObject({ taskId: "t-held", reason: "uncommitted-work", worktree: "feature-w" });
    expect(known.reason).toBeUndefined();
    expect(mine.reason).toBeUndefined();
    expect(known).toMatchObject({
      taskId: "t-known",
      taskTitle: "Known task",
      worktree: "feature-x",
      worktreeRoot: "/repos/app/.claude/worktrees/feature-x",
      isServedHere: false,
      pid: otherPid,
      host: "box",
      expiresAt: soon,
    });
    // A task that exists only in the claiming worktree's tree has no title here.
    expect(elsewhere).toMatchObject({ taskId: "t-elsewhere-only", taskTitle: null, worktree: "feature-y" });
    expect(mine).toMatchObject({ isServedHere: true, pid: process.pid });
  });

  it("only answers GET", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/rex/claims`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
