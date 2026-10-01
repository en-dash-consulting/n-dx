/**
 * GET /api/live and its `live:changed` frames.
 *
 * Real git for the two-worktree fixture, because the acceptance claim is that
 * the counts agree with the worktrees pill (`GET /api/worktrees`, which asks
 * git) and the bottom bar's stuck-run number (`GET /api/status`) for the same
 * moment. The 25-worktree case counts work rather than timing it: a warm
 * answer must read no run file, which is what keeps it fast on any machine.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../src/server/types.js";
import {
  buildLiveSnapshot,
  clearLiveCaches,
  diffLiveSnapshots,
  handleLiveRoute,
  startLiveMonitor,
  LIVE_MONITOR_INTERVAL_MS,
  type LiveSnapshot,
  type LiveSources,
} from "../../src/server/routes-live.js";
import { clearWorktreesCache, collectWorktrees, runFileParseCountForTests } from "../../src/server/routes-worktrees.js";
import { clearStatusCache, handleStatusRoute, type ProjectStatus } from "../../src/server/routes-status.js";
import { analyzeProgressPath } from "../../src/server/domain-gateway.js";
import { startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";
import { removeTempDir } from "../helpers/temp-dir.js";

const MINUTE = 60_000;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

interface RunFixture {
  id: string;
  status: string;
  taskId?: string;
  startedAt: number;
  lastActivityAt?: number;
  finishedAt?: number;
  model?: string;
  tokens?: { input: number; output: number };
  events?: string[];
}

function writeRun(worktree: string, run: RunFixture): void {
  const runsDir = join(worktree, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  let eventsPath: string | undefined;
  if (run.events) {
    eventsPath = join(runsDir, `${run.id}.events.jsonl`);
    writeFileSync(eventsPath, run.events.map((summary, i) => JSON.stringify({ kind: "tests_run", at: new Date(run.startedAt + i).toISOString(), summary }) + "\n").join(""));
  }
  writeFileSync(join(runsDir, `${run.id}.json`), JSON.stringify({
    id: run.id,
    taskId: run.taskId ?? `task-${run.id}`,
    taskTitle: `title ${run.id}`,
    status: run.status,
    startedAt: new Date(run.startedAt).toISOString(),
    ...(run.lastActivityAt !== undefined ? { lastActivityAt: new Date(run.lastActivityAt).toISOString() } : {}),
    ...(run.finishedAt !== undefined ? { finishedAt: new Date(run.finishedAt).toISOString() } : {}),
    turns: 3,
    model: run.model ?? "claude-sonnet-4-5",
    tokenUsage: run.tokens ?? { input: 1000, output: 200 },
    branch: "side",
    pid: 4242,
    ...(eventsPath ? { eventsPath } : {}),
  }));
}

/** A PRD the server's cache would hold: epic → feature → task. */
function writePrd(worktree: string, taskIds: string[]): void {
  const cacheDir = join(worktree, ".rex", ".cache");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, "prd.json"), JSON.stringify({
    schema: "rex/v1",
    title: "fixture",
    items: [{
      id: "epic-1", title: "Epic one", level: "epic", status: "in_progress",
      children: [{
        id: "feature-1", title: "Feature one", level: "feature", status: "in_progress",
        children: [
          ...taskIds.map((id) => ({ id, title: `task ${id}`, level: "task", status: "in_progress", acceptanceCriteria: ["one", "two"] })),
          { id: "next-1", title: "Next task", level: "task", status: "pending", priority: "high" },
        ],
      }],
    }],
  }));
}

function ctxFor(projectDir: string, workspace?: string): ServerContext {
  return { projectDir, svDir: join(projectDir, ".sourcevision"), rexDir: join(projectDir, ".rex"), dev: false, workspace };
}

let tmpRoot: string;
let repo: string;
let linked: string;
let sources: LiveSources;

beforeAll(() => {
  tmpRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-live-route-")));
  repo = join(tmpRoot, "main");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(repo, ".gitignore"), ".hench/\n.rex/\n.sourcevision/\n");
  git(repo, "add", ".gitignore");
  git(repo, "commit", "--quiet", "-m", "root");
  linked = join(tmpRoot, "linked");
  git(repo, "worktree", "add", "--quiet", "-b", "side", linked);
  sources = {
    listWorkspaces: () => [
      { key: "main", path: repo, branch: "main", isAnchor: true },
      { key: "linked", path: linked, branch: "side", isAnchor: false },
    ],
    memoryFloorBytes: () => 1,
    // The progress files below record this test process's pid; stand it in for an analyze.
    processCommandLine: () => "node /repo/packages/sourcevision/dist/cli/index.js analyze .",
  };
});

afterAll(async () => {
  if (tmpRoot) await removeTempDir(tmpRoot);
});

beforeEach(() => {
  clearLiveCaches();
  clearWorktreesCache();
  clearStatusCache();
});

