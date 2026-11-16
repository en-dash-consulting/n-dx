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

  async function run(taskId: string, reviewModel?: string) {
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    return cliLoop({ config: await loadConfig(henchDir), store: createStore("file", rexDir),
      projectDir, henchDir, taskId, spawnModel: "gpt-6-astra", autonomous: true, yes: true, reviewOptional: reviewModel === undefined, reviewPass: reviewModel !== undefined, reviewModel });
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
});
