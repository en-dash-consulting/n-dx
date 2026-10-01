/**
 * GET /api/live/task/:taskId — the running-task page's facts — and stopping a
 * terminal-started run by its recorded pid through the existing terminate route.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerContext } from "../../../src/server/types.js";
import { buildLiveTaskSnapshot, handleLiveTaskRoute } from "../../../src/server/routes-live-task.js";
import { handleHenchRoute } from "../../../src/server/routes-hench.js";
import { clearWorktreesCache } from "../../../src/server/routes-worktrees.js";
import { readLogTailLines } from "../../../src/server/run-tail.js";
import { startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

let dir: string;

function ctx(): ServerContext {
  return { projectDir: dir, svDir: join(dir, ".sourcevision"), rexDir: join(dir, ".rex"), dev: false };
}

function writeRun(id: string, fields: Record<string, unknown>): string {
  const runsDir = join(dir, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  const path = join(runsDir, `${id}.json`);
  writeFileSync(path, JSON.stringify({
    id, taskId: "t1", taskTitle: "Task one", status: "running", turns: 3, model: "claude-sonnet-4-5",
    tokenUsage: { input: 10_000, output: 2_000, cacheReadInput: 50_000 },
    ...fields,
  }));
  return path;
}

function writePrd(): void {
  mkdirSync(join(dir, ".rex", ".cache"), { recursive: true });
  writeFileSync(join(dir, ".rex", ".cache", "prd.json"), JSON.stringify({
    schema: "rex/v1", title: "fixture",
    items: [{
      id: "e1", title: "Epic", level: "epic", status: "in_progress",
      children: [{
        id: "f1", title: "Feature", level: "feature", status: "in_progress",
        children: [{
          id: "t1", title: "Task one", level: "task", status: "in_progress", priority: "high",
          description: "Do the thing", acceptanceCriteria: ["first", "second"],
        }],
      }],
    }],
  }));
}

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-live-task-")));
  clearWorktreesCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readLogTailLines", () => {
  it("returns the last non-blank lines with colour codes removed", () => {
    const path = join(dir, "x.log");
    writeFileSync(path, "one\n\u001b[32mtwo\u001b[0m\n\nthree\nfour\nfive\nsix\npartial");
    expect(readLogTailLines(path, 5)).toEqual(["three", "four", "five", "six", "partial"]);
  });

  it("drops the window's first, partial line on a large file", () => {
    const path = join(dir, "big.log");
    writeFileSync(path, "x".repeat(40_000) + "\nlast\n");
    expect(readLogTailLines(path, 5)).toEqual(["last"]);
  });

  it("is empty for a missing file", () => {
    expect(readLogTailLines(join(dir, "nope.log"), 5)).toEqual([]);
  });
});

describe("buildLiveTaskSnapshot", () => {
  it("answers the task, its criteria and chain, and every run newest first", () => {
    writePrd();
    const now = Date.parse("2026-10-01T10:10:00.000Z");
    mkdirSync(join(dir, ".run-logs"), { recursive: true });
    const logPath = join(dir, ".run-logs", "2026-10-01T10-00-00-r2.log");
    writeFileSync(logPath, ["a", "b", "c", "d", "e", "f"].join("\n") + "\n");
    writeRun("r1", { status: "failed", startedAt: "2026-10-01T09:00:00.000Z", finishedAt: "2026-10-01T09:30:00.000Z", error: "Tests failed", pid: 11 });
    writeRun("r2", {
      startedAt: "2026-10-01T10:00:00.000Z", lastActivityAt: "2026-10-01T10:09:50.000Z", pid: 4242,
      branch: "feat/x", startHead: "abcdef0123456789", weight: "standard", logPath, worktreeRoot: dir,
      review: { model: "m", resumedSession: false, findingCount: 3, unresolvedCount: 1, unrepairedMustFixCount: 0, failedActionCount: 0, fixesApplied: false, reportPath: "/x" },
    });
    writeRun("other", { taskId: "t2" });

    const snap = buildLiveTaskSnapshot(ctx(), "t1", now);
    expect(snap.task).toMatchObject({
      title: "Task one", description: "Do the thing", priority: "high", status: "in_progress",
      acceptanceCriteria: ["first", "second"],
      epicChain: [{ id: "e1", title: "Epic", level: "epic" }, { id: "f1", title: "Feature", level: "feature" }],
    });
    expect(snap.runs.map((r) => r.runId)).toEqual(["r2", "r1"]);
    const [running, failed] = snap.runs;
    expect(running).toMatchObject({
      status: "running", pid: 4242, startedFrom: "terminal", branch: "feat/x", startHead: "abcdef0123456789",
      weight: "standard", heartbeatAgeMs: 10_000, stale: false, outcome: null,
      logTail: ["b", "c", "d", "e", "f"], review: { failed: null, findings: 3, unresolved: 1 },
    });
    expect(running.tokens).toMatchObject({ input: 10_000, output: 2_000, cacheReadInput: 50_000, total: 62_000 });
    expect(running.costUsd).toBeGreaterThan(0);
    // A finished run: no pid, no "started from", and its error as the outcome.
    expect(failed).toMatchObject({ status: "failed", pid: null, startedFrom: null, outcome: "Tests failed", logTail: [] });
  });

  it("carries the review a run was launched with, its spend and — once written — its report", () => {
    writePrd();
    writeRun("r1", {
      startedAt: "2026-10-01T10:00:00.000Z",
      reviewPlan: { model: "claude-opus-5", modelSource: "flag", optional: true },
      reviewSpend: { turns: 4, input: 1_000, output: 500, cacheCreationInput: 0, cacheReadInput: 2_000 },
    });
    writeRun("r2", { taskId: "t1", startedAt: "2026-10-01T09:00:00.000Z" });
    const first = buildLiveTaskSnapshot(ctx(), "t1").runs.find((r) => r.runId === "r1")!;
    // Launched with --review, nothing written yet: a plan and spend, no report.
    expect(first.reviewPlan).toEqual({ model: "claude-opus-5", modelSource: "flag", optional: true });
    expect(first.reviewSpend).toMatchObject({ turns: 4, tokens: 3_500 });
    expect(first.reviewSpend!.costUsd).toBeGreaterThan(0);
    expect(first.reviewReport).toBeNull();

    mkdirSync(join(dir, ".hench", "reviews"), { recursive: true });
    writeFileSync(join(dir, ".hench", "reviews", "r1.json"), JSON.stringify({
      taskId: "t1", fixesApplied: false, summary: "s",
      findings: [{ title: "T", severity: "catastrophic", verdict: "must-fix", action: "captured", itemId: "i1" }],
    }));
    const runs = buildLiveTaskSnapshot(ctx(), "t1").runs;
    expect(runs.find((r) => r.runId === "r1")!.reviewReport?.findings).toMatchObject([
      { title: "T", severity: "catastrophic", action: "captured", itemId: "i1", scenario: null },
    ]);
    // A run without --review has none of it, and no tab to show it in.
    const plain = runs.find((r) => r.runId === "r2")!;
    expect(plain).toMatchObject({ review: null, reviewPlan: null, reviewSpend: null, reviewReport: null });
  });

  it("answers an empty run list and a null task for a task this worktree does not know", () => {
    const snap = buildLiveTaskSnapshot(ctx(), "missing");
    expect(snap).toMatchObject({ taskId: "missing", task: null, runs: [] });
  });
});

describe("the routes", () => {
  let server: RouteTestServer | undefined;
  let child: ChildProcess | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    child = undefined;
  });

  it("serves GET /api/live/task/:taskId and ignores other paths", async () => {
    writePrd();
    writeRun("r1", { startedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() });
    server = await startRouteTestServer((req, res) => {
      if (handleLiveTaskRoute(req, res, ctx())) return true;
      res.statusCode = 418;
      res.end();
      return true;
    });
    const res = await fetch(`${server.baseUrl}/api/live/task/t1`);
    expect(res.status).toBe(200);
    const body = await res.json() as { task: { title: string }; runs: unknown[] };
    expect(body.task.title).toBe("Task one");
    expect(body.runs).toHaveLength(1);
    expect((await fetch(`${server.baseUrl}/api/live`)).status).toBe(418);
  });

  async function waitForExit(proc: ChildProcess, ms: number): Promise<boolean> {
    if (proc.exitCode !== null || proc.signalCode !== null) return true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      proc.once("exit", () => { clearTimeout(timer); resolve(true); });
    });
  }

  function startSleeper(): ChildProcess {
    return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  }

  async function terminate(taskId: string): Promise<Record<string, unknown>> {
    server = await startRouteTestServer((req, res) => handleHenchRoute(req, res, ctx()));
    const res = await fetch(`${server.baseUrl}/api/hench/execute/${taskId}/terminate`, { method: "POST" });
    expect(res.status).toBe(200);
    return await res.json() as Record<string, unknown>;
  }

  it("stops a terminal-started run by its recorded pid and marks the record failed", async () => {
    child = startSleeper();
    const path = writeRun("r1", { pid: child.pid, host: hostname(), startedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() });
    const body = await terminate("t1");
    expect(body).toMatchObject({ terminated: true, method: "pid-signal", pid: child.pid });
    expect(await waitForExit(child, 2_000)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toMatchObject({ status: "failed", error: "Terminated via audit interface" });
  });

  it("does not signal a pid whose heartbeat is stale — the pid may have been reused", async () => {
    child = startSleeper();
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const path = writeRun("r1", { pid: child.pid, host: hostname(), startedAt: old, lastActivityAt: old });
    const body = await terminate("t1");
    expect(body).toMatchObject({ terminated: true, method: "disk-mark" });
    expect(await waitForExit(child, 300)).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf-8")).status).toBe("failed");
  });

  it("does not signal a pid recorded on another host", async () => {
    child = startSleeper();
    writeRun("r1", { pid: child.pid, host: `${hostname()}-elsewhere`, startedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() });
    const body = await terminate("t1");
    expect(body.method).toBe("disk-mark");
    expect(await waitForExit(child, 300)).toBe(false);
  });
});
