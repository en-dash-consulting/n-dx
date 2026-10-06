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
  resultLine,
  resumes,
  forks,
  type ScriptedClaudeCli,
  type ScriptedTurn,
} from "../helpers/scripted-claude-cli.js";
import { randomUUID } from "node:crypto";
import { loadConfig, saveConfig } from "../../src/store/config.js";
import { listRuns, saveRun } from "../../src/store/runs.js";
import type { RunRecord } from "../../src/schema/index.js";
import { readSessionCache } from "../../src/agent/lifecycle/session-cache.js";
import { READ_ONLY_REFUSAL_REASON } from "../../src/agent/lifecycle/read-only-refusal.js";

/**
 * A forked attempt that treats the session as read-only is re-spawned cold
 * once (GH #473). Driven through stream-json fixtures against a real git
 * repository, because "did the attempt change anything" is the question the
 * detection turns on.
 */

const PARENT = "sess-parent-0001";
const WORK = "sess-work-0001";
const COLD = "sess-cold-0001";
const NO_CHANGES = /No changes detected in git diff/;

describe("cliLoop — read-only refusal retry", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-read-only-"));

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

  async function useForkStrategy(): Promise<void> {
    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, { ...config, sessionStrategy: "fork" });
    execFileSync("git", ["commit", "-am", "fork strategy"], { cwd: projectDir, stdio: "ignore" });
  }

  const orients: ScriptedTurn = () => ({ lines: [initLine(PARENT), resultLine(PARENT, "Oriented.")] });

  /** Reads, then declines to edit. */
  const refuses = (session: string): ScriptedTurn => () => ({
    lines: [
      initLine(session),
      toolUseLine(session, "Read", { file_path: "README.md" }),
      resultLine(session, "This session's instructions say not to edit anything, so I made no changes."),
    ],
  });

  /** Tries to edit, but the edit leaves no diff. */
  const editsWithoutDiff: ScriptedTurn = () => ({
    lines: [
      initLine(WORK),
      toolUseLine(WORK, "Edit", { file_path: "README.md", old_string: "a", new_string: "a" }),
      resultLine(WORK, "Edited."),
    ],
  });

  const commitsWork: ScriptedTurn = () => {
    writeFileSync(join(projectDir, "feature.ts"), "export const feature = 1;\n", "utf-8");
    execFileSync("git", ["add", "feature.ts"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "feat: the feature"], { cwd: projectDir, stdio: "ignore" });
    return {
      lines: [
        initLine(COLD),
        toolUseLine(COLD, "Write", { file_path: "feature.ts", content: "..." }),
        resultLine(COLD, "Committed the feature."),
      ],
    };
  };

  /** Seed an earlier failed run of task-1 that started at `startHead`, changed `files` and recorded `commits`. */
  async function seedEarlierRun(startHead: string, files: string[], commits?: string[]): Promise<RunRecord> {
    const run = {
      id: randomUUID(),
      taskId: "task-1",
      taskTitle: "Scripted task",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      finishedAt: new Date(Date.now() - 30_000).toISOString(),
      status: "failed",
      error: "timed out",
      turns: 3,
      tokenUsage: { input: 0, output: 0 },
      toolCalls: [],
      model: "test-model",
      startHead,
      ...(commits && { commits: commits.map((sha) => ({ sha, subject: "earlier work" })) }),
      structuredSummary: {
        filesChanged: files,
        filesRead: [],
        commandsExecuted: [],
        testsRun: [],
        counts: { filesRead: 0, filesChanged: files.length, commandsExecuted: 0, testsRun: 0, toolCallsTotal: 0 },
      },
    };
    await saveRun(henchDir, run);
    return run;
  }

  const head = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, encoding: "utf-8" }).trim();

  /** Commit `file` to the branch. Returns the HEAD it started from and the new commit. */
  function commitFile(file: string, message: string): { startHead: string; sha: string } {
    const startHead = head();
    writeFileSync(join(projectDir, file), `export const value = ${JSON.stringify(message)};\n`, "utf-8");
    execFileSync("git", ["add", file], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", message], { cwd: projectDir, stdio: "ignore" });
    return { startHead, sha: head() };
  }

  /** An earlier attempt's work, committed to the branch. */
  const commitEarlierWork = () => commitFile("earlier.ts", "feat: the earlier work");

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
      runHistory: await listRuns(henchDir),
    });
  }

  it("re-spawns a refusing fork once, cold, without retry budget, and keeps the cache", async () => {
    await useForkStrategy();
    cli.script(orients, refuses(WORK), commitsWork);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(3);
    const [, forked, cold] = cli.invocations;
    expect(resumes(forked!, PARENT) && forks(forked!)).toBe(true);
    expect(cold!.args).not.toContain("--resume");
    expect(forks(cold!)).toBe(false);
    const { taskPrompt } = decodeClaudeDelivery(cold!.args, cold!.stdin);
    expect(taskPrompt).toContain("treated its session as read-only");

    expect(run.status).toBe("completed");
    expect(run.readOnlyRefusal?.reason).toContain(READ_ONLY_REFUSAL_REASON);
    expect(run.readOnlyRefusal?.reason).toContain("instructions say not to edit");
    expect(run.spawnBreakdown?.["read-only-retry"]).toBe(1);
    expect(run.spawnBreakdown?.retry ?? 0).toBe(0);
    expect(run.spawnBreakdown?.["fork-fallback"] ?? 0).toBe(0);
    expect(run.retryAttempts).toBeUndefined();
    expect((await readSessionCache(henchDir))?.parentId).toBe(PARENT);

    const { loadRun } = await import("../../src/store/runs.js");
    expect((await loadRun(henchDir, run.id)).readOnlyRefusal).toEqual(run.readOnlyRefusal);
  });

  it("fails with the standard no-changes reason when the cold retry also changes nothing", async () => {
    await useForkStrategy();
    cli.script(orients, refuses(WORK), refuses(COLD), commitsWork);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(3);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(NO_CHANGES);
    expect(run.readOnlyRefusal).toBeDefined();
    expect(run.spawnBreakdown?.["read-only-retry"]).toBe(1);
  });

  it("keeps completion_rejected for a fork that called an edit tool", async () => {
    await useForkStrategy();
    cli.script(orients, editsWithoutDiff, commitsWork);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(2);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(NO_CHANGES);
    expect(run.readOnlyRefusal).toBeUndefined();
  });

  it("does not re-spawn cold when earlier attempts already committed the task's files", async () => {
    await useForkStrategy();
    const { startHead, sha } = commitEarlierWork();
    const earlier = await seedEarlierRun(startHead, ["earlier.ts"], [sha]);
    cli.script(orients, refuses(WORK), commitsWork);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(2);
    expect(run.status).toBe("failed");
    expect(run.readOnlyRefusal).toBeUndefined();
    expect(run.spawnBreakdown?.["read-only-retry"] ?? 0).toBe(0);
    expect(run.error).toMatch(NO_CHANGES);
    expect(run.error).toContain("already committed by earlier attempts");
    expect(run.error).toContain(earlier.id.slice(0, 8));
    expect(run.error).toContain("gate-only");
    expect(run.error).toContain("ndx rex update task-1 --status=completed");
    expect(run.diagnostics?.notes).toContain(
      "read_only_refusal_suppressed: prior attempts committed 1 task files",
    );
  });

  it("re-spawns cold when an attempt only edited a file that another task then committed", async () => {
    await useForkStrategy();
    const startHead = head();
    commitFile("shared.ts", "feat: another task's change");
    await seedEarlierRun(startHead, ["shared.ts"]);
    cli.script(orients, refuses(WORK), commitsWork);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(3);
    expect(run.status).toBe("completed");
    expect(run.readOnlyRefusal).toBeDefined();
    expect(run.spawnBreakdown?.["read-only-retry"]).toBe(1);
  });

  it("falls back to the cold re-spawn when the earlier run's commit is not in HEAD", async () => {
    await useForkStrategy();
    const { startHead } = commitEarlierWork();
    await seedEarlierRun(startHead, ["earlier.ts"], ["0".repeat(40)]);
    cli.script(orients, refuses(WORK), commitsWork);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(3);
    expect(run.readOnlyRefusal).toBeDefined();
  });

  it("keeps completion_rejected for a cold attempt with no diff", async () => {
    cli.script(refuses(COLD), commitsWork);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(1);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(NO_CHANGES);
    expect(run.readOnlyRefusal).toBeUndefined();
  });
});
