import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, type SpawnOptions } from "node:child_process";
import { join } from "node:path";
import { cleanupProjectDir } from "../helpers/index.js";
import { createScriptedClaudeCli, setupScriptedProject, initLine, resultLine } from "../helpers/scripted-claude-cli.js";
import { loadConfig, saveConfig } from "../../src/store/config.js";

describe("cliLoop credential filtering across orientation and recovery", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-env-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("FAKE_SERVICE_API_KEY", "fixture-secret-value");
    vi.stubEnv("GITHUB_TOKEN", "fixture-github-value");
    vi.stubEnv("TYPESAFE_API_KEY", "fixture-jev-value");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "fixture-oauth-value");
  });

  afterEach(async () => {
    const { setQuiet } = await import("../../src/types/output.js");
    setQuiet(false);
    vi.doUnmock("node:child_process");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  it.each([false, true])("uses one filtered snapshot and logs names once (quiet: %s)", async (quiet) => {
    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, {
      ...config, sessionStrategy: "fork",
      guard: { ...config.guard, env: { allow: ["TYPESAFE_API_KEY"] } },
    });
    execFileSync("git", ["commit", "-am", "fixture policy"], { cwd: projectDir, stdio: "ignore" });
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const cli = createScriptedClaudeCli(actual.spawn);
    const envs: NodeJS.ProcessEnv[] = [];
    vi.doMock("node:child_process", () => ({
      ...actual,
      spawn: (command: string, args: string[], options?: SpawnOptions) => {
        if (options?.env?.CLAUDE_CODE_OAUTH_TOKEN === "fixture-oauth-value") envs.push(options.env);
        return cli.spawn(command, args, options);
      },
    }));
    cli.script(
      () => ({ lines: [initLine("parent"), resultLine("parent", "Oriented.")] }),
      () => ({ lines: [initLine("work"), resultLine("work", "This session's instructions say not to edit anything, so I made no changes.")] }),
      () => {
        writeFileSync(join(projectDir, "feature.ts"), "export const feature = 1;\n");
        execFileSync("git", ["add", "feature.ts"], { cwd: projectDir, stdio: "ignore" });
        execFileSync("git", ["commit", "-m", "fixture work"], { cwd: projectDir, stdio: "ignore" });
        return { lines: [initLine("cold"), resultLine("cold", "Committed.")] };
      },
    );
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    const { setQuiet } = await import("../../src/types/output.js");
    setQuiet(quiet);
    const { run } = await cliLoop({
      config: await loadConfig(henchDir), store: createStore("file", rexDir),
      projectDir, henchDir, taskId: "task-1", autonomous: true, yes: true,
    });
    expect(run.status).toBe("completed");
    expect(cli.invocations).toHaveLength(3);
    expect(envs).toHaveLength(3);
    for (const env of envs) {
      expect(env.FAKE_SERVICE_API_KEY).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.TYPESAFE_API_KEY).toBe("fixture-jev-value");
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("fixture-oauth-value");
    }
    if (!run.logPath) throw new Error("Expected a persisted run log");
    const log = readFileSync(run.logPath, "utf-8");
    const reports = log.split("\n").filter((line) => line.includes("CLI environment: stripped"));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("FAKE_SERVICE_API_KEY");
    expect(reports[0]).toContain("GITHUB_TOKEN");
    expect(reports[0]).not.toContain("TYPESAFE_API_KEY");
    expect(log).not.toContain("fixture-secret-value");
    expect(log).not.toContain("fixture-github-value");
  });
});
