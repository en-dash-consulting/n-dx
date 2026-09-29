/**
 * GET /api/worktrees against a real repository with linked worktrees.
 *
 * Real git rather than a mocked `listWorktrees`: the route's value is the
 * join between git's worktree registry and the per-checkout artifacts hench
 * and `ndx start` leave behind (`.hench/runs/`, `.n-dx-web.pid/.port`), and
 * only a real layout exercises that join end to end.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../src/server/types.js";
import {
  handleWorktreesRoute,
  clearWorktreesCache,
  invalidateWorktreesAnswer,
  type WorktreeEntry,
} from "../../src/server/routes-worktrees.js";
import { closeWorktreeRunWatchers, setWorktreeRunWatchFactory } from "../../src/server/routes-hench.js";
import type { FSWatcher } from "node:fs";
import { startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";
import { removeTempDir } from "../helpers/temp-dir.js";

// No wait budget for a watcher event remains in this file: the one test that
// waited on a real fs.watch delivery now drives the watch-factory seam and
// advances the debounce with fake timers, so there is no OS-timing window left
// to size. The constants that scaled that window went with it.

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

afterAll(async () => {
  if (tmpRoot) await removeTempDir(tmpRoot);
});

beforeEach(() => {
  clearWorktreesCache();
  // Watchers are module-level, one per runs directory: a test must not
  // inherit one registered (with another test's broadcaster) earlier.
  closeWorktreeRunWatchers();
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
        // No worktree took this run's task over.
        claimLostTo: null,
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
        claimLostTo: null,
      },
    });
    await server.close();
  });

  it("reports the worktree that took a run's task over, and null when none did", async () => {
    // Written the way hench writes it: the run is still `running`, because a
    // run whose claim is taken over deliberately carries on.
    const runsDir = join(linked, ".hench", "runs");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(
      join(runsDir, "run-taken.json"),
      JSON.stringify({
        id: "run-taken",
        taskId: "task-1",
        taskTitle: "taken over",
        startedAt: "2026-09-16T12:00:00.000Z",
        status: "running",
        claimLost: { at: "2026-09-16T12:30:00.000Z", taskId: "task-1", holderWorktree: repo },
      }),
    );
    clearWorktreesCache();

    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(repo)));
    const list = await fetchWorktrees(server);
    expect(list.find((w) => w.path === linked)!.runs.latest).toMatchObject({
      id: "run-taken",
      status: "running",
      claimLostTo: repo,
    });
    // The anchor's own runs are untouched by another worktree's record.
    expect(list.find((w) => w.path === repo)!.runs.latest!.claimLostTo).toBeNull();
    await server.close();
  });

  it("treats a malformed claimLost as no takeover rather than losing the run", async () => {
    // Run files are read across worktrees, so one may come from a different
    // hench version. A bad entry must not cost the whole digest.
    const runsDir = join(linked, ".hench", "runs");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(
      join(runsDir, "run-odd.json"),
      JSON.stringify({
        id: "run-odd",
        taskTitle: "odd",
        startedAt: "2026-09-16T13:00:00.000Z",
        status: "running",
        claimLost: { at: "2026-09-16T13:30:00.000Z", holderWorktree: 42 },
      }),
    );
    clearWorktreesCache();

    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(repo)));
    const list = await fetchWorktrees(server);
    expect(list.find((w) => w.path === linked)!.runs.latest).toMatchObject({
      id: "run-odd",
      claimLostTo: null,
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

  it("a run file saved in another worktree pushes hench:run-changed without the Runs view", async () => {
    // The Sessions tray is open but the Runs view (the only other caller that
    // watches linked worktrees) was never visited: GET /api/worktrees alone
    // must register the watcher, or a mid-run claim takeover waits for a poll.
    //
    // Driven through the watch-factory seam rather than a real fs.watch event.
    // Two claims live here — the route registers a watcher on the linked runs
    // directory, and a `.json` change on it reaches `broadcast` — and neither
    // is a statement about how fast the OS delivers a change callback. Waiting
    // on the real one made this the file's flakiest test: FSEvents on macOS
    // coalesces and can arrive past any timeout, so CI failed with "Number of
    // calls: 0" against code that was working. The debounce is advanced with
    // fake timers for the same reason.
    const broadcast = vi.fn();
    const onStatusInvalidate = vi.fn(invalidateWorktreesAnswer);
    const listeners = new Map<string, (eventType: string, filename: string) => void>();
    setWorktreeRunWatchFactory((dir, listener) => {
      listeners.set(dir, listener as (eventType: string, filename: string) => void);
      return { close: () => {}, on: () => {} } as unknown as FSWatcher;
    });
    const linkedRuns = join(linked, ".hench", "runs");
    server = await startRouteTestServer((req, res) =>
      handleWorktreesRoute(req, res, ctxFor(repo), { broadcast, onStatusInvalidate }),
    );
    try {
      await fetchWorktrees(server);

      // Registration is the first claim, and the one this route owns.
      expect([...listeners.keys()]).toContain(linkedRuns);

      // A run file lands in the linked worktree. The watcher debounces before
      // firing, so the timer is advanced rather than waited out — 2s clears
      // WORKTREE_WATCH_DEBOUNCE_MS (500) with room, and costs nothing faked.
      vi.useFakeTimers();
      try {
        listeners.get(linkedRuns)!("change", "run-c.json");
        vi.advanceTimersByTime(2_000);
      } finally {
        vi.useRealTimers();
      }

      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "hench:run-changed" }));
      expect(onStatusInvalidate).toHaveBeenCalled();
    } finally {
      setWorktreeRunWatchFactory(null);
      closeWorktreeRunWatchers();
      await server.close();
    }
  });

  it("a request scoped to another workspace does not prune that worktree's live watcher", async () => {
    // Regression: the prune keep-set excluded the request's served worktree,
    // and `isServed` is per-request (ctx is workspace-scoped) — so a viewer
    // mounted on the linked worktree, whose /api/worktrees arrives with ctx
    // scoped to `linked`, closed the watcher the anchor's dashboard had
    // registered for `linked`. Pushes to the anchor's Sessions view went dark
    // until something re-registered it.
    const opened: string[] = [];
    const closed: string[] = [];
    setWorktreeRunWatchFactory((dir) => {
      opened.push(dir);
      return { close: () => { closed.push(dir); }, on: () => {} } as unknown as FSWatcher;
    });
    const linkedRuns = join(linked, ".hench", "runs");
    const anchorServer = await startRouteTestServer((req, res) =>
      handleWorktreesRoute(req, res, ctxFor(repo), { broadcast: vi.fn() }),
    );
    const linkedServer = await startRouteTestServer((req, res) =>
      handleWorktreesRoute(req, res, ctxFor(linked), { broadcast: vi.fn() }),
    );
    try {
      await fetchWorktrees(anchorServer);
      expect(opened).toContain(linkedRuns);

      // A different projectDir misses the answer cache, so this request
      // recomputes the worktree list and runs the prune.
      await fetchWorktrees(linkedServer);
      expect(closed).not.toContain(linkedRuns);
    } finally {
      setWorktreeRunWatchFactory(null);
      closeWorktreeRunWatchers();
      await anchorServer.close();
      await linkedServer.close();
    }
  });

  it("does not watch the served worktree's runs — start.ts already does", async () => {
    const broadcast = vi.fn();
    server = await startRouteTestServer((req, res) =>
      handleWorktreesRoute(req, res, ctxFor(linked), { broadcast }),
    );
    try {
      await fetchWorktrees(server);
      writeRun(linked, "run-c", "running");
      await new Promise((r) => setTimeout(r, 1_000));
      expect(broadcast).not.toHaveBeenCalled();
    } finally {
      closeWorktreeRunWatchers();
      await server.close();
    }
  });

  it("a runs-dir change drops the cached answer so the refetch sees it", async () => {
    server = await startRouteTestServer((req, res) => handleWorktreesRoute(req, res, ctxFor(repo)));
    const before = (await fetchWorktrees(server)).find((w) => w.path === repo)!.runs.total;

    writeRun(repo, "run-d", "completed", "2026-09-16T12:00:00.000Z");
    expect((await fetchWorktrees(server)).find((w) => w.path === repo)!.runs.total).toBe(before);

    invalidateWorktreesAnswer();
    expect((await fetchWorktrees(server)).find((w) => w.path === repo)!.runs.total).toBe(before + 1);
    rmSync(join(repo, ".hench", "runs", "run-d.json"));
    await server.close();
  });
});
