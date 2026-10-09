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
  type ScriptedClaudeCli,
  type ScriptedTurn,
} from "../helpers/scripted-claude-cli.js";
import { loadConfig } from "../../src/store/config.js";
import { listRuns } from "../../src/store/runs.js";

/**
 * The autoCommit path end to end: the agent commits its own work, so the
 * spawned brief must hand it the run's trailer lines, and a commit that still
 * lacks them must land on the run record. Covers the cliLoop wiring that the
 * helper-level tests in agent-commit-item-trailer.test.ts cannot see.
 */

const SESSION = "sess-trailer-0001";

describe("cliLoop — agent commit N-DX-Item", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-item-trailer-loop-"));
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

  /** The agent commits its work with only its own co-author trailer. */
  const commitsWithoutItem: ScriptedTurn = () => {
    writeFileSync(join(projectDir, "feature.ts"), "export const feature = 1;\n", "utf-8");
    execFileSync("git", ["add", "feature.ts"], { cwd: projectDir, stdio: "ignore" });
    execFileSync(
      "git",
      ["commit", "-m", "feat: the feature\n\nCo-Authored-By: Claude <noreply@anthropic.com>"],
      { cwd: projectDir, stdio: "ignore" },
    );
    return {
      lines: [
        initLine(SESSION),
        toolUseLine(SESSION, "Write", { file_path: "feature.ts", content: "..." }),
        resultLine(SESSION, "Committed the feature."),
      ],
    };
  };

  it("sends the run's trailer lines in the brief and records the agent commit that lacks them", async () => {
    cli.script(commitsWithoutItem);
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
      runHistory: await listRuns(henchDir),
    });

    const work = cli.invocations.at(-1)!;
    const { systemPrompt, taskPrompt } = decodeClaudeDelivery(work.args, work.stdin);
    expect(taskPrompt).toContain("## Commit Trailers");
    expect(taskPrompt).toContain("N-DX-Item: task-1");
    expect(taskPrompt).toContain(`· run ${run.id}\nN-DX-Item: task-1`);
    expect(systemPrompt).not.toContain("task-1");

    const workCommit = run.commits?.find((c) => c.subject === "feat: the feature");
    expect(workCommit).toBeDefined();
    expect(run.commitsMissingItem).toEqual([{ ...workCommit, items: [] }]);
  });
});
