import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanupProjectDir } from "../helpers/index.js";
import {
  createScriptedClaudeCli,
  setupScriptedProject,
  initLine,
  toolUseLine,
  textLine,
  type ScriptedClaudeCli,
} from "../helpers/scripted-claude-cli.js";
import { loadConfig, saveConfig } from "../../src/store/config.js";
import { saveRun, loadRun } from "../../src/store/runs.js";
import type { HenchConfig, RunRecord } from "../../src/schema/index.js";

/**
 * The run-level outcome of each session bound, driven through `cliLoop` with
 * a scripted Claude CLI: what the run record says, what the task is reset to,
 * and that no retry spends past the bound.
 */

const SESSION = "sess-bounds-0001";

describe("cliLoop — session bounds", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-session-bounds-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    cli = createScriptedClaudeCli(actual.spawn);
    vi.doMock("node:child_process", () => ({ ...actual, spawn: cli.spawn }));
  });

  afterEach(async () => {
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  async function runLoop(opts: { abortSignal?: AbortSignal; maxTurns?: number; config?: Partial<HenchConfig> } = {}) {
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    const config = { ...(await loadConfig(henchDir)), ...opts.config } as HenchConfig;
    const store = createStore("file", rexDir);
    const result = await cliLoop({
      config,
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
      autonomous: true,
      yes: true,
      reviewOptional: true,
      ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
      ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
    });
    const task = await store.getItem("task-1");
    return { run: result.run, taskStatus: task?.status };
  }

  it("an interrupt stops the session in flight and records the run as cancelled, without a retry", async () => {
    const controller = new AbortController();
    cli.script(() => {
      // The operator presses Ctrl-C while the session is working.
      setTimeout(() => controller.abort(new Error("Interrupted by SIGINT")), 50);
      return { lines: [initLine(SESSION), toolUseLine(SESSION, "Read", { file_path: "x" })], hang: true };
    });

    const { run, taskStatus } = await runLoop({ abortSignal: controller.signal });

    expect(run.status).toBe("cancelled");
    expect(run.error).toBe("Interrupted by SIGINT");
    expect(cli.invocations).toHaveLength(1);
    expect(taskStatus).toBe("pending");
    expect((await loadRun(henchDir, run.id)).status).toBe("cancelled");
  });

  it("passes the resolved turn cap as --max-turns and ends a capped session with status timeout", async () => {
    cli.script(() => ({
      lines: [
        initLine(SESSION),
        textLine(SESSION, "still going"),
        { type: "result", subtype: "error_max_turns", is_error: true, num_turns: 7, session_id: SESSION },
      ],
    }));

    const { run, taskStatus } = await runLoop({ maxTurns: 7 });

    const args = cli.invocations[0].args;
    expect(args[args.indexOf("--max-turns") + 1]).toBe("7");
    expect(run.status).toBe("timeout");
    expect(run.error).toBe("Exceeded max turns (7)");
    expect(cli.invocations).toHaveLength(1);
    expect(taskStatus).toBe("deferred");
  });

  it("guard.sessionTimeout stops a session that runs too long", async () => {
    cli.script(() => ({ lines: [initLine(SESSION)], hang: true }));
    const config = await loadConfig(henchDir);

    const { run } = await runLoop({ config: { guard: { ...config.guard, sessionTimeout: 150 } } });

    expect(run.status).toBe("timeout");
    expect(run.error).toMatch(/guard\.sessionTimeout/);
    expect(cli.invocations).toHaveLength(1);
  });

  it("a reached per-day spend cap stops the run before any session starts", async () => {
    const earlier: RunRecord = {
      id: "earlier-run",
      taskId: "other",
      taskTitle: "Other",
      startedAt: new Date().toISOString(),
      status: "completed",
      turns: 1,
      tokenUsage: { input: 10_000_000, output: 0 },
      toolCalls: [],
      model: "claude-opus-5-5",
    };
    await saveRun(henchDir, earlier);
    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, { ...config, maxCostUsdPerDay: 1 });

    const { run, taskStatus } = await runLoop();

    expect(run.status).toBe("budget_exceeded");
    expect(run.error).toMatch(/hench\.maxCostUsdPerDay \$1\.00/);
    expect(cli.invocations).toHaveLength(0);
    expect(taskStatus).toBe("pending");
  });

  it("records the session's tool results on the run, redacted on disk", async () => {
    const secret = "sk-ant-api03-" + "A".repeat(90);
    cli.script(() => ({
      lines: [
        initLine(SESSION),
        {
          type: "assistant",
          session_id: SESSION,
          message: { content: [{ type: "tool_use", id: "toolu_env", name: "Bash", input: { command: "cat .env" } }] },
        },
        {
          type: "user",
          session_id: SESSION,
          message: { content: [{ type: "tool_result", tool_use_id: "toolu_env", content: `ANTHROPIC_API_KEY=${secret}` }] },
        },
        { type: "result", subtype: "success", result: "nothing to do", num_turns: 1, session_id: SESSION },
      ],
    }));
    const config = await loadConfig(henchDir);
    // One attempt is enough to see the record; no retries.
    const { run } = await runLoop({ config: { retry: { ...config.retry!, maxRetries: 0 } } });

    const call = run.toolCalls.find((c) => c.tool === "Bash");
    expect(call?.output).toContain("ANTHROPIC_API_KEY=");
    const onDisk = await readFile(join(henchDir, "runs", `${run.id}.json`), "utf-8");
    expect(onDisk).toContain("ANTHROPIC_API_KEY=");
    expect(onDisk).not.toContain(secret);
  });
});
