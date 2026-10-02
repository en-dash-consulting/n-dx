/**
 * POST /api/hench/runs/reconcile across every worktree of the repository:
 * ends orphaned runs (unknown ones only on request), never live or foreign
 * ones, each in its own worktree's `.hench/runs/`, in the same terminal shape
 * Mark stuck writes.
 *
 * Real git, because the route finds the other worktree through
 * `git worktree list`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerContext } from "../../src/server/types.js";
import { handleHenchRoute, resetHenchRouteStateForTests } from "../../src/server/routes-hench.js";
import { RUN_END_ERROR_PREFIX } from "../../src/server/run-end.js";
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
  lastActivityAt: number;
  pid: number;
  host?: string;
}

function writeRun(worktree: string, run: RunFixture): void {
  const now = Date.now();
  const runsDir = join(worktree, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${run.id}.json`), JSON.stringify({
    id: run.id,
    taskId: `t-${run.id}`,
    taskTitle: `title ${run.id}`,
    status: "running",
    startedAt: new Date(now - 20 * MINUTE).toISOString(),
    lastActivityAt: new Date(run.lastActivityAt).toISOString(),
    turns: 1,
    model: "claude-sonnet-4-5",
    tokenUsage: { input: 1, output: 1 },
    host: run.host ?? hostname(),
    pid: run.pid,
  }));
}

function readRun(worktree: string, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(worktree, ".hench", "runs", `${id}.json`), "utf-8")) as Record<string, unknown>;
}

function ctxFor(projectDir: string): ServerContext {
  return { projectDir, svDir: join(projectDir, ".sourcevision"), rexDir: join(projectDir, ".rex"), dev: false };
}

interface Outcome { runId: string; liveness: string; eligible: boolean; ended: boolean; skipped?: string }
interface ReconcileResponse {
  dryRun: boolean;
  ended: number;
  eligible: number;
  failed: number;
  worktrees: Array<{ worktree?: { path: string }; outcomes: Outcome[] }>;
  liveness: Record<string, number>;
}

let tmpRoot: string;
let repo: string;
let linked: string;
let server: RouteTestServer;

beforeAll(async () => {
  tmpRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-run-reconcile-")));
  repo = join(tmpRoot, "main");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(repo, ".gitignore"), ".hench/\n.rex/\n.sourcevision/\n");
  git(repo, "add", ".gitignore");
  git(repo, "commit", "--quiet", "-m", "root");
  linked = join(tmpRoot, "linked");
  git(repo, "worktree", "add", "--quiet", "-b", "side", linked);
  server = await startRouteTestServer((req, res) => handleHenchRoute(req, res, ctxFor(repo)));
});

afterAll(async () => {
  await server?.close();
  if (tmpRoot) await removeTempDir(tmpRoot);
});

beforeEach(() => {
  resetHenchRouteStateForTests();
  for (const wt of [repo, linked]) rmSync(join(wt, ".hench"), { recursive: true, force: true });
  const now = Date.now();
  // Served worktree
  writeRun(repo, { id: "alive", lastActivityAt: now - 5_000, pid: process.pid });
  writeRun(repo, { id: "hung", lastActivityAt: now - 10 * MINUTE, pid: process.pid });
  writeRun(repo, { id: "dead", lastActivityAt: now - 5_000, pid: DEAD_PID });
  // Other worktree
  writeRun(linked, { id: "remote", lastActivityAt: now - 5_000, pid: DEAD_PID, host: "some-other-host" });
  writeRun(linked, { id: "abandoned", lastActivityAt: now - 10 * MINUTE, pid: DEAD_PID });
});

async function reconcile(body?: unknown): Promise<ReconcileResponse> {
  const res = await fetch(`${server.baseUrl}/api/hench/runs/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ReconcileResponse;
}

function statuses(): Record<string, unknown> {
  return {
    alive: readRun(repo, "alive").status,
    hung: readRun(repo, "hung").status,
    dead: readRun(repo, "dead").status,
    remote: readRun(linked, "remote").status,
    abandoned: readRun(linked, "abandoned").status,
  };
}

function endedIds(response: ReconcileResponse): string[] {
  return response.worktrees.flatMap((g) => g.outcomes.filter((o) => o.ended).map((o) => o.runId)).sort();
}

describe("POST /api/hench/runs/reconcile", () => {
  it("ends orphaned runs in every worktree and leaves live, foreign and unknown runs alone", async () => {
    const response = await reconcile();
    expect(endedIds(response)).toEqual(["abandoned", "dead"]);
    expect(response.ended).toBe(2);
    expect(response.liveness).toEqual({ total: 5, live: 1, foreign: 1, unknown: 1, orphaned: 2 });
    expect(statuses()).toEqual({ alive: "running", hung: "running", dead: "failed", remote: "running", abandoned: "failed" });

    // Grouped by worktree, each run reported under the worktree that holds it.
    const byPath = Object.fromEntries(response.worktrees.map((g) => [g.worktree?.path, g.outcomes.map((o) => o.runId).sort()]));
    expect(byPath).toEqual({ [repo]: ["alive", "dead", "hung"], [linked]: ["abandoned", "remote"] });

    // Written in its own worktree, in the shared terminal shape.
    const abandoned = readRun(linked, "abandoned");
    expect(abandoned.error).toMatch(new RegExp(`^${RUN_END_ERROR_PREFIX}: `));
    expect(typeof abandoned.finishedAt).toBe("string");
    expect(abandoned.taskTitle).toBe("title abandoned");
    // Atomic writes leave no temp files behind.
    expect(readdirSync(join(linked, ".hench", "runs"))).toEqual(["abandoned.json", "remote.json"]);
  });

  it("dryRun reports what would end and changes nothing", async () => {
    const before = statuses();
    const response = await reconcile({ dryRun: true });
    expect(response.dryRun).toBe(true);
    expect(response.ended).toBe(0);
    expect(response.eligible).toBe(2);
    const eligible = response.worktrees.flatMap((g) => g.outcomes.filter((o) => o.eligible).map((o) => o.runId)).sort();
    expect(eligible).toEqual(["abandoned", "dead"]);
    expect(statuses()).toEqual(before);
  });

  it("runIds narrows to the named runs", async () => {
    const response = await reconcile({ runIds: ["abandoned", "alive"] });
    expect(endedIds(response)).toEqual(["abandoned"]);
    expect(response.worktrees.flatMap((g) => g.outcomes.map((o) => o.runId)).sort()).toEqual(["abandoned", "alive"]);
    expect(statuses()).toMatchObject({ dead: "running", abandoned: "failed" });
  });

  it("ends unknown runs only with includeUnknown, and never live or foreign ones", async () => {
    const response = await reconcile({ includeUnknown: true });
    expect(endedIds(response)).toEqual(["abandoned", "dead", "hung"]);
    expect(statuses()).toMatchObject({ alive: "running", remote: "running", hung: "failed" });
  });

  it("does not end a run whose verdict changed to live after the dry run", async () => {
    const dry = await reconcile({ dryRun: true });
    expect(dry.worktrees.flatMap((g) => g.outcomes).find((o) => o.runId === "dead")?.eligible).toBe(true);

    // The run comes back to life: a live pid and a fresh heartbeat.
    writeRun(repo, { id: "dead", lastActivityAt: Date.now(), pid: process.pid });

    const response = await reconcile({ runIds: ["dead"] });
    expect(response.ended).toBe(0);
    expect(response.worktrees.flatMap((g) => g.outcomes).find((o) => o.runId === "dead")?.liveness).toBe("live");
    expect(readRun(repo, "dead").status).toBe("running");
  });

  it("rejects a malformed body", async () => {
    for (const body of ["not json", JSON.stringify([1]), JSON.stringify({ runIds: "dead" })]) {
      const res = await fetch(`${server.baseUrl}/api/hench/runs/reconcile`, { method: "POST", body });
      expect(res.status).toBe(400);
    }
    expect(statuses()).toMatchObject({ dead: "running", abandoned: "running" });
  });

  it("writes the same status and error prefix as Mark stuck", async () => {
    const stuck = await fetch(`${server.baseUrl}/api/hench/runs/hung/mark-stuck`, { method: "POST" });
    expect(stuck.status).toBe(200);
    await reconcile({ runIds: ["dead"] });

    const marked = readRun(repo, "hung");
    const reconciled = readRun(repo, "dead");
    expect(marked.status).toBe("failed");
    expect(reconciled.status).toBe(marked.status);
    const prefixOf = (error: unknown): string => String(error).split(": ")[0]!;
    expect(prefixOf(marked.error)).toBe(RUN_END_ERROR_PREFIX);
    expect(prefixOf(reconciled.error)).toBe(RUN_END_ERROR_PREFIX);
    expect(marked.error).not.toBe(reconciled.error);
    expect(typeof marked.finishedAt).toBe("string");
    expect(typeof reconciled.finishedAt).toBe("string");
  });
});