describe("GET /api/live", () => {
  let server: RouteTestServer;
  const now = Date.now();

  beforeAll(async () => {
    // Served worktree: one fresh run, one stale, one finished recently, one long ago.
    writeRun(repo, { id: "fresh", status: "running", taskId: "task-a", startedAt: now - 2 * MINUTE, lastActivityAt: now - 10_000, events: ["Brief loaded", "Ran 12 tests"] });
    writeRun(repo, { id: "stuck", status: "running", startedAt: now - 30 * MINUTE, lastActivityAt: now - 10 * MINUTE });
    writeRun(repo, { id: "done", status: "completed", startedAt: now - 20 * MINUTE, finishedAt: now - 10 * MINUTE });
    writeRun(repo, { id: "old", status: "completed", startedAt: now - 3 * 60 * MINUTE, finishedAt: now - 2 * 60 * MINUTE });
    writePrd(repo, ["task-a"]);
    // Another worktree: one running run, and an analysis started from a terminal.
    writeRun(linked, { id: "elsewhere", status: "running", startedAt: now - MINUTE, lastActivityAt: now - 5_000 });
    const progressFile = analyzeProgressPath(join(linked, ".sourcevision"));
    mkdirSync(dirname(progressFile), { recursive: true });
    writeFileSync(progressFile, JSON.stringify({
      version: 1, pid: process.pid, status: "running", mode: "generative", scope: null,
      startedAt: new Date(now - MINUTE).toISOString(), updatedAt: new Date(now).toISOString(),
      phase: { index: 3, name: "Zones", total: 6 }, phases: [], pass: null,
      batch: { label: "zone batches", done: 2, total: 5 },
      judgmentCache: { hits: 0, misses: 0 },
      llm: { calls: 1, inputTokens: 10, outputTokens: 5, durationMs: 1, byTaskClass: {} },
    }));

    server = await startRouteTestServer(async (req, res) => {
      if (handleLiveRoute(req, res, ctxFor(repo, "main"), sources)) return true;
      return handleStatusRoute(req, res, ctxFor(repo, "main"));
    });
  });

  afterAll(async () => {
    await server?.close();
  });

  async function fetchLive(): Promise<LiveSnapshot> {
    const res = await fetch(`${server.baseUrl}/api/live`);
    expect(res.status).toBe(200);
    return (await res.json()) as LiveSnapshot;
  }

  it("lists running runs from every worktree, not only the served one", async () => {
    const live = await fetchLive();
    expect(live.runs.map((r) => r.runId).sort()).toEqual(["elsewhere", "fresh", "stuck"]);
    expect(live.runs.find((r) => r.runId === "elsewhere")?.worktree).toMatchObject({ key: "linked", isServed: false, branch: "side" });
  });

  it("describes each run: chain, branch, origin, heartbeat, staleness, last progress", async () => {
    const live = await fetchLive();
    const fresh = live.runs.find((r) => r.runId === "fresh")!;
    expect(fresh).toMatchObject({
      taskId: "task-a",
      taskTitle: "title fresh",
      epicChain: [
        { id: "epic-1", title: "Epic one", level: "epic" },
        { id: "feature-1", title: "Feature one", level: "feature" },
      ],
      branch: "side",
      criteriaTotal: 2,
      turns: 3,
      model: "claude-sonnet-4-5",
      startedFrom: "terminal",
      pid: 4242,
      stale: false,
      lastProgress: "Ran 12 tests",
      tokens: { input: 1000, output: 200, total: 1200 },
    });
    expect(fresh.heartbeatAgeMs).not.toBeNull();
    expect(live.runs.find((r) => r.runId === "stuck")?.stale).toBe(true);
  });

  it("lists runs finished in the last hour and drops older ones", async () => {
    const live = await fetchLive();
    expect(live.recent.map((r) => r.runId)).toEqual(["done"]);
    expect(live.recent[0]).toMatchObject({ startedFrom: null, stale: false, pid: null });
  });

  it("lists an analysis started from a terminal, with its progress", async () => {
    const live = await fetchLive();
    const job = live.jobs.find((j) => j.kind === "sv-analyze");
    expect(job).toMatchObject({
      id: "sv-analyze:linked",
      startedFrom: "terminal",
      worktree: { key: "linked" },
      detail: "phase 3/6 Zones · zone batches 2/5",
    });
    expect(job?.progress?.running).toBe(true);
  });

  it("queues the next actionable task and fills the machine strip", async () => {
    const live = await fetchLive();
    expect(live.queue.next.map((t) => t.id)).toEqual(["next-1"]);
    expect(live.queue.next[0]?.epicChain.map((l) => l.id)).toEqual(["epic-1", "feature-1"]);
    expect(live.machine.worktrees).toEqual({ total: 2, withLiveRun: 2 });
    expect(live.machine.memory.floorBytes).toBe(1);
    expect(live.machine.memory.belowFloor).toBe(false);
    expect(live.machine.slots.inUse).toBe(0);
    expect(live.machine.spend.inFlightTokens).toBe(3600);
    expect(live.machine.spend.inFlightUsd).toBeGreaterThan(0);
  });

  it("agrees with the worktrees pill and the bottom bar's stuck-run number", async () => {
    const live = await fetchLive();
    const worktrees = await collectWorktrees(repo);
    const pillRunning = worktrees.reduce((n, wt) => n + wt.runs.running, 0);
    const status = (await (await fetch(`${server.baseUrl}/api/status`)).json()) as ProjectStatus;

    expect(live.counts.running).toBe(pillRunning);
    expect(live.counts.running).toBe(3);
    expect(live.counts.servedStale).toBe(status.hench.staleRuns);
    expect(live.counts.servedRunning).toBe(status.hench.activeRuns);
    expect(live.counts.stale).toBe(1);
  });
});

