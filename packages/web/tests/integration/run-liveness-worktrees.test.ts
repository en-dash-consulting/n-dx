/**
 * Liveness verdicts in GET /api/live and GET /api/hench/runs/health, for
 * running runs in every worktree of the repository — each judged against its
 * own worktree's lock files.
 *
 * Real git, because both endpoints find the other worktree through it (the
 * health route asks `git worktree list`; the Live route is handed the
 * registry's list, built the same way).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerContext } from "../../src/server/types.js";
import { clearLiveCaches, handleLiveRoute, type LiveSnapshot, type LiveSources } from "../../src/server/routes-live.js";
import { clearWorktreesCache } from "../../src/server/routes-worktrees.js";
import { handleHenchRoute, resetHenchRouteStateForTests } from "../../src/server/routes-hench.js";
import { startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";
import { removeTempDir } from "../helpers/temp-dir.js";

const MINUTE = 60_000;
/** Above every platform's pid limit, so `kill(pid, 0)` is ESRCH. */
const DEAD_PID = 2 ** 31 - 2;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

interface RunFixture {
  id: string;
  taskId: string;
  lastActivityAt: number;
  pid?: number;
  host?: string;
}

function writeRun(worktree: string, run: RunFixture, now: number): void {
  const runsDir = join(worktree, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${run.id}.json`), JSON.stringify({
    id: run.id,
    taskId: run.taskId,
    taskTitle: `title ${run.id}`,
    status: "running",
    startedAt: new Date(now - 20 * MINUTE).toISOString(),
    lastActivityAt: new Date(run.lastActivityAt).toISOString(),
    turns: 1,
    model: "claude-sonnet-4-5",
    tokenUsage: { input: 1, output: 1 },
    host: run.host ?? hostname(),
    ...(run.pid !== undefined ? { pid: run.pid } : {}),
  }));
}

function writeLock(worktree: string, pid: number, taskId: string, startedAt: number): void {
  const locksDir = join(worktree, ".hench", "locks");
  mkdirSync(locksDir, { recursive: true });
  writeFileSync(join(locksDir, `${pid}.lock`), JSON.stringify({ pid, startedAt: new Date(startedAt).toISOString(), taskId }));
}

function ctxFor(projectDir: string, workspace: string): ServerContext {
  return { projectDir, svDir: join(projectDir, ".sourcevision"), rexDir: join(projectDir, ".rex"), dev: false, workspace };
}

/** Run id → the verdict fields either endpoint reports. */
type Verdicts = Record<string, { liveness: string | null; canEnd: boolean | null; reason: string | null }>;

const EXPECTED = {
  // Served worktree
  "alive": { liveness: "live", canEnd: false },
  "hung": { liveness: "unknown", canEnd: false },
  "dead": { liveness: "orphaned", canEnd: true },
  // Other worktree
  "remote": { liveness: "foreign", canEnd: false },
  "locked": { liveness: "live", canEnd: false },
  "abandoned": { liveness: "orphaned", canEnd: true },
};

let tmpRoot: string;
let repo: string;
let linked: string;
let server: RouteTestServer;
let sources: LiveSources;

beforeAll(async () => {
  tmpRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-run-liveness-")));
  repo = join(tmpRoot, "main");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(repo, ".gitignore"), ".hench/\n.rex/\n.sourcevision/\n");
  git(repo, "add", ".gitignore");
  git(repo, "commit", "--quiet", "-m", "root");
  linked = join(tmpRoot, "linked");
  git(repo, "worktree", "add", "--quiet", "-b", "side", linked);

  const now = Date.now();
  writeRun(repo, { id: "alive", taskId: "t-alive", lastActivityAt: now - 5_000, pid: process.pid }, now);
  writeRun(repo, { id: "hung", taskId: "t-hung", lastActivityAt: now - 10 * MINUTE, pid: process.pid }, now);
  writeRun(repo, { id: "dead", taskId: "t-dead", lastActivityAt: now - 5_000, pid: DEAD_PID }, now);
  writeRun(linked, { id: "remote", taskId: "t-remote", lastActivityAt: now - 5_000, pid: process.pid, host: "some-other-host" }, now);
  // No pid recorded: the linked worktree's own lock file is the only evidence.
  writeRun(linked, { id: "locked", taskId: "t-locked", lastActivityAt: now - 5_000 }, now);
  writeLock(linked, process.pid, "t-locked", now - 20 * MINUTE);
  writeRun(linked, { id: "abandoned", taskId: "t-abandoned", lastActivityAt: now - 10 * MINUTE }, now);

  sources = {
    listWorkspaces: () => [
      { key: "main", path: repo, branch: "main", isAnchor: true },
      { key: "linked", path: linked, branch: "side", isAnchor: false },
    ],
    memoryFloorBytes: () => null,
  };
  server = await startRouteTestServer(async (req, res) => {
    const ctx = ctxFor(repo, "main");
    if (await handleLiveRoute(req, res, ctx, sources)) return true;
    return handleHenchRoute(req, res, ctx);
  });
});

afterAll(async () => {
  await server?.close();
  if (tmpRoot) await removeTempDir(tmpRoot);
});

beforeEach(() => {
  clearLiveCaches();
  clearWorktreesCache();
  resetHenchRouteStateForTests();
});

function pick(verdicts: Verdicts): Record<string, { liveness: string | null; canEnd: boolean | null }> {
  return Object.fromEntries(Object.entries(verdicts).map(([id, v]) => [id, { liveness: v.liveness, canEnd: v.canEnd }]));
}

describe("liveness across worktrees", () => {
  it("GET /api/live judges running runs in every worktree", async () => {
    const live = (await (await fetch(`${server.baseUrl}/api/live`)).json()) as LiveSnapshot;
    const verdicts: Verdicts = Object.fromEntries(
      live.runs.map((r) => [r.runId, { liveness: r.liveness, canEnd: r.canEnd, reason: r.livenessReason }]),
    );
    expect(pick(verdicts)).toEqual(EXPECTED);
    expect(verdicts["locked"]?.reason).toContain(`process ${process.pid}`);
    expect(live.counts.liveness).toEqual({ total: 6, live: 2, foreign: 1, unknown: 1, orphaned: 2 });
    // Existing fields are untouched.
    expect(live.runs.find((r) => r.runId === "dead")).toMatchObject({ pid: DEAD_PID, pidAlive: false, stale: false });
  });

  it("GET /api/hench/runs/health judges running runs in every worktree", async () => {
    const health = (await (await fetch(`${server.baseUrl}/api/hench/runs/health`)).json()) as {
      activeRuns: number;
      liveness: Record<string, number>;
      runs: Array<{ id: string; liveness: string; canEnd: boolean; livenessReason: string; pidAlive: boolean | null; stale: boolean; worktree?: { path: string } }>;
    };
    const verdicts: Verdicts = Object.fromEntries(
      health.runs.map((r) => [r.id, { liveness: r.liveness, canEnd: r.canEnd, reason: r.livenessReason }]),
    );
    expect(pick(verdicts)).toEqual(EXPECTED);
    expect(health.activeRuns).toBe(6);
    expect(health.liveness).toEqual({ total: 6, live: 2, foreign: 1, unknown: 1, orphaned: 2 });
    expect(health.runs.find((r) => r.id === "locked")?.worktree?.path).toBe(linked);
    expect(health.runs.find((r) => r.id === "hung")).toMatchObject({ pidAlive: true, stale: true });
  });

  it("both endpoints give the same reason for the same run", async () => {
    const live = (await (await fetch(`${server.baseUrl}/api/live`)).json()) as LiveSnapshot;
    const health = (await (await fetch(`${server.baseUrl}/api/hench/runs/health`)).json()) as {
      runs: Array<{ id: string; livenessReason: string }>;
    };
    for (const run of live.runs) {
      expect(health.runs.find((r) => r.id === run.runId)?.livenessReason).toBe(run.livenessReason);
    }
  });
});
