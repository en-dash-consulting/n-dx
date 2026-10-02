/**
 * GET /api/hench/prep/:taskId, POST /api/hench/prep/:taskId/preview and
 * GET /api/hench/ready: the reads behind the Prepare task modal and the
 * Ready to run list. `ndx` itself is faked (exec is mocked); what is pinned is
 * what the routes spawn, where, and what they add to or do with its output.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  // Only the `ndx work …` spawns are faked; git (worktree list) and the CLI
  // version probes behind the catalog still run for real.
  const exec: typeof actual.exec = (cmd, args, opts) =>
    args.includes("work") ? execMock(cmd, args, opts) : actual.exec(cmd, args, opts);
  return { ...actual, exec };
});

vi.mock("../../../src/server/rex-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/rex-gateway.js")>();
  return {
    ...actual,
    findNextTask: vi.fn(actual.findNextTask),
    findActionableTasks: vi.fn(actual.findActionableTasks),
  };
});

import { TIER_MODELS } from "@n-dx/llm-client";
import { collectCompletedIds, findActionableTasks, findNextTask } from "../../../src/server/rex-gateway.js";
import type { ServerContext } from "../../../src/server/types.js";
import { resetHenchRouteStateForTests } from "../../../src/server/routes-hench.js";
import {
  handleHenchPrepRoute,
  PREP_PREVIEW_TIMEOUT_MS,
  PREP_RESOLVE_TIMEOUT_MS,
} from "../../../src/server/routes-hench-prep.js";
import { HUB_ADMISSION_HEADER, formatHubAdmissionHeader } from "../../../src/shared/index.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const CLAUDE_MODEL = TIER_MODELS.claude.standard;

const RESOLVE_JSON = {
  task: { id: "task-1", title: "Prep me", status: "pending", level: "task", blockedBy: [], claimedBy: null },
  workspace: { root: "ignored", branch: "from-hench", dirty: true },
  resolved: { vendor: { value: "claude", source: "llm.vendor" } },
  options: [],
  refusals: [],
  command: "ndx work --task=task-1 --auto .",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

interface Served {
  ctx: ServerContext;
  server: Server;
  port: number;
}

async function serve(ctx: ServerContext): Promise<Served> {
  const started = await startRouteTestServer((req, res) => handleHenchPrepRoute(req, res, ctx));
  return { ctx, server: started.server, port: started.port };
}

async function seedWorkspace(dir: string): Promise<ServerContext> {
  const rexDir = join(dir, ".rex");
  await mkdir(join(rexDir, ".cache"), { recursive: true });
  await mkdir(join(dir, ".hench", "runs"), { recursive: true });
  await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
  return { projectDir: dir, svDir: join(dir, ".sourcevision"), rexDir, dev: false };
}

async function writeTasks(ctx: ServerContext, items: Array<Record<string, unknown>>): Promise<void> {
  await writeFile(join(ctx.rexDir, ".cache", "prd.json"), JSON.stringify({ schema: "rex/v1", title: "prep", items }));
}

describe("hench prep routes", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let served: Served[];

  async function open(c: ServerContext): Promise<number> {
    const s = await serve(c);
    served.push(s);
    return s.port;
  }

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    execMock.mockReset();
    execMock.mockResolvedValue({ stdout: JSON.stringify(RESOLVE_JSON), stderr: "", exitCode: 0, error: null, started: true });
    served = [];
    tmpDir = realpathSync(await mkdtemp(join(tmpdir(), "hench-prep-")));
    ctx = await seedWorkspace(tmpDir);
  });

  afterEach(async () => {
    for (const s of served) await closeRouteTestServer(s.server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("GET /api/hench/prep/:taskId", () => {
    it("returns the resolve JSON plus catalog, admission, workspace and recommendation:null", async () => {
      const port = await open(ctx);
      const res = await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.task).toEqual(RESOLVE_JSON.task);
      expect(body.command).toBe(RESOLVE_JSON.command);
      expect(body.resolved).toEqual(RESOLVE_JSON.resolved);
      expect(body.recommendation).toBeNull();
      // The catalog entry of the vendor hench resolved, not every vendor's.
      expect(body.catalog.vendor).toBe("claude");
      expect(body.catalog.providers).toEqual(expect.arrayContaining(["cli"]));
      expect(body.catalog.models).toContain(CLAUDE_MODEL);
      expect(body.catalog.claude).toBeUndefined();
      // Not served through the hub: no admission state to report.
      expect(body.admission).toBeNull();
      // Outside a git repository the served directory is the only workspace.
      expect(body.workspace).toMatchObject({ root: tmpDir, branch: "from-hench", isAnchor: true, dirty: true, liveRun: false });
    });

    it("adds the run's directory and the item's header fields from the PRD", async () => {
      await writeTasks(ctx, [{
        id: "epic-1", title: "The epic", level: "epic", status: "pending", children: [{
          id: "task-1", title: "Prep me", level: "task", status: "pending", priority: "high",
          acceptanceCriteria: ["one", "two"],
        }],
      }]);
      const port = await open(ctx);
      const body = await (await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`)).json();
      expect(body.dir).toBe(tmpDir);
      expect(body.detail).toEqual({ priority: "high", parentChain: ["The epic"], criteriaCount: 2 });
    });

    it("answers detail:null for an id the PRD does not have", async () => {
      const port = await open(ctx);
      const body = await (await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`)).json();
      expect(body.detail).toBeNull();
    });

    it("spawns `ndx work --task=<id> --resolve <dir>` in the workspace's directory with a 15 s timeout", async () => {
      const port = await open(ctx);
      await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`);
      expect(execMock).toHaveBeenCalledTimes(1);
      const [, args, opts] = execMock.mock.calls[0] as [string, string[], { cwd: string; timeout: number }];
      expect(args.slice(-4)).toEqual(["work", "--task=task-1", "--resolve", tmpDir]);
      expect(opts.cwd).toBe(tmpDir);
      expect(opts.timeout).toBe(PREP_RESOLVE_TIMEOUT_MS);
      expect(PREP_RESOLVE_TIMEOUT_MS).toBe(15_000);
    });

    // Execute passes --reset-deferred for a deferred task; resolving without it
    // would report the run execute starts as refused (not-actionable).
    it("resolves a deferred task with --reset-deferred, the run execute starts", async () => {
      await writeTasks(ctx, [
        { id: "task-1", title: "Deferred", level: "task", status: "deferred" },
        { id: "task-2", title: "Pending", level: "task", status: "pending" },
      ]);
      const port = await open(ctx);
      await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`);
      await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-2`);
      const [deferred, pending] = execMock.mock.calls.map((c) => c[1] as string[]);
      expect(deferred!.slice(-5)).toEqual(["work", "--task=task-1", "--resolve", "--reset-deferred", tmpDir]);
      expect(pending).not.toContain("--reset-deferred");
    });

    it("keeps the task id one argv word", async () => {
      const port = await open(ctx);
      await fetch(`http://127.0.0.1:${port}/api/hench/prep/${encodeURIComponent("a b;--auto")}`);
      const [, args] = execMock.mock.calls[0] as [string, string[]];
      expect(args).toContain("--task=a b;--auto");
    });

    it("answers for the addressed worktree: its directory, its branch, not the anchor", async () => {
      git(tmpDir, "init", "--quiet", "-b", "main");
      await writeFile(join(tmpDir, "file.txt"), "x");
      git(tmpDir, "add", "file.txt");
      git(tmpDir, "commit", "--quiet", "-m", "init");
      const linked = join(realpathSync(await mkdtemp(join(tmpdir(), "hench-prep-wt-"))), "feature");
      git(tmpDir, "worktree", "add", "--quiet", "-b", "feature", linked);
      try {
        const featureCtx: ServerContext = { ...(await seedWorkspace(linked)), workspace: "feature" };
        const anchorPort = await open(ctx);
        const featurePort = await open(featureCtx);

        const anchor = await (await fetch(`http://127.0.0.1:${anchorPort}/api/hench/prep/task-1`)).json();
        expect(anchor.workspace).toMatchObject({ root: tmpDir, branch: "main", isAnchor: true });

        const feature = await (await fetch(`http://127.0.0.1:${featurePort}/api/hench/prep/task-1`)).json();
        expect(feature.workspace).toMatchObject({ key: "feature", root: linked, branch: "feature", isAnchor: false });

        const cwds = execMock.mock.calls.map((c) => (c[2] as { cwd: string }).cwd);
        expect(cwds).toEqual([tmpDir, linked]);
        const lastArgs = execMock.mock.calls[1]![1] as string[];
        expect(lastArgs[lastArgs.length - 1]).toBe(linked);
      } finally {
        await rm(join(linked, ".."), { recursive: true, force: true });
      }
    });

    it("reports a live run in this worktree", async () => {
      await writeFile(join(tmpDir, ".hench", "runs", "run-live.json"), JSON.stringify({
        id: "run-live",
        taskId: "task-1",
        status: "running",
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        pid: process.pid,
      }));
      const port = await open(ctx);
      const body = await (await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`)).json();
      expect(body.workspace.liveRun).toBe(true);
    });

    it("reports the hub's admission state when the proxy states it", async () => {
      const port = await open(ctx);
      const header = formatHubAdmissionHeader({
        running: 3,
        maxSessions: 4,
        queued: 2,
        availableBytes: 123456,
        pressure: "warn",
        memoryPaused: true,
      });
      const body = await (await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`, {
        headers: { [HUB_ADMISSION_HEADER]: header },
      })).json();
      expect(body.admission).toEqual({
        running: 3, max: 4, queued: 2, availableBytes: 123456, pressure: "warn", memoryPaused: true,
      });
    });

    it("fills the memory fields for a hub that does not send them", async () => {
      const port = await open(ctx);
      const body = await (await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`, {
        headers: { [HUB_ADMISSION_HEADER]: formatHubAdmissionHeader({ running: 1, maxSessions: 4, queued: 0 }) },
      })).json();
      expect(body.admission).toEqual({
        running: 1, max: 4, queued: 0, availableBytes: null, pressure: "unknown", memoryPaused: false,
      });
    });

    it("answers 502 with the stderr tail when the resolve fails", async () => {
      const stderr = `${"noise\n".repeat(400)}Error: --task is not in the PRD`;
      execMock.mockResolvedValue({ stdout: "", stderr, exitCode: 1, error: null, started: true });
      const port = await open(ctx);
      const res = await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`);
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toContain("code 1");
      expect(body.stderr.endsWith("Error: --task is not in the PRD")).toBe(true);
      expect(body.stderr.length).toBeLessThanOrEqual(1000);
    });

    it("answers 502, not a hung request, when the resolve times out", async () => {
      execMock.mockResolvedValue({ stdout: "", stderr: "still thinking", exitCode: null, error: null, started: true });
      const port = await open(ctx);
      const res = await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`);
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toContain("Timed out after 15s");
      expect(body.stderr).toBe("still thinking");
    });

    it("answers 502 when the resolve printed something that is not JSON", async () => {
      execMock.mockResolvedValue({ stdout: "hello", stderr: "warn", exitCode: 0, error: null, started: true });
      const port = await open(ctx);
      const res = await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1`);
      expect(res.status).toBe(502);
      expect((await res.json()).stderr).toBe("warn");
    });
  });

  describe("POST /api/hench/prep/:taskId/preview", () => {
    function preview(port: number, body: unknown, taskId = "task-1"): Promise<Response> {
      return fetch(`http://127.0.0.1:${port}/api/hench/prep/${taskId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    beforeEach(() => {
      execMock.mockResolvedValue({ stdout: "THE BRIEF", stderr: "", exitCode: 0, error: null, started: true });
    });

    it("returns the dry-run brief for the given options, as flags in the workspace's directory", async () => {
      const port = await open(ctx);
      const res = await preview(port, { options: { model: CLAUDE_MODEL, fresh: true, tokenBudget: 5000 } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ brief: "THE BRIEF" });

      const [, args, opts] = execMock.mock.calls[0] as [string, string[], { cwd: string; timeout: number }];
      const work = args.indexOf("work");
      expect(args.slice(work)).toEqual([
        "work", "--task=task-1", "--dry-run",
        `--model=${CLAUDE_MODEL}`, "--token-budget=5000", "--fresh",
        tmpDir,
      ]);
      expect(opts.cwd).toBe(tmpDir);
      expect(opts.timeout).toBe(PREP_PREVIEW_TIMEOUT_MS);
      expect(PREP_PREVIEW_TIMEOUT_MS).toBe(30_000);
    });

    it("accepts a body with no options", async () => {
      const port = await open(ctx);
      expect((await preview(port, {})).status).toBe(200);
      const [, args] = execMock.mock.calls[0] as [string, string[]];
      expect(args.slice(args.indexOf("work"))).toEqual(["work", "--task=task-1", "--dry-run", tmpDir]);
    });

    it("previews a deferred task with --reset-deferred, which a dry run reads as pending without writing", async () => {
      await writeTasks(ctx, [{ id: "task-1", title: "Deferred", level: "task", status: "deferred" }]);
      const port = await open(ctx);
      expect((await preview(port, { options: { fresh: true } })).status).toBe(200);
      const [, args] = execMock.mock.calls[0] as [string, string[]];
      expect(args.slice(args.indexOf("work"))).toEqual([
        "work", "--task=task-1", "--dry-run", "--fresh", "--reset-deferred", tmpDir,
      ]);
    });

    it("hands contextNotes over in a file that is gone when the answer is", async () => {
      let contextPath = "";
      let content = "";
      execMock.mockImplementation(async (_bin: string, args: string[]) => {
        const flag = args.find((a) => a.startsWith("--context-file="))!;
        contextPath = flag.slice("--context-file=".length);
        content = await readFile(contextPath, "utf-8");
        return { stdout: "B", stderr: "", exitCode: 0, error: null, started: true };
      });
      const port = await open(ctx);
      expect((await preview(port, { options: { contextNotes: "Use the helper." } })).status).toBe(200);
      expect(content).toBe("Use the helper.");
      expect(existsSync(contextPath)).toBe(false);
    });

    it.each([
      [{ options: { nope: true } }, "nope"],
      [{ options: { maxTurns: 0 } }, "maxTurns"],
      [{ options: { model: "gpt-5.4" } }, "model"],
      [{ options: ["--fresh"] }, "options"],
    ])("rejects invalid options %j with 400 naming the key, spawning nothing", async (body, key) => {
      const port = await open(ctx);
      const res = await preview(port, body);
      expect(res.status).toBe(400);
      expect((await res.json()).key).toBe(key);
      expect(execMock).not.toHaveBeenCalled();
    });

    it("rejects a body that is not JSON with 400", async () => {
      const port = await open(ctx);
      const res = await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1/preview`, { method: "POST", body: "{nope" });
      expect(res.status).toBe(400);
      expect(execMock).not.toHaveBeenCalled();
    });

    it("answers 502 with the stderr tail and any stdout when the dry run fails", async () => {
      execMock.mockResolvedValue({ stdout: "Refused: claimed elsewhere", stderr: "boom", exitCode: 1, error: null, started: true });
      const port = await open(ctx);
      const res = await preview(port, { options: {} });
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ stderr: "boom", brief: "Refused: claimed elsewhere" });
    });

    it("answers 502 when the dry run times out", async () => {
      execMock.mockResolvedValue({ stdout: "", stderr: "", exitCode: null, error: null, started: true });
      const port = await open(ctx);
      const res = await preview(port, { options: {} });
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain("Timed out after 30s");
    });

    it("answers only POST", async () => {
      const port = await open(ctx);
      const res = await fetch(`http://127.0.0.1:${port}/api/hench/prep/task-1/preview`);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/hench/ready", () => {
    function task(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
      return { id, title: `Task ${id}`, status: "pending", level: "task", priority: "medium", ...extra };
    }

    async function ready(port: number, query = ""): Promise<{ tasks: Array<Record<string, unknown>>; limit: number; dir: string }> {
      const res = await fetch(`http://127.0.0.1:${port}/api/hench/ready${query}`);
      expect(res.status).toBe(200);
      return res.json();
    }

    it("lists tasks in the order findNextTask picks them, with their row fields", async () => {
      await writeTasks(ctx, [
        {
          id: "epic", title: "The epic", status: "in_progress", level: "epic", children: [
            {
              id: "feat", title: "The feature", status: "in_progress", level: "feature", children: [
                task("low", { priority: "low" }),
                task("crit", { priority: "critical", acceptanceCriteria: ["a", "b"], tags: ["web", "prep"] }),
                task("high", { priority: "high" }),
              ],
            },
          ],
        },
      ]);
      const port = await open(ctx);
      const { tasks, limit, dir } = await ready(port);
      expect(limit).toBe(10);
      expect(dir).toBe(ctx.projectDir);
      expect(tasks.map((t) => t.id)).toEqual(["crit", "high", "low"]);
      expect(tasks[0]).toEqual({
        id: "crit",
        title: "Task crit",
        status: "pending",
        priority: "critical",
        level: "task",
        parentChain: ["The epic", "The feature"],
        criteriaCount: 2,
        tags: ["web", "prep"],
        resume: false,
        liveRun: false,
      });
      expect(tasks[1]).toMatchObject({ criteriaCount: 0, tags: [] });
    });

    it("returns the order of repeated findNextTask picks, with dependencies and mixed priorities", async () => {
      const priorities = ["low", "medium", "high", "critical"];
      const items = [
        task("base", { priority: "low" }),
        task("needs-base", { priority: "critical", blockedBy: ["base"] }),
        task("started", { priority: "low", status: "in_progress" }),
        ...Array.from({ length: 12 }, (_, i) =>
          task(`m${String(i).padStart(2, "0")}`, { priority: priorities[i % 4], ...(i % 5 === 0 ? { blockedBy: ["base"] } : {}) })),
      ];
      await writeTasks(ctx, items);
      const expected: string[] = [];
      const completed = collectCompletedIds(items as never);
      const excludeIds = new Set<string>();
      for (;;) {
        const entry = findNextTask(items as never, completed, { excludeIds });
        if (!entry) break;
        excludeIds.add(entry.item.id);
        expected.push(entry.item.id);
      }
      expect(expected.length).toBeGreaterThan(5);
      const port = await open(ctx);
      expect((await ready(port, "?limit=50")).tasks.map((t) => t.id)).toEqual(expected.slice(0, 50));
    });

    it("orders a 2,000-item tree in one selection pass", async () => {
      const features = Array.from({ length: 40 }, (_, f) => ({
        id: `f${f}`, title: `Feature ${f}`, status: "pending", level: "feature", priority: "medium",
        children: Array.from({ length: 49 }, (_, t) =>
          task(`f${f}-t${t}`, {
            priority: ["low", "medium", "high", "critical"][(f + t) % 4],
            ...(t > 0 && t % 3 === 0 ? { blockedBy: [`f${f}-t${t - 1}`] } : {}),
          })),
      }));
      await writeTasks(ctx, features);
      const port = await open(ctx);
      vi.mocked(findNextTask).mockClear();
      vi.mocked(findActionableTasks).mockClear();
      const { tasks } = await ready(port, "?limit=50");
      expect(tasks).toHaveLength(50);
      // The per-row loop rebuilt the comparator on every call (~5 s on 1,800
      // items); counting calls pins the regression without a clock.
      expect(findActionableTasks).toHaveBeenCalledTimes(1);
      expect(findNextTask).not.toHaveBeenCalled();
    });

    it("honours ?limit=N, defaults to 10 and clamps to 1..50", async () => {
      await writeTasks(ctx, Array.from({ length: 60 }, (_, i) => task(`t${String(i).padStart(2, "0")}`)));
      const port = await open(ctx);
      expect((await ready(port)).tasks).toHaveLength(10);
      expect((await ready(port, "?limit=3")).tasks).toHaveLength(3);
      expect((await ready(port, "?limit=500")).tasks).toHaveLength(50);
      expect((await ready(port, "?limit=0")).tasks).toHaveLength(1);
      expect((await ready(port, "?limit=abc")).tasks).toHaveLength(10);
    });

    describe("stuck tasks", () => {
      async function writeRun(id: string, taskId: string, status: string): Promise<void> {
        const dir = join(tmpDir, ".hench", "runs");
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${id}.json`), JSON.stringify({ id, taskId, status, startedAt: "2026-10-01T00:00:00Z" }));
      }

      // Equal priorities throughout: only the dependency chain and the stuck set decide the order.
      const chain = (): Array<Record<string, unknown>> => [
        task("a-stuck"),
        task("b-after-stuck", { blockedBy: ["a-stuck"] }),
        task("c-after-b", { blockedBy: ["b-after-stuck"] }),
        task("d-free"),
      ];

      it("omits a stuck task and offers its dependents, as --auto does", async () => {
        await writeTasks(ctx, chain());
        await writeRun("2026-10-01-1", "a-stuck", "failed");
        await writeRun("2026-10-01-2", "a-stuck", "timeout");
        await writeRun("2026-10-01-3", "a-stuck", "budget_exceeded");
        const port = await open(ctx);
        const ids = (await ready(port)).tasks.map((t) => t.id);
        expect(ids).not.toContain("a-stuck");
        expect(ids).toContain("b-after-stuck");
        expect(ids).not.toContain("c-after-b");
        // Pinned to the selection --auto runs: stuck ids are excluded and count as completed.
        const items = chain();
        const stuck = new Set(["a-stuck"]);
        const expected = findActionableTasks(items as never, new Set([...collectCompletedIds(items as never), ...stuck]), 10, { excludeIds: stuck }).map((e) => e.item.id);
        expect(ids).toEqual(expected);
      });

      it("lists the task once failures are below maxFailedAttempts, or a success intervenes", async () => {
        await writeTasks(ctx, chain());
        await writeRun("2026-10-01-1", "a-stuck", "failed");
        await writeRun("2026-10-01-2", "a-stuck", "failed");
        const port = await open(ctx);
        expect((await ready(port)).tasks.map((t) => t.id)).toContain("a-stuck");
        await writeRun("2026-10-01-3", "a-stuck", "completed");
        await writeRun("2026-10-01-4", "a-stuck", "failed");
        expect((await ready(port)).tasks.map((t) => t.id)).toContain("a-stuck");
      });

      it("honours maxFailedAttempts from the hench config", async () => {
        await writeTasks(ctx, chain());
        await mkdir(join(tmpDir, ".hench"), { recursive: true });
        await writeFile(join(tmpDir, ".hench", "config.json"), JSON.stringify({ maxFailedAttempts: 1 }));
        await writeRun("2026-10-01-1", "a-stuck", "failed");
        const port = await open(ctx);
        expect((await ready(port)).tasks.map((t) => t.id)).not.toContain("a-stuck");
      });
    });

    it("never lists a blocked task or one another worktree holds", async () => {
      git(tmpDir, "init", "--quiet");
      const holder: ChildProcess = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
      try {
        await mkdir(join(tmpDir, ".git", "ndx"), { recursive: true });
        await writeFile(join(tmpDir, ".git", "ndx", "claims.json"), JSON.stringify({
          version: 1,
          claims: {
            held: {
              taskId: "held",
              worktreeRoot: "/somewhere/else/feature-x",
              pid: holder.pid,
              host: "test",
              claimedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          },
        }));
        await writeTasks(ctx, [
          task("held", { priority: "critical" }),
          task("blocked", { priority: "critical", status: "blocked" }),
          task("free", { priority: "low" }),
        ]);
        const port = await open(ctx);
        expect((await ready(port)).tasks.map((t) => t.id)).toEqual(["free"]);
      } finally {
        holder.kill();
      }
    });

    it("marks an in-progress task with no live run as resume, and one with a live run as liveRun", async () => {
      await writeTasks(ctx, [
        task("stopped", { status: "in_progress", priority: "critical" }),
        task("running", { status: "in_progress", priority: "high" }),
        task("fresh", { priority: "low" }),
      ]);
      await writeFile(join(tmpDir, ".hench", "runs", "run-dead.json"), JSON.stringify({
        id: "run-dead", taskId: "stopped", status: "running",
        startedAt: new Date(Date.now() - 60_000).toISOString(), pid: 2 ** 22 + 4243,
      }));
      await writeFile(join(tmpDir, ".hench", "runs", "run-live.json"), JSON.stringify({
        id: "run-live", taskId: "running", status: "running",
        startedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), pid: process.pid,
      }));
      const port = await open(ctx);
      const rows = Object.fromEntries((await ready(port)).tasks.map((t) => [t.id as string, t]));
      expect(rows["stopped"]).toMatchObject({ resume: true, liveRun: false });
      expect(rows["running"]).toMatchObject({ resume: false, liveRun: true });
      expect(rows["fresh"]).toMatchObject({ resume: false, liveRun: false });
    });

    it("answers 404 without a PRD", async () => {
      await rm(join(ctx.rexDir, ".cache"), { recursive: true, force: true });
      const port = await open(ctx);
      const res = await fetch(`http://127.0.0.1:${port}/api/hench/ready`);
      expect(res.status).toBe(404);
    });

    it("lists the addressed workspace's tasks", async () => {
      const otherDir = realpathSync(await mkdtemp(join(tmpdir(), "hench-prep-other-")));
      try {
        const other = await seedWorkspace(otherDir);
        await writeTasks(ctx, [task("anchor-task")]);
        await writeTasks(other, [task("other-task")]);
        const anchorPort = await open(ctx);
        const otherPort = await open({ ...other, workspace: "other" });
        expect((await ready(anchorPort)).tasks.map((t) => t.id)).toEqual(["anchor-task"]);
        expect((await ready(otherPort)).tasks.map((t) => t.id)).toEqual(["other-task"]);
      } finally {
        await rm(otherDir, { recursive: true, force: true });
      }
    });
  });
});
