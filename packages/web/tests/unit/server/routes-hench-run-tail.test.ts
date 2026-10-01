/**
 * GET /api/hench/runs/:id/log?from= and /events?after= — tailing a run.
 *
 * Real git, as in routes-hench-runs-scope.test.ts: which worktrees count as
 * "registered" is `git worktree list`'s answer, and path confinement is only
 * meaningful against real directories.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute, closeWorktreeRunWatchers } from "../../../src/server/routes-hench.js";
import { stopRunTailWatches, runTailWatchCount, RUN_TAIL_POLL_MS } from "../../../src/server/run-tail.js";
import { startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

interface RunFields {
  status?: string;
  logPath?: string;
  eventsPath?: string;
  worktreeRoot?: string;
  startedAt?: string;
}

function writeRun(worktree: string, id: string, fields: RunFields = {}): void {
  const runsDir = join(worktree, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(
    join(runsDir, `${id}.json`),
    JSON.stringify({
      id, taskId: "task-1", taskTitle: "t", startedAt: fields.startedAt ?? "2026-09-30T10:00:00.000Z",
      status: fields.status ?? "running", turns: 1, model: "sonnet", tokenUsage: { input: 1, output: 1 },
      ...fields,
    }),
  );
}

function logFile(worktree: string, name: string, content: string): string {
  const dir = join(worktree, ".run-logs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function eventsFile(worktree: string, id: string, lines: object[]): string {
  const dir = join(worktree, ".hench", "runs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.events.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l) + "\n").join(""));
  return path;
}

function ctxFor(projectDir: string, workspace?: string): ServerContext {
  return { projectDir, svDir: join(projectDir, ".sourcevision"), rexDir: join(projectDir, ".rex"), dev: false, workspace };
}

const event = (kind: string, summary: string) => ({ kind, at: "2026-09-30T10:00:01.000Z", summary });

let tmpRoot: string;
let repo: string;
let linked: string;
let outside: string;
let liveLog: string;
let liveEvents: string;

beforeAll(() => {
  tmpRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-run-tail-")));
  repo = join(tmpRoot, "main");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "commit", "--allow-empty", "--quiet", "-m", "root");
  linked = join(tmpRoot, "linked");
  git(repo, "worktree", "add", "--quiet", "-b", "side", linked);
  outside = join(tmpRoot, "outside");
  mkdirSync(outside);

  // A running run in the served worktree, with both incremental files recorded.
  liveLog = logFile(repo, "2026-09-30T10-00-00-run-live.log", "line one\nline two\n");
  liveEvents = eventsFile(repo, "run-live", [event("brief_loaded", "Brief loaded"), event("files_read", "Read a.ts")]);
  writeRun(repo, "run-live", { logPath: liveLog, eventsPath: liveEvents, worktreeRoot: repo });

  // A running run in the other worktree.
  const sideLog = logFile(linked, "2026-09-30T10-00-00-run-side.log", "side output\n");
  const sideEvents = eventsFile(linked, "run-side", [event("brief_loaded", "Side brief")]);
  writeRun(linked, "run-side", { logPath: sideLog, eventsPath: sideEvents, worktreeRoot: linked });

  // A run recorded before the incremental log: no logPath, no eventsPath,
  // only the end-of-run log under the timestamped name.
  logFile(repo, "2026-09-01T08-00-00-run-old.log", "old line 1\nold line 2\n");
  writeRun(repo, "run-old", { status: "completed", startedAt: "2026-09-01T08:00:00.000Z" });

  // Records whose recorded paths escape the allowed directories.
  const secret = join(outside, "secret.txt");
  writeFileSync(secret, "do not serve\n");
  writeRun(repo, "run-escape", { logPath: secret, eventsPath: secret });
  writeRun(repo, "run-dotdot", { logPath: join(repo, ".run-logs", "..", "..", "outside", "secret.txt") });
  // An allowed-looking path that is a symlink out of the tree.
  symlinkSync(secret, join(repo, ".run-logs", "link-run-symlink.log"));
  writeRun(repo, "run-symlink", { logPath: join(repo, ".run-logs", "link-run-symlink.log") });
  // A path in another directory of a registered worktree (not .run-logs/ or .hench/runs/).
  writeFileSync(join(repo, "README.md"), "readme\n");
  writeRun(repo, "run-wrongdir", { logPath: join(repo, "README.md") });
  // A registered worktree whose .run-logs/ is itself a symlink out of the tree,
  // as a cloned repository can commit it.
  const trapped = join(tmpRoot, "trapped");
  git(repo, "worktree", "add", "--quiet", "-b", "trap", trapped);
  symlinkSync(outside, join(trapped, ".run-logs"));
  writeRun(trapped, "run-dirlink", { logPath: join(trapped, ".run-logs", "secret.txt") });
});

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("hench run tail routes", () => {
  let server: RouteTestServer;

  afterEach(async () => {
    stopRunTailWatches();
    closeWorktreeRunWatchers();
    await server?.close();
  });

  async function serve(projectDir: string, broadcast?: (msg: unknown) => void, workspace?: string): Promise<RouteTestServer> {
    return startRouteTestServer((req, res) =>
      handleHenchRoute(req, res, ctxFor(projectDir, workspace), broadcast as never),
    );
  }

  async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`${server.baseUrl}${path}`);
    return { status: res.status, body: await res.json() };
  }

  describe("log", () => {
    it("returns the whole log from offset 0 with the next cursor", async () => {
      server = await serve(repo);
      const { status, body } = await get("/api/hench/runs/run-live/log");
      expect(status).toBe(200);
      expect(body.content).toBe("line one\nline two\n");
      expect(body.from).toBe(0);
      expect(body.next).toBe(Buffer.byteLength("line one\nline two\n"));
      expect(body.running).toBe(true);
      expect(body.source).toBe("incremental");
    });

    it("returns only what follows the cursor", async () => {
      server = await serve(repo);
      const { body } = await get(`/api/hench/runs/run-live/log?from=${Buffer.byteLength("line one\n")}`);
      expect(body.content).toBe("line two\n");
    });

    it("never splits a multi-byte character across responses", async () => {
      const path = logFile(repo, "2026-09-30T10-00-00-run-utf8.log", "é");
      writeRun(repo, "run-utf8", { logPath: path });
      // Truncate to the first byte of the two-byte character, as a writer
      // mid-flush would leave it.
      writeFileSync(path, Buffer.from("é").subarray(0, 1));
      server = await serve(repo);
      const first = await get("/api/hench/runs/run-utf8/log");
      expect(first.body.content).toBe("");
      expect(first.body.next).toBe(0);

      writeFileSync(path, "é!");
      const second = await get(`/api/hench/runs/run-utf8/log?from=${first.body.next}`);
      expect(second.body.content).toBe("é!");
    });

    it("ends a finished run's log that stops inside a character with U+FFFD and more: false", async () => {
      const path = logFile(repo, "2026-09-30T10-00-00-run-cut.log", "");
      writeFileSync(path, Buffer.from([0x41, 0xe9]));
      writeRun(repo, "run-cut", { logPath: path, status: "failed" });
      server = await serve(repo);
      const { body } = await get("/api/hench/runs/run-cut/log");
      expect(body.content).toBe("A�");
      expect(body.next).toBe(2);
      expect(body.more).toBe(false);
    });

    it("restarts from 0 when the cursor is past the end of the file", async () => {
      server = await serve(repo);
      const { body } = await get("/api/hench/runs/run-live/log?from=999999");
      expect(body.reset).toBe(true);
      expect(body.content).toBe("line one\nline two\n");
    });

    it("tails a run in another worktree of the repository", async () => {
      server = await serve(repo);
      const { status, body } = await get("/api/hench/runs/run-side/log");
      expect(status).toBe(200);
      expect(body.content).toBe("side output\n");
    });

    it("falls back to the end-of-run log for a run recorded before the incremental log", async () => {
      server = await serve(repo);
      const { status, body } = await get("/api/hench/runs/run-old/log");
      expect(status).toBe(200);
      expect(body.content).toBe("old line 1\nold line 2\n");
      expect(body.source).toBe("final");
      expect(body.running).toBe(false);
    });

    it.each(["run-escape", "run-dotdot", "run-symlink", "run-wrongdir", "run-dirlink"])(
      "refuses a recorded path outside .run-logs/ and .hench/runs/ (%s)",
      async (id) => {
        server = await serve(repo);
        const { status, body } = await get(`/api/hench/runs/${id}/log`);
        expect(status).toBe(404);
        expect(JSON.stringify(body)).not.toContain("do not serve");
      },
    );

    it("404s for an unknown run", async () => {
      server = await serve(repo);
      expect((await get("/api/hench/runs/nope/log")).status).toBe(404);
    });

    it("refuses a run recorded outside every registered worktree", async () => {
      writeRun(outside, "run-unregistered", { logPath: join(outside, "secret.txt") });
      server = await serve(repo);
      expect((await get("/api/hench/runs/run-unregistered/log")).status).toBe(404);
    });
  });

  describe("events", () => {
    it("returns every event with a 1-based seq and the next cursor", async () => {
      server = await serve(repo);
      const { status, body } = await get("/api/hench/runs/run-live/events");
      expect(status).toBe(200);
      const events = body.events as Array<{ seq: number; kind: string }>;
      expect(events.map((e) => [e.seq, e.kind])).toEqual([[1, "brief_loaded"], [2, "files_read"]]);
      expect(body.next).toBe(2);
    });

    it("returns only events after the cursor", async () => {
      server = await serve(repo);
      const { body } = await get("/api/hench/runs/run-live/events?after=1");
      expect((body.events as Array<{ seq: number }>).map((e) => e.seq)).toEqual([2]);
    });

    it("ignores a trailing line the writer has not finished", async () => {
      const path = eventsFile(repo, "run-partial", [event("brief_loaded", "Brief")]);
      appendFileSync(path, '{"kind":"gate","su');
      writeRun(repo, "run-partial", { eventsPath: path });
      server = await serve(repo);
      const { body } = await get("/api/hench/runs/run-partial/events");
      expect((body.events as unknown[]).length).toBe(1);
      expect(body.next).toBe(1);
    });

    it("tails events of a run in another worktree", async () => {
      server = await serve(repo);
      const { body } = await get("/api/hench/runs/run-side/events");
      expect((body.events as Array<{ summary: string }>)[0]!.summary).toBe("Side brief");
    });

    it("answers an old run with no event stream with an empty list", async () => {
      server = await serve(repo);
      const { status, body } = await get("/api/hench/runs/run-old/events");
      expect(status).toBe(200);
      expect(body.events).toEqual([]);
      expect(body.available).toBe(false);
    });

    it("refuses a recorded events path outside the allowed directories", async () => {
      server = await serve(repo);
      expect((await get("/api/hench/runs/run-escape/events")).status).toBe(404);
    });
  });

  describe("appended-content frames", () => {
    it("announces appended log and events within a second of the write, tagged by the request's workspace", async () => {
      const broadcast = vi.fn();
      server = await serve(repo, broadcast, "main");
      const first = await get("/api/hench/runs/run-live/log");

      const writtenAt = Date.now();
      appendFileSync(liveLog, "line three\n");
      await vi.waitFor(() => {
        expect(broadcast).toHaveBeenCalledWith(
          expect.objectContaining({ type: "hench:run-appended", runId: "run-live", stream: "log" }),
        );
      }, { timeout: 1_000, interval: RUN_TAIL_POLL_MS / 5 });
      expect(Date.now() - writtenAt).toBeLessThan(1_000);

      const next = await get(`/api/hench/runs/run-live/log?from=${first.body.next}`);
      expect(next.body.content).toBe("line three\n");

      appendFileSync(liveEvents, JSON.stringify(event("gate", "Test gate passed")) + "\n");
      await vi.waitFor(() => {
        expect(broadcast).toHaveBeenCalledWith(
          expect.objectContaining({ type: "hench:run-appended", runId: "run-live", stream: "events" }),
        );
      }, { timeout: 1_000, interval: RUN_TAIL_POLL_MS / 5 });
    });

    it("watches a running run but not a finished one", async () => {
      server = await serve(repo, vi.fn());
      await get("/api/hench/runs/run-old/log");
      await get("/api/hench/runs/run-old/events");
      expect(runTailWatchCount()).toBe(0);

      // Both streams of one run share one watch, and renewing does not add another.
      await get("/api/hench/runs/run-live/log");
      await get("/api/hench/runs/run-live/events");
      expect(runTailWatchCount()).toBe(1);
    });
  });
});
