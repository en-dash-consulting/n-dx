/**
 * GET /api/hench/runs?scope=repo — cross-worktree aggregation.
 *
 * Real git: the scope is defined by `git worktree list`, so a mocked list
 * would only test that the route trusts its input. Two worktrees, run files
 * in each, and a served directory that is one of them.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute, closeWorktreeRunWatchers } from "../../../src/server/routes-hench.js";
import { startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function writeRun(worktree: string, id: string, startedAt: string, taskId = "task-1"): void {
  const runsDir = join(worktree, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(
    join(runsDir, `${id}.json`),
    JSON.stringify({
      id, taskId, taskTitle: "t", startedAt, status: "completed", turns: 1,
      model: "sonnet", tokenUsage: { input: 1, output: 1 },
    }),
  );
}

function ctxFor(projectDir: string): ServerContext {
  return { projectDir, svDir: join(projectDir, ".sourcevision"), rexDir: join(projectDir, ".rex"), dev: false };
}

let tmpRoot: string;
let repo: string;
let linked: string;
let outside: string;

beforeAll(() => {
  tmpRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-runs-scope-")));
  repo = join(tmpRoot, "main");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "commit", "--allow-empty", "--quiet", "-m", "root");
  linked = join(tmpRoot, "linked");
  git(repo, "worktree", "add", "--quiet", "-b", "side", linked);

  writeRun(repo, "run-main-old", "2026-09-16T09:00:00.000Z");
  writeRun(repo, "run-main-new", "2026-09-16T11:00:00.000Z", "task-2");
  writeRun(linked, "run-side", "2026-09-16T10:00:00.000Z");

  outside = join(tmpRoot, "outside");
  writeRun(outside, "run-outside", "2026-09-16T08:00:00.000Z");
});

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("GET /api/hench/runs scope", () => {
  let server: RouteTestServer;

  afterEach(async () => {
    closeWorktreeRunWatchers();
    await server?.close();
  });

  async function serve(projectDir: string, broadcast?: (msg: unknown) => void): Promise<RouteTestServer> {
    return startRouteTestServer((req, res) =>
      handleHenchRoute(req, res, ctxFor(projectDir), broadcast as never),
    );
  }

  it("default scope lists only the served directory, unannotated", async () => {
    server = await serve(repo);
    const data = await (await fetch(`${server.baseUrl}/api/hench/runs`)).json();

    expect(data.total).toBe(2);
    expect(data.runs.map((r: { id: string }) => r.id)).toEqual(["run-main-new", "run-main-old"]);
    expect(data.runs.every((r: { worktree?: unknown }) => r.worktree === undefined)).toBe(true);
  });

  it("scope=repo merges every worktree's runs, newest first, each tagged with its worktree", async () => {
    server = await serve(repo);
    const data = await (await fetch(`${server.baseUrl}/api/hench/runs?scope=repo`)).json();

    expect(data.total).toBe(3);
    expect(data.runs.map((r: { id: string }) => r.id)).toEqual(["run-main-new", "run-side", "run-main-old"]);

    const side = data.runs.find((r: { id: string }) => r.id === "run-side");
    expect(side.worktree).toEqual({ name: "linked", path: linked, branch: "side" });
    const main = data.runs.find((r: { id: string }) => r.id === "run-main-new");
    expect(main.worktree).toEqual({ name: "main", path: repo, branch: "main" });
  });

  it("scope=repo gives the same answer served from the linked worktree", async () => {
    server = await serve(linked);
    const data = await (await fetch(`${server.baseUrl}/api/hench/runs?scope=repo`)).json();

    expect(data.runs.map((r: { id: string }) => r.id)).toEqual(["run-main-new", "run-side", "run-main-old"]);
  });

  it("applies taskId filter and pagination to the merged list", async () => {
    server = await serve(repo);

    const byTask = await (await fetch(`${server.baseUrl}/api/hench/runs?scope=repo&taskId=task-1`)).json();
    expect(byTask.total).toBe(2);
    expect(byTask.runs.map((r: { id: string }) => r.id)).toEqual(["run-side", "run-main-old"]);

    const page = await (await fetch(`${server.baseUrl}/api/hench/runs?scope=repo&limit=1&offset=1`)).json();
    expect(page.total).toBe(3);
    expect(page.runs.map((r: { id: string }) => r.id)).toEqual(["run-side"]);
  });

  it("scope=repo on the detail route finds a run in another worktree and tags it", async () => {
    server = await serve(repo);

    const withScope = await fetch(`${server.baseUrl}/api/hench/runs/run-side?scope=repo`);
    expect(withScope.status).toBe(200);
    const run = await withScope.json();
    expect(run.id).toBe("run-side");
    expect(run.worktree).toEqual({ name: "linked", path: linked, branch: "side" });

    // Default scope is unchanged: that run is not in the served directory.
    expect((await fetch(`${server.baseUrl}/api/hench/runs/run-side`)).status).toBe(404);
  });

  it("scope=repo outside a repository falls back to the served directory", async () => {
    server = await serve(outside);
    const data = await (await fetch(`${server.baseUrl}/api/hench/runs?scope=repo`)).json();

    expect(data.total).toBe(1);
    expect(data.runs[0].id).toBe("run-outside");
    expect(data.runs[0].worktree).toBeUndefined();
  });

  it("a new run file in another worktree broadcasts hench:run-changed", async () => {
    const broadcast = vi.fn();
    server = await serve(repo, broadcast);
    // The first repo-scope request is what registers the watcher.
    await fetch(`${server.baseUrl}/api/hench/runs?scope=repo`);

    writeRun(linked, "run-side-2", "2026-09-16T12:00:00.000Z");

    await vi.waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "hench:run-changed" }),
      );
    }, { timeout: 4_000, interval: 50 });
  });
});