describe("25 worktrees", () => {
  let root: string;
  afterEach(async () => {
    if (root) await removeTempDir(root);
  });

  it("answers warm without reading a single run file", () => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-live-scale-")));
    const now = Date.now();
    const workspaces = Array.from({ length: 25 }, (_, i) => {
      const path = join(root, `wt-${i}`);
      mkdirSync(path);
      for (let r = 0; r < 20; r++) {
        writeRun(path, r === 0
          ? { id: `wt${i}-run${r}`, status: "running", startedAt: now - MINUTE, lastActivityAt: now - 1_000 }
          : { id: `wt${i}-run${r}`, status: "completed", startedAt: now - 5 * 60 * MINUTE, finishedAt: now - 4 * 60 * MINUTE });
      }
      return { key: `wt-${i}`, path, branch: `b${i}`, isAnchor: i === 0 };
    });
    const scaleSources: LiveSources = { listWorkspaces: () => workspaces, memoryFloorBytes: () => null };
    const ctx = ctxFor(workspaces[0]!.path, "wt-0");

    const cold = buildLiveSnapshot(ctx, scaleSources, now);
    expect(cold.runs).toHaveLength(25);
    expect(cold.counts.running).toBe(25);
    expect(runFileParseCountForTests()).toBe(500);

    const warm = buildLiveSnapshot(ctx, scaleSources, now);
    expect(warm.counts).toEqual(cold.counts);
    expect(runFileParseCountForTests()).toBe(500);
  });
});

describe("live:changed frames", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires when a run starts, goes stale, and finishes — and not otherwise", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-live-frames-")));
    const workspace = { key: "solo", path: root, branch: "main", isAnchor: true };
    const frames: Array<Record<string, unknown>> = [];
    const interval = startLiveMonitor(
      ctxFor(root, "solo"),
      { listWorkspaces: () => [workspace], memoryFloorBytes: () => null },
      (frame) => { frames.push(frame as Record<string, unknown>); },
    );
    try {
      vi.advanceTimersByTime(LIVE_MONITOR_INTERVAL_MS);
      expect(frames).toEqual([]);

      const startedAt = Date.now();
      writeRun(root, { id: "r1", status: "running", startedAt, lastActivityAt: startedAt });
      vi.advanceTimersByTime(LIVE_MONITOR_INTERVAL_MS);
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({ type: "live:changed", started: ["run:r1"], finished: [], stale: [], counts: { running: 1 } });

      vi.setSystemTime(startedAt + 6 * MINUTE);
      vi.advanceTimersByTime(LIVE_MONITOR_INTERVAL_MS);
      expect(frames).toHaveLength(2);
      expect(frames[1]).toMatchObject({ started: [], finished: [], stale: ["run:r1"] });

      writeRun(root, { id: "r1", status: "completed", startedAt, finishedAt: Date.now() });
      vi.advanceTimersByTime(LIVE_MONITOR_INTERVAL_MS);
      expect(frames).toHaveLength(3);
      expect(frames[2]).toMatchObject({ started: [], finished: ["run:r1"], counts: { running: 0 } });

      vi.advanceTimersByTime(LIVE_MONITOR_INTERVAL_MS);
      expect(frames).toHaveLength(3);
    } finally {
      clearInterval(interval);
      await removeTempDir(root);
    }
  });

  it("diffs starts and finishes of jobs as well as runs", () => {
    const empty = { runs: [], jobs: [], queue: { next: [], starting: [] } } as unknown as LiveSnapshot;
    const withJob = { ...empty, jobs: [{ id: "ci:main" }] } as unknown as LiveSnapshot;
    expect(diffLiveSnapshots(empty, withJob)).toEqual({ started: ["job:ci:main"], finished: [], stale: [] });
    expect(diffLiveSnapshots(withJob, empty)).toEqual({ started: [], finished: ["job:ci:main"], stale: [] });
  });
});
