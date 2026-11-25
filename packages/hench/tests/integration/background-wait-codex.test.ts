import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { cleanupProjectDir } from "../helpers/index.js";
import {
  createScriptedClaudeCli,
  setupScriptedProject,
  type ScriptedClaudeCli,
} from "../helpers/scripted-claude-cli.js";
import { loadConfig } from "../../src/store/config.js";

/** Shell ampersands are not evidence of unfinished Codex work. */

const THREAD = "01a05958-2931-73f1-9aba-38fa915bb8df";

describe("cliLoop — shell text cannot trigger Codex recovery", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;

  beforeEach(async () => {
    vi.stubEnv("NDX_CLI_PATH", resolve(import.meta.dirname, "../../../core/cli.js"));
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-bg-codex-"));
    writeFileSync(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "codex" } }), "utf-8");
    execFileSync("git", ["add", ".n-dx.json"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "codex vendor"], { cwd: projectDir, stdio: "ignore" });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const scripted = createScriptedClaudeCli(actual.spawn);
    cli = scripted;
    vi.doMock("node:child_process", () => ({ ...actual, spawn: scripted.spawn }));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  it("leaves a Codex session with uncommitted work to the completion gate, as before", async () => {
    cli.script(() => {
      writeFileSync(join(projectDir, "feature.ts"), "export const feature = 1;\n", "utf-8");
      return {
        lines: [
          { type: "thread.started", thread_id: THREAD },
          { type: "item.started", item: { id: "i1", type: "command_execution", command: "pnpm test &" } },
          {
            type: "item.completed",
            item: { id: "i1", type: "command_execution", command: "pnpm test &", aggregated_output: "", exit_code: 0 },
          },
          { type: "item.completed", item: { id: "i2", type: "agent_message", text: "Suite started; I'll check back." } },
          { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
        ],
      };
    });

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    const { run } = await cliLoop({
      config: await loadConfig(henchDir),
      store: createStore("file", rexDir),
      projectDir,
      henchDir,
      taskId: "task-1",
      autonomous: true,
      yes: true,
      reviewOptional: true,
    });

    expect(cli.invocations).toHaveLength(1);
    expect(cli.invocations[0]!.args[0]).toBe("exec");
    expect(run.vendor).toBe("codex");
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/Refusing to mark this task completed/);
    expect(run.backgroundResume).toBeUndefined();
    expect(run.spawnBreakdown?.["background-resume"] ?? 0).toBe(0);
  });
});
