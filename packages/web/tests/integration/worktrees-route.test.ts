/**
 * GET /api/worktrees against a real repository with linked worktrees.
 *
 * Real git rather than a mocked `listWorktrees`: the route's value is the
 * join between git's worktree registry and the per-checkout artifacts hench
 * and `ndx start` leave behind (`.hench/runs/`, `.n-dx-web.pid/.port`), and
 * only a real layout exercises that join end to end.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../src/server/types.js";
import {
  handleWorktreesRoute,
  clearWorktreesCache,
  type WorktreeEntry,
} from "../../src/server/routes-worktrees.js";
import { startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function writeRun(
  worktree: string,
  id: string,
  status: string,
  finishedAt?: string,
  startedAt = "2026-09-16T10:00:00.000Z",
): void {
  const runsDir = join(worktree, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(
    join(runsDir, `${id}.json`),
    JSON.stringify({
      id,
      taskId: "task-1",
      taskTitle: `title for ${id}`,
      startedAt,
      ...(finishedAt ? { finishedAt } : {}),
      status,
      turns: 1,
      tokenUsage: { input: 1, output: 1 },
    }),
  );
}

function ctxFor(projectDir: string): ServerContext {
  return { projectDir, svDir: join(projectDir, ".sourcevision"), rexDir: join(projectDir, ".rex"), dev: false };
}

async function fetchWorktrees(server: RouteTestServer): Promise<WorktreeEntry[]> {
  const res = await fetch(`${server.baseUrl}/api/worktrees`);
  expect(res.status).toBe(200);
  return (await res.json()) as WorktreeEntry[];
}

/** Realpath'd: macOS tmpdir sits behind /var → /private/var; the route resolves symlinks. */
let tmpRoot: string;
let repo: string;
let linked: string;
let outside: string;

beforeAll(() => {
  tmpRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-worktrees-route-")));

  repo = join(tmpRoot, "main");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "commit", "--allow-empty", "--quiet", "-m", "root");

  linked = join(tmpRoot, "linked");
  git(repo, "worktree", "add", "--quiet", "-b", "side", linked);

  // One run file each; the linked one still running, the main one finished.
  writeRun(repo, "run-a", "completed", "2026-09-16T10:05:00.000Z");
  writeRun(repo, "run-b", "completed", "2026-09-16T11:00:00.000Z");
  writeRun(linked, "run-c", "running");

  // The linked worktree has a server: pid file from the orchestrator, port
  // file from the server itself.
  writeFileSync(join(linked, ".n-dx-web.pid"), JSON.stringify({ pid: 4242, port: 3117, startedAt: "x" }));
  writeFileSync(join(linked, ".n-dx-web.port"), "3118\n");

  // Dirty the main checkout; leave the linked one clean apart from the files
  // above, which git would otherwise count — ignore them there.
  writeFileSync(join(repo, "scratch.txt"), "dirty\n");
  writeFileSync(join(linked, ".gitignore"), ".hench/\n.n-dx-web.*\n.gitignore\n");

  outside = join(tmpRoot, "outside");
  mkdirSync(outside);
});

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  clearWorktreesCache();
});

