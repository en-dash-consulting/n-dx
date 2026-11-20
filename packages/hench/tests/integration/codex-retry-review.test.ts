/** Mocked protocol coverage; installed-CLI observations are documented separately. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeDocument } from "@n-dx/rex";
import { cleanupProjectDir } from "../helpers/index.js";
import { createScriptedClaudeCli, setupScriptedProject, type ScriptedClaudeCli, type ScriptedTurn } from "../helpers/scripted-claude-cli.js";
import { loadConfig, saveConfig } from "../../src/store/config.js";

const result = (id: string) => ({ lines: [
  { type: "thread.started", thread_id: id },
  { type: "item.completed", item: { id: "answer", type: "agent_message", text: "Done." } },
  { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
] });

describe("Codex retry and self-review loop contract", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;
  let identity: string;
  let supported: boolean;
  let reusable: boolean;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-codex-fork-"));
    writeFileSync(join(rexDir, "prd.md"), serializeDocument({ schema: "rex/v1", title: "Fork fixture", items: [
      { id: "task-1", title: "First task", status: "pending", level: "task", priority: "high" },
      { id: "task-2", title: "Second task", status: "pending", level: "task", priority: "high" },
    ] } as never));
    await saveConfig(henchDir, { ...await loadConfig(henchDir), sessionStrategy: "cold", retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 } });
    writeFileSync(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "codex" } }));
    execFileSync("git", ["add", ".n-dx.json", ".hench/config.json", ".rex/prd.md"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "fixture vendor"], { cwd: projectDir, stdio: "ignore" });
    for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    cli = createScriptedClaudeCli(actual.spawn);
    vi.doMock("node:child_process", () => ({ ...actual, spawn: cli.spawn }));
    const { codexSessionDriver } = await import("../../src/prd/llm-gateway.js");
    identity = "account-and-policy-A";
    supported = true;
    reusable = true;
    vi.spyOn(codexSessionDriver, "probeResume").mockImplementation(() => ({
      supported, reusable, version: "fixture-version", identity, reason: "fixture capability",
      orientationFlags: ["--ignore-user-config", "-c", "features.apps=false"],
    }));
  });

  afterEach(async () => {
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  function works(file: string, id: string): ScriptedTurn {
    return () => {
      writeFileSync(join(projectDir, file), "export const done = true;\n");
      execFileSync("git", ["add", file], { cwd: projectDir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "fixture work"], { cwd: projectDir, stdio: "ignore" });
      return result(id);
    };
  }

  async function run(taskId: string, reviewModel?: string, abortSignal?: AbortSignal) {
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    const store = createStore("file", rexDir);
    const outcome = await cliLoop({ config: await loadConfig(henchDir), store,
      projectDir, henchDir, taskId, abortSignal, spawnModel: "gpt-6-astra", autonomous: true, yes: true, reviewOptional: reviewModel === undefined, reviewPass: reviewModel !== undefined, reviewModel });
    return { ...outcome, log: await store.readLog() };
  }

  const failed = (id?: string) => ({ code: 1, lines: [
    ...(id ? [{ type: "thread.started", thread_id: id }] : []),
    { type: "error", message: "ECONNRESET" },
  ] });

  it("retries the work thread with policy, model and credential hiding reapplied", async () => {
    cli.script(() => failed("work"), works("done.ts", "work"));
    const outcome = await run("task-1");
    expect(outcome.run.status, outcome.run.error).toBe("completed");
    expect(cli.invocations).toHaveLength(2);
    const retry = cli.invocations[1];
    expect(retry.args.slice(0, 3)).toEqual(["exec", "resume", "work"]);
    expect(retry.args).toEqual(expect.arrayContaining(['sandbox_mode="workspace-write"', 'approval_policy="never"', "gpt-6-astra"]));
    expect(retry.args.join(" ")).toContain("shell_environment_policy");
    expect(retry.stdin).not.toContain("RETRY NOTICE");
  });

  it("does not recursively resume or cold-replay a failed continuation", async () => {
    cli.script(() => failed("work"), () => failed("work"));
    const outcome = await run("task-1");
    expect(outcome.run.status).toBe("error_transient");
    expect(cli.invocations).toHaveLength(2);
    expect(cli.invocations[1].args.slice(0, 3)).toEqual(["exec", "resume", "work"]);
    expect(outcome.run.retryAttempts).toBe(1);
    expect(outcome.run.error).toContain("Codex retry continuation failed during attempt 2/3");
    expect(outcome.run.error).toContain("ECONNRESET");
    const failures = outcome.log.filter(entry => entry.event === "codex_continuation_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0].detail).toBe(outcome.run.error);
    expect(outcome.log.filter(entry => entry.event === "transient_error")).toHaveLength(1);
    expect(outcome.log.some(entry => entry.event === "task_transient_exhausted")).toBe(false);
    expect((await loadConfig(henchDir)).retry?.maxRetries).toBe(2);
  });

  it("still exhausts all configured attempts when cold retries have no reusable session", async () => {
    cli.script(() => failed(), () => failed(), () => failed());
    const outcome = await run("task-1");
    expect(cli.invocations).toHaveLength(3);
    expect(outcome.run.status).toBe("error_transient");
    expect(outcome.run.retryAttempts).toBe(2);
    expect(outcome.log.filter(entry => entry.event === "task_transient_exhausted"))
      .toEqual([expect.objectContaining({ detail: expect.stringContaining("All 3 attempts failed") })]);
    expect(outcome.log.some(entry => entry.event === "codex_continuation_failed")).toBe(false);
  });

  it("resumes the failed fork child, preserving its work and accounting", async () => {
    await saveConfig(henchDir, { ...await loadConfig(henchDir), sessionStrategy: "fork" });
    execFileSync("git", ["add", ".hench/config.json"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "fixture fork strategy"], { cwd: projectDir, stdio: "ignore" });
    const { codexSessionDriver } = await import("../../src/prd/llm-gateway.js");
    vi.spyOn(codexSessionDriver, "probeFork").mockImplementation(() => ({
      supported: true, reusable: true, identity, reason: "fixture", version: "fixture-version", orientationFlags: [],
    }));
    cli.script(() => result("parent"), () => {
      works("prior.ts", "child")({ args: [], stdin: "" });
      return { code: 1, lines: [...result("child").lines, ...failed().lines] };
    }, works("followup.ts", "child"));
    const outcome = await run("task-1");
    expect(cli.invocations.map(call => call.args.slice(0, 3))).toEqual([
      expect.any(Array), ["exec", "fork", "parent"], ["exec", "resume", "child"],
    ]);
    expect(outcome.run.tokenUsage.input).toBeGreaterThanOrEqual(20);
    expect(outcome.run.retryAttempts).toBe(1);
  });

  it("never accepts a successful retry on a different thread", async () => {
    cli.script(() => failed("work"), works("done.ts", "wrong-thread"));
    const outcome = await run("task-1");
    expect(outcome.run.status).toBe("failed");
    expect(outcome.run.error).toContain("did not confirm");
    expect(cli.invocations).toHaveLength(2);
  });

  it("keeps a failed resumed review gated without another spawn", async () => {
    cli.script(works("done.ts", "work"), () => failed("work"));
    const outcome = await run("task-1", "gpt-6-astra");
    expect(cli.invocations).toHaveLength(2);
    expect(cli.invocations[1].args.slice(0, 3)).toEqual(["exec", "resume", "work"]);
    expect(outcome.run.review?.failed).toBe("spawn-failed");
    expect(outcome.run.review?.gated).toBe(true);
  });

  it.each(["unsupported", "identity", "branch", "missing-id"])("uses a cold retry with prior-attempt notice for %s", async (change) => {
    cli.script(() => {
      if (change === "unsupported") supported = false;
      if (change === "identity") identity = "changed";
      if (change === "branch") execFileSync("git", ["checkout", "-b", "moved"], { cwd: projectDir, stdio: "ignore" });
      return failed(change === "missing-id" ? undefined : "work");
    }, works("done.ts", "fresh"));
    await run("task-1");
    expect(cli.invocations).toHaveLength(2);
    expect(cli.invocations[1].args).not.toContain("resume");
    expect(cli.invocations[1].stdin).toContain("RETRY NOTICE");
  });

  it.each([true, false])("self-review respects model identity (same model: %s)", async (sameModel) => {
    cli.script(works("done.ts", "work"), (call) => {
      const path = call.stdin.match(/(\S+[\\/]\.hench[\\/]reviews[\\/][\w-]+\.json)/)?.[1];
      if (!path) throw new Error("missing review report path");
      writeFileSync(path, JSON.stringify({ findings: [] }));
      return result(sameModel ? "work" : "review");
    });
    const outcome = await run("task-1", sameModel ? "gpt-6-astra" : "different-review-model");
    expect(cli.invocations, outcome.run.error).toHaveLength(2);
    expect(cli.invocations[1].args.includes("resume")).toBe(sameModel);
    expect(outcome.run.review?.resumedSession).toBe(sameModel);
  });

  const unfinished = (id = "work") => ({ lines: [
    { type: "thread.started", thread_id: id },
    { type: "turn.started" },
    { type: "item.started", item: { id: "check", type: "command_execution", command: "node check.js", status: "in_progress" } },
  ] });

  function leavesWork(): ReturnType<ScriptedTurn> {
    writeFileSync(join(projectDir, "done.ts"), "export const done = true;\n");
    return unfinished();
  }

  it("describes a truncated open turn as unfinished in output and the PRD log", async () => {
    cli.script(() => ({ lines: leavesWork().lines.slice(0, 2) }), works("done.ts", "work"));
    const outcome = await run("task-1");
    expect(outcome.run.status, outcome.run.error).toBe("completed");
    expect(cli.invocations).toHaveLength(2);
    expect(outcome.run.backgroundResume?.tool).toBe("turn.started");
    const output = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(output).toContain("Resuming the unfinished session");
    expect(output).not.toContain("background command");
    const resumed = outcome.log.filter(entry => entry.event === "background_wait_resumed");
    expect(resumed).toHaveLength(1);
    expect(resumed[0].detail).toContain("ended unfinished");
    expect(resumed[0].detail).toContain("turn.started");
    expect(resumed[0].detail).not.toContain("ended waiting");
  });

  it("records repeated truncated turns without claiming a background command", async () => {
    const truncated = () => ({ lines: leavesWork().lines.slice(0, 2) });
    cli.script(truncated, truncated);
    const outcome = await run("task-1");
    expect(cli.invocations).toHaveLength(2);
    expect(outcome.run.status).toBe("failed");
    expect(outcome.run.error).toContain("unfinished again after being resumed");
    expect(outcome.run.error).toContain("turn.started");
    expect(outcome.run.error).not.toContain("background command");
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).not.toContain("background command");
    const failures = outcome.log.filter(entry => entry.event === "background_wait");
    expect(failures).toHaveLength(1);
    expect(failures[0].detail).toBe(outcome.run.error);
    expect(outcome.log.filter(entry => entry.event === "background_wait_resumed")).toHaveLength(1);
    expect(outcome.log.map(entry => entry.detail).join("\n")).not.toMatch(/background command|ended waiting/);
  });

  it("continues unfinished structured work once without replaying the brief", async () => {
    cli.script(leavesWork, works("done.ts", "work"));
    const outcome = await run("task-1");
    expect(outcome.run.status, outcome.run.error).toBe("completed");
    expect(cli.invocations).toHaveLength(2);
    expect(cli.invocations[1].args.slice(0, 3)).toEqual(["exec", "resume", "work"]);
    expect(cli.invocations[1].stdin).toContain("do not repeat completed commands, task mutations or commits");
    expect(cli.invocations[1].stdin).not.toContain("## Current task");
    expect(outcome.run.spawnBreakdown?.["background-resume"]).toBe(1);
  });

  it("does not resume already committed work despite an unfinished stream", async () => {
    cli.script(() => { works("done.ts", "work")({ args: [], stdin: "" }); return unfinished(); });
    const outcome = await run("task-1");
    expect(outcome.run.status, outcome.run.error).toBe("completed");
    expect(cli.invocations).toHaveLength(1);
  });

  it.each(["wait", "error", "wrong-thread"])("fails a %s continuation without replay or another retry", async (kind) => {
    cli.script(leavesWork, () => kind === "wait" ? unfinished() : kind === "error" ? failed("work") : result("wrong"));
    const outcome = await run("task-1");
    expect(outcome.run.status).not.toBe("completed");
    expect(cli.invocations).toHaveLength(2);
    if (kind === "wait") expect(outcome.run.error).toContain("again after being resumed");
    if (kind === "wrong-thread") expect(outcome.run.error).toContain("did not confirm");
    if (kind === "error") {
      expect(outcome.run.retryAttempts).toBeUndefined();
      expect(outcome.run.error).toContain("Codex unfinished-work continuation failed during attempt 1/3");
      expect(outcome.run.error).toContain("ECONNRESET");
      expect(outcome.log.filter(entry => entry.event === "codex_continuation_failed"))
        .toEqual([expect.objectContaining({ detail: outcome.run.error })]);
      expect(outcome.log.some(entry => entry.event === "task_transient_exhausted")).toBe(false);
    }
  });

  it.each(["retry", "unfinished-work"])("preserves cancellation of a %s continuation", async (kind) => {
    const controller = new AbortController();
    cli.script(kind === "retry" ? () => failed("work") : leavesWork, () => {
      setTimeout(() => controller.abort(new Error("Interrupted by SIGINT")), 10);
      return { lines: [{ type: "thread.started", thread_id: "work" }], hang: true };
    });
    const outcome = await run("task-1", undefined, controller.signal);
    expect(cli.invocations).toHaveLength(2);
    expect(outcome.run.status).toBe("cancelled");
    expect(outcome.run.error).toBe("Interrupted by SIGINT");
    expect(outcome.log.some(entry => entry.event === "codex_continuation_failed")).toBe(false);
    expect(outcome.log.filter(entry => entry.event === "task_cancelled")).toHaveLength(1);
  });

  it.each(["retry", "unfinished-work"])("preserves the timeout of a %s continuation", async (kind) => {
    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, { ...config, guard: { ...config.guard, sessionTimeout: 150 } });
    execFileSync("git", ["add", ".hench/config.json"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "fixture session bound"], { cwd: projectDir, stdio: "ignore" });
    cli.script(kind === "retry" ? () => failed("work") : leavesWork,
      () => ({ lines: [{ type: "thread.started", thread_id: "work" }], hang: true }));
    const outcome = await run("task-1");
    expect(cli.invocations).toHaveLength(2);
    expect(outcome.run.status).toBe("timeout");
    expect(outcome.run.error).toContain("guard.sessionTimeout");
    expect(outcome.log.some(entry => entry.event === "codex_continuation_failed")).toBe(false);
    expect(outcome.log.filter(entry => entry.event === "task_timeout")).toHaveLength(1);
  });

  it.each(["unsupported", "identity", "branch", "missing-id"])("does not continue unfinished work with %s", async (change) => {
    cli.script(() => {
      const turn = leavesWork();
      if (change === "unsupported") supported = false;
      if (change === "identity") identity = "changed";
      if (change === "branch") execFileSync("git", ["checkout", "-b", "moved"], { cwd: projectDir, stdio: "ignore" });
      if (change === "missing-id") turn.lines.shift();
      return turn;
    });
    const outcome = await run("task-1");
    expect(outcome.run.status).not.toBe("completed");
    expect(cli.invocations).toHaveLength(1);
  });

  it("keeps the test gate after a successful unfinished-work continuation", async () => {
    await saveConfig(henchDir, { ...await loadConfig(henchDir), fullTestCommand: 'node -e "process.exit(1)"' });
    execFileSync("git", ["add", ".hench/config.json"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "fixture failing gate"], { cwd: projectDir, stdio: "ignore" });
    cli.script(leavesWork, works("done.ts", "work"));
    const outcome = await run("task-1");
    expect(outcome.run.status).not.toBe("completed");
    expect(outcome.run.testGate?.passed).toBe(false);
    expect(cli.invocations).toHaveLength(2);
  });

  it("does not classify an interrupted turn as unfinished successful work", async () => {
    cli.script(() => ({ code: 130, lines: [...leavesWork().lines,
      { type: "turn.failed", error: { message: "Interrupted by user" } },
    ] }));
    const outcome = await run("task-1");
    expect(outcome.run.status).not.toBe("completed");
    expect(outcome.run.backgroundResume).toBeUndefined();
    expect(cli.invocations).toHaveLength(1);
  });

  it("cancellation never starts an unfinished-work continuation", async () => {
    const controller = new AbortController();
    cli.script(() => {
      const turn = leavesWork();
      setTimeout(() => controller.abort(), 10);
      return { ...turn, hang: true };
    });
    const outcome = await run("task-1", undefined, controller.signal);
    expect(outcome.run.status).not.toBe("completed");
    expect(cli.invocations).toHaveLength(1);
  });

  const writesReport: ScriptedTurn = (call) => {
    const path = call.stdin.match(/(\S+[\\/]\.hench[\\/]reviews[\\/][\w-]+\.json)/)?.[1];
    if (!path) throw new Error("missing review report path");
    writeFileSync(path, JSON.stringify({ findings: [] }));
    return result("review");
  };

  it("continues the fresh reviewer, never the executor, when its report is missing", async () => {
    cli.script(works("done.ts", "work"), () => result("review"), writesReport);
    const outcome = await run("task-1", "different-model");
    expect(outcome.run.status, outcome.run.error).toBe("completed");
    expect(cli.invocations).toHaveLength(3);
    expect(cli.invocations[2].args.slice(0, 3)).toEqual(["exec", "resume", "review"]);
    expect(cli.invocations[2].stdin).toContain("Write the JSON report now");
    expect(outcome.run.review?.backgroundResumed).toBe(true);
  });

  it.each(["no-report", "wrong-thread", "error", "identity", "cancel"])("keeps %s review recovery gated", async (kind) => {
    const controller = new AbortController();
    cli.script(works("done.ts", "work"), () => {
      if (kind === "identity") identity = "changed";
      if (kind === "cancel") {
        setTimeout(() => controller.abort(), 10);
        return { ...result("review"), hang: true };
      }
      return result("review");
    }, (call) => {
      if (kind === "error") return failed("review");
      if (kind === "wrong-thread") { writesReport(call); return result("wrong"); }
      return result("review");
    });
    const outcome = await run("task-1", "different-model", controller.signal);
    expect(outcome.run.review?.failed).toBeDefined();
    expect(outcome.run.review?.gated).toBe(true);
    expect(outcome.run.status).not.toBe("completed");
    expect(cli.invocations).toHaveLength(kind === "identity" || kind === "cancel" ? 2 : 3);
  });

});
