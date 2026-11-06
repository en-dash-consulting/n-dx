/**
 * `hench run --task=<ref>` on a v2 PRD with a dirty planning file commits it
 * before the run, and that commit's `N-DX-Item` is the resolved task id —
 * never the ref as typed (CH-1). Restacks and landing key on the canonical id.
 *
 * pre-run-gate-planning-item-id.test.ts covers the resolver and the gate; this
 * drives the real `cmdRun` with the two agent loops stubbed, so a cmdRun that
 * hands the gate `flags.task` as typed fails here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cp, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { PLANNING_COMMIT_SUBJECT } from "../../src/agent/lifecycle/shared.js";
import type { RunRecord } from "../../src/schema/index.js";
import { cleanupProjectDir, commitGitFixtureBaseline, setupProjectDir } from "../helpers/index.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");
/** The fixture's open task, the unit a ref to CH-1 runs. */
const WIRE_ID = "c0000000-0000-4000-8000-000000000002";

const ranTasks: string[] = [];

/** Stand in for an agent loop: record the task and hand back a minimal run. */
async function stub(opts: Record<string, unknown>): Promise<{ run: RunRecord }> {
  const taskId = opts.taskId as string;
  ranTasks.push(taskId);
  return {
    run: {
      id: `run-${ranTasks.length}`,
      taskId,
      taskTitle: taskId,
      startedAt: new Date().toISOString(),
      status: "failed",
      turns: 1,
      tokenUsage: { input: 0, output: 0 },
      turnTokenUsage: [],
      toolCalls: [],
      model: "",
    } as RunRecord,
  };
}

vi.mock("../../src/agent/lifecycle/cli-loop.js", () => ({ cliLoop: (o: Record<string, unknown>) => stub(o) }));
vi.mock("../../src/agent/lifecycle/loop.js", () => ({ agentLoop: (o: Record<string, unknown>) => stub(o) }));

const { cmdRun } = await import("../../src/cli/commands/run.js");

let projectDir: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: projectDir, encoding: "utf-8" }).trim();
}

beforeEach(async () => {
  ranTasks.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  let rexDir: string;
  ({ projectDir, rexDir } = await setupProjectDir("hench-run-planning-item-"));
  await cp(FIXTURE, rexDir, { recursive: true });
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }), "utf-8");
  // cli_path is machine-local: a shared one applies only once the repository is trusted.
  await writeFile(
    join(projectDir, ".n-dx.local.json"),
    JSON.stringify({ llm: { claude: { cli_path: process.execPath } } }),
    "utf-8",
  );
  await writeFile(join(projectDir, ".gitignore"), ".n-dx.local.json\n", "utf-8");
  commitGitFixtureBaseline(projectDir);
  // A pending planning edit for the pre-run gate to commit.
  await writeFile(join(rexDir, "product", "planning-note.md"), "# Note\n");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProjectDir(projectDir);
});

describe("cmdRun's pre-run planning commit", () => {
  it("writes the resolved task id when --task is a change's display id", async () => {
    await cmdRun(projectDir, { task: "CH-1", auto: "true" });

    expect(git("log", "--format=%s", "--grep", PLANNING_COMMIT_SUBJECT, "-1")).toBe(PLANNING_COMMIT_SUBJECT);
    const planning = git("log", "--grep", PLANNING_COMMIT_SUBJECT, "-1", "--format=%H");
    expect(git("log", "-1", planning, "--format=%(trailers:key=N-DX-Item,valueonly)")).toBe(WIRE_ID);
    expect(ranTasks).toEqual([WIRE_ID]);
  });
});