describe("GET /api/worktrees", () => {
  let server: RouteTestServer;

  afterAll(async () => {
    await server?.close();
  });

  it("lists both worktrees with branch, head, anchor and served flags", async () => {
    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(repo)));
    const list = await fetchWorktrees(server);
    const head = git(repo, "rev-parse", "HEAD").trim();

    expect(list.map((w) => w.path).sort()).toEqual([repo, linked].sort());

    const main = list.find((w) => w.path === repo)!;
    const side = list.find((w) => w.path === linked)!;
    expect(main).toMatchObject({ branch: "main", head, isAnchor: true, isServed: true, detached: false, bare: false });
    expect(side).toMatchObject({ branch: "side", head, isAnchor: false, isServed: false });
    await server.close();
  });

  it("reports dirty state per worktree", async () => {
    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(repo)));
    const list = await fetchWorktrees(server);

    const main = list.find((w) => w.path === repo)!;
    const side = list.find((w) => w.path === linked)!;
    expect(main.dirty).toBe(true);
    expect(main.dirtyFiles).toBeGreaterThan(0);
    expect(side).toMatchObject({ dirty: false, dirtyFiles: 0 });
    await server.close();
  });

  it("summarises each worktree's hench runs", async () => {
    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(repo)));
    const list = await fetchWorktrees(server);

    expect(list.find((w) => w.path === repo)!.runs).toEqual({
      total: 2,
      running: 0,
      lastFinishedAt: "2026-09-16T11:00:00.000Z",
      // No run is in flight, so the most recently finished one is shown.
      latest: {
        id: "run-b",
        status: "completed",
        taskTitle: "title for run-b",
        startedAt: "2026-09-16T10:00:00.000Z",
        finishedAt: "2026-09-16T11:00:00.000Z",
      },
    });
    expect(list.find((w) => w.path === linked)!.runs).toEqual({
      total: 1,
      running: 1,
      lastFinishedAt: null,
      latest: {
        id: "run-c",
        status: "running",
        taskTitle: "title for run-c",
        startedAt: "2026-09-16T10:00:00.000Z",
        finishedAt: null,
      },
    });
    await server.close();
  });

  it("shows a running run over a newer finished one", async () => {
    // The linked worktree's only run is already running; give the anchor one
    // too, started before both of its finished runs.
    writeRun(repo, "run-live", "running", undefined, "2026-09-16T09:00:00.000Z");
    clearWorktreesCache();
    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(repo)));
    const list = await fetchWorktrees(server);

    const main = list.find((w) => w.path === repo)!;
    expect(main.runs.running).toBe(1);
    expect(main.runs.latest).toMatchObject({ id: "run-live", status: "running" });
    // The finished-run watermark is unaffected by the running run.
    expect(main.runs.lastFinishedAt).toBe("2026-09-16T11:00:00.000Z");

    rmSync(join(repo, ".hench", "runs", "run-live.json"));
    clearWorktreesCache();
    await server.close();
  });

  it("reports server presence from the pid and port files, port file winning", async () => {
    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(repo)));
    const list = await fetchWorktrees(server);

    expect(list.find((w) => w.path === linked)!.server).toEqual({ pidFile: true, pid: 4242, port: 3118 });
    expect(list.find((w) => w.path === repo)!.server).toEqual({ pidFile: false, pid: null, port: null });
    await server.close();
  });

  it("marks the linked worktree as served when the server runs from it", async () => {
    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(linked)));
    const list = await fetchWorktrees(server);

    expect(list.find((w) => w.path === linked)!.isServed).toBe(true);
    expect(list.find((w) => w.path === repo)!.isServed).toBe(false);
    await server.close();
  });

  it("returns [] with 200 outside a repository", async () => {
    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(outside)));
    expect(await fetchWorktrees(server)).toEqual([]);
    await server.close();
  });

  it("serves the cached answer within the TTL", async () => {
    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(repo)));
    const first = await fetchWorktrees(server);

    // A change git would see is invisible until the cache expires or is cleared.
    writeFileSync(join(repo, "another.txt"), "x\n");
    const second = await fetchWorktrees(server);
    expect(second).toEqual(first);

    clearWorktreesCache();
    const third = await fetchWorktrees(server);
    expect(third.find((w) => w.path === repo)!.dirtyFiles).toBe(first.find((w) => w.path === repo)!.dirtyFiles! + 1);
    await server.close();
  });

  it("ignores other paths and methods", async () => {
    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(repo)));
    expect((await fetch(`${server.baseUrl}/api/worktrees/x`)).status).toBe(404);
    expect((await fetch(`${server.baseUrl}/api/worktrees`, { method: "POST" })).status).toBe(404);
    await server.close();
  });
});
