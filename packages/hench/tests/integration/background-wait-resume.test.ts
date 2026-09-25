import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { cleanupProjectDir, decodeClaudeDelivery } from "../helpers/index.js";
import {
  createScriptedClaudeCli,
  setupScriptedProject,
  initLine,
  toolUseLine,
  textLine,
  resultLine,
  resumes,
  forks,
  type ScriptedClaudeCli,
  type ScriptedTurn,
} from "../helpers/scripted-claude-cli.js";
import { WORK_SESSION_RESUME_MESSAGE } from "../../src/agent/lifecycle/background-wait.js";
import { loadConfig, saveConfig } from "../../src/store/config.js";

/**
 * A work session that ends waiting on a background command is resumed once
 * (PR BG, task 20ecdcad).
 *
 * The defect: run 01d15d75 backgrounded the full suite with
 * `run_in_background: true`, called `ScheduleWakeup` and `Monitor`, and ended
 * its turn. Nothing notifies a `claude -p` session, so the agent never reached
 * its commit step and the uncommitted-work gate reset a task whose tests had
 * passed. These drive `cliLoop` through stream-json fixtures against a real
 * git repository, because "is the work committed" is the question the fix
 * turns on.
 */

const WORK_SESSION = "sess-work-0001";

describe("cliLoop — background-wait resume", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-bg-wait-"));

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const scripted = createScriptedClaudeCli(actual.spawn);
    cli = scripted;
    vi.doMock("node:child_process", () => ({ ...actual, spawn: scripted.spawn }));
  });

  afterEach(async () => {
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  // ── Agent actions on the fixture repo ─────────────────────────────────────

  const writeWork = (): void => {
    writeFileSync(join(projectDir, "feature.ts"), "export const feature = 1;\n", "utf-8");
  };

  const commitWork = (): void => {
    execFileSync("git", ["add", "feature.ts"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "feat: the feature"], { cwd: projectDir, stdio: "ignore" });
  };

  // ── Scripted sessions ─────────────────────────────────────────────────────

  /** Does the work, hands a command to the background, and ends waiting. */
  const endsWaiting = (tool: string, input: Record<string, unknown>): ScriptedTurn => () => {
    writeWork();
    return {
      lines: [
        initLine(WORK_SESSION),
        toolUseLine(WORK_SESSION, "Write", { file_path: "feature.ts", content: "..." }),
        toolUseLine(WORK_SESSION, tool, input),
        textLine(WORK_SESSION, "The suite is running in the background; I'll finish when it reports."),
        resultLine(WORK_SESSION, "waiting on the background suite"),
      ],
    };
  };

  const BACKGROUND_BASH = { command: "pnpm test 2>&1 | tail -150", run_in_background: true, timeout: 590000 };

  /** The resumed session: runs the suite in the foreground and commits. */
  const finishesInForeground: ScriptedTurn = () => {
    commitWork();
    return {
      lines: [
        initLine(WORK_SESSION),
        toolUseLine(WORK_SESSION, "Bash", { command: "pnpm test" }),
        toolUseLine(WORK_SESSION, "Bash", { command: "git commit -m 'feat: the feature'" }),
        resultLine(WORK_SESSION, "Committed the feature; suite green."),
      ],
    };
  };

  async function runLoop() {
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    const config = await loadConfig(henchDir);
    return cliLoop({
      config,
      store: createStore("file", rexDir),
      projectDir,
      henchDir,
      taskId: "task-1",
      autonomous: true,
      yes: true,
      reviewOptional: true,
    });
  }

  it("resumes once with the fixed message, and the resumed session's commit completes the run", async () => {
    cli.script(endsWaiting("Bash", BACKGROUND_BASH), finishesInForeground);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(2);
    const [, resume] = cli.invocations;
    expect(resumes(resume!, WORK_SESSION)).toBe(true);
    // Continues the session that stopped — a fork would leave its transcript behind.
    expect(forks(resume!)).toBe(false);
    // The task prompt, not raw stdin: on Windows stdin carries the system
    // prompt as well.
    const { taskPrompt } = decodeClaudeDelivery(resume!.args, resume!.stdin);
    expect(taskPrompt).toContain(WORK_SESSION_RESUME_MESSAGE);
    // The whole turn is the message: the resumed session already holds the task.
    expect(taskPrompt).not.toContain("Scripted task");

    expect(run.status).toBe("completed");
    expect(run.error).toBeUndefined();
  });

  it.each([
    ["ScheduleWakeup", { delaySeconds: 300, reason: "Fallback wake for the suite" }],
    ["Monitor", {}],
  ])("resumes a session that ended on %s the same way", async (tool, input) => {
    cli.script(endsWaiting(tool, input), finishesInForeground);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(2);
    expect(resumes(cli.invocations[1]!, WORK_SESSION)).toBe(true);
    expect(cli.invocations[1]!.stdin).toContain(WORK_SESSION_RESUME_MESSAGE);
    expect(run.status).toBe("completed");
    expect(run.backgroundResume?.tool).toBe(tool);
  });

  it("fails on a second background-and-end, names the cause, and spawns no third time", async () => {
    cli.script(
      endsWaiting("Bash", BACKGROUND_BASH),
      endsWaiting("ScheduleWakeup", { delaySeconds: 60, reason: "check back on the suite" }),
      finishesInForeground, // must never be consumed
    );

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(2);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/waiting on a background command again after being resumed/);
    expect(run.error).toContain("ScheduleWakeup");
    // The gate is not a rollback, and neither is this: the work is still there.
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: projectDir, encoding: "utf-8" }))
      .toContain("feature.ts");
  });

  it("does not resume a session that backgrounds a command but still commits and finishes", async () => {
    cli.script(() => {
      writeWork();
      commitWork();
      return {
        lines: [
          initLine(WORK_SESSION),
          toolUseLine(WORK_SESSION, "Bash", { command: "pnpm dev", run_in_background: true }),
          toolUseLine(WORK_SESSION, "Bash", { command: "git commit -m 'feat: the feature'" }),
          resultLine(WORK_SESSION, "Committed."),
        ],
      };
    });

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(1);
    expect(run.status).toBe("completed");
    expect(run.backgroundResume).toBeUndefined();
    expect(run.spawnBreakdown?.["background-resume"] ?? 0).toBe(0);
  });

  it("does not treat a foreground Bash call as a background wait", async () => {
    cli.script(() => {
      writeWork();
      return {
        lines: [
          initLine(WORK_SESSION),
          toolUseLine(WORK_SESSION, "Bash", { command: "pnpm test", run_in_background: false }),
          resultLine(WORK_SESSION, "Done, but forgot to commit."),
        ],
      };
    });

    const { run } = await runLoop();

    // Uncommitted work with no background call is the gate's business, as before.
    expect(cli.invocations).toHaveLength(1);
    expect(run.status).toBe("failed");
    expect(run.backgroundResume).toBeUndefined();
  });

  it("records the resume on the run record, and the record survives a reload", async () => {
    cli.script(endsWaiting("Bash", BACKGROUND_BASH), finishesInForeground);

    const { run } = await runLoop();

    expect(run.backgroundResume).toEqual({ tool: "Bash", detail: BACKGROUND_BASH.command });
    expect(run.spawnBreakdown?.["background-resume"]).toBe(1);

    const { loadRun } = await import("../../src/store/runs.js");
    const reloaded = await loadRun(henchDir, run.id);
    expect(reloaded.backgroundResume).toEqual({ tool: "Bash", detail: BACKGROUND_BASH.command });
  });

  it("resumes the work session, not the warm parent it was forked from", async () => {
    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, { ...config, sessionStrategy: "fork" });
    execFileSync("git", ["commit", "-am", "fork strategy"], { cwd: projectDir, stdio: "ignore" });
    const PARENT = "sess-parent-0001";

    cli.script(
      () => ({ lines: [initLine(PARENT), resultLine(PARENT, "Oriented.")] }),
      endsWaiting("Bash", BACKGROUND_BASH),
      finishesInForeground,
    );

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(3);
    const [, work, resume] = cli.invocations;
    expect(resumes(work!, PARENT) && forks(work!)).toBe(true);
    expect(resumes(resume!, WORK_SESSION)).toBe(true);
    expect(forks(resume!)).toBe(false);
    expect(run.status).toBe("completed");
  });
});
