/**
 * POST /api/hench/execute `options`: each allow-listed key becomes exactly its
 * `ndx work` flag, everything else is a 400 naming the key, and the status
 * rules for which tasks may start (in-progress resumable, deferred reset).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";

const { spawnManagedMock } = vi.hoisted(() => ({ spawnManagedMock: vi.fn() }));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, spawnManaged: spawnManagedMock };
});

import { TIER_MODELS } from "@n-dx/llm-client";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute, resetHenchRouteStateForTests } from "../../../src/server/routes-hench.js";
import { RUN_OPTION_SPECS, checkRunOptions, runOptionArgs, workCommandArgs } from "../../../src/shared/index.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const CLAUDE_MODEL = TIER_MODELS.claude.standard;
const CLAUDE_REVIEW_MODEL = TIER_MODELS.claude.heavy;

describe("POST /api/hench/execute — run options", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let finishRun: (result: { exitCode: number; stdout: string; stderr: string }) => void;

  async function writeTasks(items: Array<Record<string, unknown>>): Promise<void> {
    await writeFile(
      join(ctx.rexDir, ".cache", "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "options", items }),
    );
  }

  function execute(body: Record<string, unknown>): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** The `ndx work` words after `work --task=<id> --auto` and before the directory. */
  function spawnedFlags(): string[] {
    expect(spawnManagedMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnManagedMock.mock.calls[0] as [string, string[], unknown];
    const start = args.indexOf("--auto") + 1;
    expect(args[args.length - 1]).toBe(tmpDir);
    return args.slice(start, -1);
  }

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    spawnManagedMock.mockReset();
    spawnManagedMock.mockImplementation(() => ({
      done: new Promise((resolve) => { finishRun = resolve; }),
      kill: vi.fn(() => true),
      pid: 4242,
    }));

    tmpDir = await mkdtemp(join(tmpdir(), "hench-execute-options-"));
    const rexDir = join(tmpDir, ".rex");
    await mkdir(join(rexDir, ".cache"), { recursive: true });
    await mkdir(join(tmpDir, ".hench", "runs"), { recursive: true });
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
    await writeTasks([{ id: "task-1", title: "Options task", status: "pending", level: "task" }]);

    const started = await startRouteTestServer((req, res) => Promise.resolve(handleHenchRoute(req, res, ctx)));
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("maps every allow-listed key to exactly its flag", async () => {
    const options = {
      model: CLAUDE_MODEL,
      provider: "api",
      permissionMode: "bypassPermissions",
      review: true,
      reviewModel: CLAUDE_REVIEW_MODEL,
      skipTestGate: true,
      maxTurns: 40,
      tokenBudget: 0,
      fresh: true,
      allowDirty: true,
      contextNotes: "Prefer the existing helper.",
    };
    // The test covers the whole table: a key added to it without a case here fails.
    expect(Object.keys(options).sort()).toEqual(RUN_OPTION_SPECS.map((s) => s.key).sort());

    const res = await execute({ taskId: "task-1", options });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.options).toEqual(options);

    const flags = spawnedFlags();
    const contextFlag = flags.find((f) => f.startsWith("--context-file="));
    expect(flags).toEqual([
      `--model=${CLAUDE_MODEL}`,
      "--provider=api",
      "--permission-mode=bypassPermissions",
      "--review",
      `--review-model=${CLAUDE_REVIEW_MODEL}`,
      "--skip-test-gate",
      "--max-turns=40",
      "--token-budget=0",
      "--fresh",
      "--allow-dirty",
      contextFlag,
    ]);
  });

  it("spawns exactly workCommandArgs — the builder the Prepare task modal prints", async () => {
    const options = { model: CLAUDE_MODEL, review: true, maxTurns: 12, contextNotes: "notes" };
    expect((await execute({ taskId: "task-1", options })).status).toBe(202);
    const [, args] = spawnManagedMock.mock.calls[0] as [string, string[], unknown];
    const contextFile = args.find((a) => a.startsWith("--context-file="))!.slice("--context-file=".length);
    const expected = workCommandArgs({ taskId: "task-1", options, dir: tmpDir, contextFile });
    expect(args.slice(args.indexOf("work"))).toEqual(expected);
  });

  it("serializes every integer option as plain decimal digits", () => {
    const largest = { maxTurns: 500, tokenBudget: Number.MAX_SAFE_INTEGER };
    for (const options of [largest, { maxTurns: 1, tokenBudget: 0 }, { tokenBudget: 1e15 }]) {
      const check = checkRunOptions(options);
      expect(check.ok).toBe(true);
      if (!check.ok) continue;
      const args = runOptionArgs(check.options);
      expect(args.length).toBe(Object.keys(options).length);
      for (const arg of args) expect(arg).toMatch(/^--[a-z-]+=\d+$/);
    }
    expect(runOptionArgs(largest)).toEqual(["--max-turns=500", `--token-budget=${Number.MAX_SAFE_INTEGER}`]);
    expect(checkRunOptions({ tokenBudget: 1e21 })).toMatchObject({ ok: false, key: "tokenBudget" });
  });

  it("adds nothing for false booleans or no options", async () => {
    const res = await execute({ taskId: "task-1", options: { review: false, fresh: false } });
    expect(res.status).toBe(202);
    expect(spawnedFlags()).toEqual([]);
  });

  it("writes contextNotes to a temp file for --context-file and removes it when the run ends", async () => {
    const res = await execute({ taskId: "task-1", options: { contextNotes: "Line one\n--model=evil" } });
    expect(res.status).toBe(202);

    const [flag] = spawnedFlags();
    const path = flag.slice("--context-file=".length);
    expect(path.startsWith(tmpdir())).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("Line one\n--model=evil");

    finishRun({ exitCode: 0, stdout: "", stderr: "" });
    await vi.waitFor(() => expect(existsSync(path)).toBe(false));
  });

  it.each([
    [{ bogus: true }, "bogus"],
    [{ maxTurns: 0 }, "maxTurns"],
    [{ maxTurns: 501 }, "maxTurns"],
    [{ maxTurns: 2.5 }, "maxTurns"],
    [{ tokenBudget: -1 }, "tokenBudget"],
    [{ tokenBudget: 1e21 }, "tokenBudget"],
    [{ tokenBudget: Number.MAX_SAFE_INTEGER + 1 }, "tokenBudget"],
    [{ tokenBudget: Number.POSITIVE_INFINITY }, "tokenBudget"],
    [{ permissionMode: "plan" }, "permissionMode"],
    [{ provider: "shell" }, "provider"],
    [{ review: "yes" }, "review"],
    [{ reviewModel: CLAUDE_REVIEW_MODEL }, "reviewModel"],
    [{ model: "--allow-dirty" }, "model"],
    [{ model: "gpt-5.4" }, "model"],
    [{ model: "claude-not-a-real-model" }, "model"],
    [{ review: true, reviewModel: "-x" }, "reviewModel"],
    [{ contextNotes: "x".repeat(8 * 1024 + 1) }, "contextNotes"],
    [{ contextNotes: 3 }, "contextNotes"],
  ])("answers 400 naming the key for %j", async (options, key) => {
    const res = await execute({ taskId: "task-1", options });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.key).toBe(key);
    expect(body.error).toContain(key);
    expect(spawnManagedMock).not.toHaveBeenCalled();
  });

  it("answers 400 when options is not an object", async () => {
    const res = await execute({ taskId: "task-1", options: ["--fresh"] });
    expect(res.status).toBe(400);
    expect((await res.json()).key).toBe("options");
  });

  it("refuses a provider the vendor does not support", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "codex" } }));
    const res = await execute({ taskId: "task-1", options: { provider: "api" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.key).toBe("provider");
    expect(body.error).toContain("codex");
  });

  it("starts an in-progress task no run holds, without --reset-deferred", async () => {
    await writeTasks([{ id: "task-1", title: "Interrupted", status: "in_progress", level: "task" }]);
    // A run left `running` by a process that is gone: orphaned, not a holder.
    await writeFile(join(tmpDir, ".hench", "runs", "run-dead.json"), JSON.stringify({
      id: "run-dead",
      taskId: "task-1",
      status: "running",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      lastActivityAt: new Date().toISOString(),
      pid: 2 ** 22 + 4243,
    }));

    const res = await execute({ taskId: "task-1" });
    expect(res.status).toBe(202);
    const [, args] = spawnManagedMock.mock.calls[0] as [string, string[], unknown];
    expect(args).not.toContain("--reset-deferred");
  });

  it("still passes --reset-deferred for a deferred task, after the options", async () => {
    await writeTasks([{ id: "task-1", title: "Later", status: "deferred", level: "task" }]);
    const res = await execute({ taskId: "task-1", options: { fresh: true } });
    expect(res.status).toBe(202);
    expect(spawnedFlags()).toEqual(["--fresh", "--reset-deferred"]);
  });
});
