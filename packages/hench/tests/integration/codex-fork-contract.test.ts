/** Mocked protocol coverage; installed-CLI observations are documented separately. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serializeDocument } from "@n-dx/rex";
import { cleanupProjectDir } from "../helpers/index.js";
import { createScriptedClaudeCli, setupScriptedProject, type ScriptedClaudeCli, type ScriptedTurn } from "../helpers/scripted-claude-cli.js";
import { loadConfig, saveConfig } from "../../src/store/config.js";
import { ensureRunLogsIgnored } from "../../src/store/run-log.js";

const result = (id: string) => ({ lines: [
  { type: "thread.started", thread_id: id },
  { type: "item.completed", item: { id: "answer", type: "agent_message", text: "Done." } },
  { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
] });

describe("Codex warm-parent loop contract", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;
  let identity: string;
  let supported: boolean;
  let reusable: boolean;

  beforeEach(async () => {
    vi.stubEnv("NDX_CLI_PATH", resolve(import.meta.dirname, "../../../core/cli.js"));
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-codex-fork-"));
    writeFileSync(join(rexDir, "prd.md"), serializeDocument({ schema: "rex/v1", title: "Fork fixture", items: [
      { id: "task-1", title: "First task", status: "pending", level: "task", priority: "high" },
      { id: "task-2", title: "Second task", status: "pending", level: "task", priority: "high" },
    ] } as never));
    await saveConfig(henchDir, { ...await loadConfig(henchDir), sessionStrategy: "fork" });
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
    vi.spyOn(codexSessionDriver, "probeFork").mockImplementation(() => ({
      supported, reusable, version: "fixture-version", identity, reason: "fixture capability",
      orientationFlags: ["--ignore-user-config", "-c", "features.apps=false"],
    }));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
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

  async function run(taskId: string) {
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    return cliLoop({ config: await loadConfig(henchDir), store: createStore("file", rexDir),
      projectDir, henchDir, taskId, spawnModel: "gpt-6-astra", autonomous: true, yes: true, reviewOptional: true });
  }

  it("orients once and forks each task without ever resuming the shared parent", async () => {
    cli.script(() => result("parent"), works("one.ts", "child-one"), works("two.ts", "child-two"));
    const first = await run("task-1");
    const second = await run("task-2");
    expect(first.run.diagnostics?.notes).toContainEqual(expect.stringContaining("does not enforce hench.guard.allowedCommands"));
    expect(second.run.diagnostics?.notes).toContainEqual(expect.stringContaining("does not enforce hench.guard.allowedCommands"));
    expect(first.run.parentSessionId).toBe("parent");
    expect(second.run.parentSessionId).toBe("parent");
    expect(second.run.session?.outcome).toBe("hit");
    expect(cli.invocations).toHaveLength(3);
    expect(cli.invocations[0].args).toEqual(expect.arrayContaining(["--sandbox", "read-only", "mcp_servers.rex.enabled=false", "mcp_servers.sourcevision.enabled=false"]));
    expect(cli.invocations[0].args).toContain("--ignore-user-config");
    for (const call of cli.invocations.slice(1)) {
      expect(call.args.slice(0, 3)).toEqual(["exec", "fork", "parent"]);
      expect(call.args).toEqual(expect.arrayContaining(['sandbox_mode="workspace-write"', 'approval_policy="never"', "gpt-6-astra"]));
      expect(call.stdin).toContain("Orientation is over");
    }
  });

  it("drops the parent when identity changes during orientation", async () => {
    cli.script(() => { identity = "account-B"; return result("parent"); }, works("cold.ts", "cold-child"));
    const outcome = await run("task-1");
    expect(outcome.run.parentSessionId).toBeUndefined();
    expect(outcome.run.session?.reason).toBe("identity-changed");
    expect(cli.invocations).toHaveLength(2);
    expect(cli.invocations[1].args).not.toContain("fork");
    expect(cli.invocations[1].args).not.toContain("parent");
  });

  it("refuses a fork when its required binding disappears after orientation", async () => {
    cli.script(() => {
      const dir = join(henchDir, "mcp");
      for (const name of readdirSync(dir)) rmSync(join(dir, name));
      return result("parent");
    });
    const outcome = await run("task-1");
    expect(cli.invocations).toHaveLength(1);
    expect(outcome.run.error).toContain("Codex MCP binding refused");
  });

  it("reorients Codex when the sanitized child environment changes", async () => {
    await ensureRunLogsIgnored(projectDir);
    execFileSync("git", ["add", ".gitignore"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-am", "fixture run logs"], { cwd: projectDir, stdio: "ignore" });
    vi.stubEnv("NDX_FORK_FIXTURE", "before");
    cli.script(() => result("parent-one"), works("one.ts", "child-one"),
      () => result("parent-two"), works("two.ts", "child-two"));
    const first = await run("task-1");
    vi.stubEnv("NDX_FORK_FIXTURE", "after");
    const second = await run("task-2");

    expect(first.run.error).toBeUndefined();
    expect(second.run.error).toBeUndefined();
    expect(second.run.session).toMatchObject({ strategy: "fork", outcome: "miss", reason: "identity-changed" });
    expect(second.run.parentSessionId).toBe("parent-two");
    expect(cli.invocations).toHaveLength(4);
    expect(cli.invocations[3].args.slice(0, 3)).toEqual(["exec", "fork", "parent-two"]);
  });

  it("uses cold sessions when the supported binary has an opaque account identity", async () => {
    reusable = false;
    cli.script(works("cold.ts", "cold-child"));
    const outcome = await run("task-1");
    expect(outcome.run.session?.reason).toBe("identity-unavailable");
    expect(cli.invocations).toHaveLength(1);
    expect(cli.invocations[0].args).not.toContain("fork");
  });

  it("falls back cold without orienting when the selected binary is unsupported", async () => {
    supported = false;
    cli.script(works("cold.ts", "cold-child"));
    const outcome = await run("task-1");
    expect(outcome.run.session?.reason).toBe("fork-unsupported");
    expect(cli.invocations).toHaveLength(1);
    expect(cli.invocations[0].args).not.toContain("fork");
  });
});
