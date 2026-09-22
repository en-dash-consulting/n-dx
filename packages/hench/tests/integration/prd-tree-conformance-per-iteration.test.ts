/**
 * The PRD tree gate has to be re-asked before every task, not once per run.
 *
 * The pre-flight check in `cmdRun` answers the question before the first task.
 * A `--loop` or `--iterations` invocation then outlives that answer: another
 * worktree writes the tree, an operator pulls, a migration lands — and from the
 * second task onward the run is working against a tree nobody asked about
 * again. Its own completion write re-slugs whatever drifted, which is the
 * 2026-09-17 incident with the agent as the sweeper.
 *
 * What is pinned here:
 *  - a tree made non-conformant *between* iterations stops the next iteration,
 *    naming `rex migrate-slugs`
 *  - the refusal lands before the claim and before the agent loop is entered,
 *    so the second task is never started rather than started and abandoned
 *  - both multi-task modes are covered. `--iterations` and `--loop` are
 *    separate functions with separate `runOne` call sites, and a fix that
 *    covered one would pass a test written against the other
 *  - the first task is not double-gated: the per-task gate consumes the
 *    pre-flight check, so a single-task run parses the tree once as before
 *
 * The agent loop is mocked. Nothing here needs a real LLM — what is under test
 * is which gate runs between two tasks, not what a task does.
 *
 * @see packages/hench/src/cli/commands/run.ts — createPerTaskTreeGate, runOne
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import { readdir, rename, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

vi.mock("../../src/agent/lifecycle/loop.js", () => ({ agentLoop: vi.fn() }));
// The quota line is emitted at every inter-task boundary and shells out to the
// vendor CLI. Irrelevant here, and slow enough to matter twice per test.
vi.mock("../../src/quota/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/quota/index.js")>()),
  checkQuotaRemaining: vi.fn(async () => []),
}));

import { agentLoop } from "../../src/agent/lifecycle/loop.js";
import { cmdRun, createPerTaskTreeGate } from "../../src/cli/commands/run.js";
import { resolveStore, PRD_TREE_DIRNAME, TREE_META_FILENAME } from "../../src/prd/rex-gateway.js";
import { TaskClaims } from "../../src/process/task-claims.js";
import { loadConfig, saveConfig } from "../../src/store/config.js";
import { setupProjectDir, cleanupProjectDir, commitGitFixtureBaseline } from "../helpers/index.js";

/** Two tasks, so a second iteration has something left to select. */
const DOC = {
  schema: "rex/v1",
  title: "Per Iteration Gate",
  items: [
    {
      id: "epic-abc123",
      title: "Child Process Cleanup And Exit Hygiene",
      level: "epic" as const,
      status: "pending" as const,
      children: [
        {
          id: "task-def456",
          title: "Harden the runner",
          level: "task" as const,
          status: "pending" as const,
        },
        {
          id: "task-ghi789",
          title: "Drain the queue on exit",
          level: "task" as const,
          status: "pending" as const,
        },
      ],
    },
  ],
};

let projectDir: string;
let henchDir: string;
let rexDir: string;
let treeRoot: string;

const mockedAgentLoop = agentLoop as unknown as Mock;

/** Every file in the tree with its content, for proving a refusal wrote nothing. */
async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(current: string, rel: string): Promise<void> {
    for (const entry of await readdir(current)) {
      const abs = join(current, entry);
      const key = rel ? `${rel}/${entry}` : entry;
      if ((await stat(abs)).isDirectory()) await walk(abs, key);
      else out.set(key, await readFile(abs, "utf-8"));
    }
  }
  await walk(dir, "");
  return out;
}

/**
 * What another worktree's mismatched build leaves behind: the epic directory
 * renamed into the superseded id-qualified form.
 */
async function reSuffixEpicDir(): Promise<string> {
  const entries = (await readdir(treeRoot)).filter((e) => e !== TREE_META_FILENAME);
  const current = entries[0];
  const foreign = "child-process-cleanup-and-exit-epicab";
  await rename(join(treeRoot, current), join(treeRoot, foreign));
  return foreign;
}

/** A run record shaped for the summary block `runOne` prints after the loop. */
function completedRun(id: string, taskId: string) {
  return {
    run: {
      id,
      taskId,
      taskTitle: "Harden the runner",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      turns: 1,
      tokenUsage: { input: 10, output: 5 },
      toolCalls: [],
      commits: [],
      uncommittedPaths: [],
      model: "test-model",
    },
  };
}

beforeEach(async () => {
  ({ projectDir, henchDir, rexDir } = await setupProjectDir("hench-per-iteration-gate-"));
  treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  await (await resolveStore(rexDir)).saveDocument(DOC as never);

  // The API provider keeps cmdRun off the vendor-CLI preflight, which would
  // otherwise require a `claude` binary on the machine running the suite.
  // `loopPauseMs: 0` because the inter-task pause is real wall-clock time and
  // this suite drives two tasks per test; `--loop-pause 0` is rejected as a flag.
  const config = await loadConfig(henchDir);
  await saveConfig(henchDir, { ...config, provider: "api", loopPauseMs: 0 });

  // A clean baseline: the autonomous pre-run commit gate refuses to start
  // against an uncommitted working tree, and the between-task guard would stop
  // the loop before it reached the second iteration.
  commitGitFixtureBaseline(projectDir);

  mockedAgentLoop.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProjectDir(projectDir);
});

describe("the PRD tree gate between tasks", () => {
  /**
   * Complete the first task, re-slugging the tree on the way out as a
   * concurrent writer would, then record what the second task sees.
   */
  function tamperAfterFirstTask(): void {
    mockedAgentLoop.mockImplementation(async () => {
      if (mockedAgentLoop.mock.calls.length === 1) await reSuffixEpicDir();
      return completedRun(`run-${mockedAgentLoop.mock.calls.length}`, "task-def456");
    });
  }

  it("refuses the next --iterations task, naming rex migrate-slugs", async () => {
    tamperAfterFirstTask();

    await expect(
      cmdRun(projectDir, { auto: "true", iterations: "2" }),
    ).rejects.toThrow(/rex migrate-slugs/);

    // One task ran. The second was refused rather than started: had the gate
    // been skipped, the agent loop would have been entered twice.
    expect(mockedAgentLoop).toHaveBeenCalledTimes(1);
  });

  it("refuses the next --loop task, naming rex migrate-slugs", async () => {
    // --loop and --iterations are separate functions with separate runOne call
    // sites; covering only one is how a gate fix passes while a mode stays open.
    tamperAfterFirstTask();

    await expect(
      cmdRun(projectDir, { loop: "true" }),
    ).rejects.toThrow(/rex migrate-slugs/);

    expect(mockedAgentLoop).toHaveBeenCalledTimes(1);
  });

  it("refuses before claiming the second task, and rewrites nothing", async () => {
    const claimSpy = vi.spyOn(TaskClaims, "forProject");
    tamperAfterFirstTask();

    await expect(
      cmdRun(projectDir, { auto: "true", iterations: "2" }),
    ).rejects.toThrow(/rex migrate-slugs/);

    // The claim is taken inside runOne, after the gate. One claim means the
    // second task was stopped ahead of it rather than claimed and released.
    expect(claimSpy).toHaveBeenCalledTimes(1);
  });

  it("leaves the drifted tree exactly as it found it", async () => {
    tamperAfterFirstTask();
    let afterTamper: Map<string, string> | undefined;
    mockedAgentLoop.mockImplementation(async () => {
      if (mockedAgentLoop.mock.calls.length === 1) {
        await reSuffixEpicDir();
        afterTamper = await snapshotTree(treeRoot);
      }
      return completedRun("run-1", "task-def456");
    });

    await expect(
      cmdRun(projectDir, { auto: "true", iterations: "2" }),
    ).rejects.toThrow(/rex migrate-slugs/);

    // Refusing is all it does — the run must not be the thing that re-slugs.
    expect(await snapshotTree(treeRoot)).toEqual(afterTamper);
  });

  // WM2092: an absent marker on a non-empty tree is itself a refusal, so drift
  // need not move a path to be caught.
  it("refuses when the marker disappears between tasks, with every path conformant", async () => {
    mockedAgentLoop.mockImplementation(async () => {
      if (mockedAgentLoop.mock.calls.length === 1) {
        const metaPath = join(rexDir, TREE_META_FILENAME);
        const meta = JSON.parse(await readFile(metaPath, "utf-8"));
        delete meta.slugRule;
        await writeFile(metaPath, JSON.stringify(meta), "utf-8");
      }
      return completedRun("run-1", "task-def456");
    });

    await expect(
      cmdRun(projectDir, { auto: "true", iterations: "2" }),
    ).rejects.toThrow(/slug rule marker missing; run rex migrate-slugs/);

    expect(mockedAgentLoop).toHaveBeenCalledTimes(1);
  });
});

describe("createPerTaskTreeGate", () => {
  // This is what keeps a single-task run paying for one tree parse rather than
  // two: cmdRun's pre-flight check already covered the first task, so the gate
  // stands down exactly once and checks every time after that.
  it("consumes the pre-flight check once, then checks every task", async () => {
    await reSuffixEpicDir();
    const gate = createPerTaskTreeGate(rexDir, true);

    await expect(gate()).resolves.toBeUndefined();
    await expect(gate()).rejects.toThrow(/rex migrate-slugs/);
    await expect(gate()).rejects.toThrow(/rex migrate-slugs/);
  });

  it("checks from the first call when no pre-flight check was run", async () => {
    await reSuffixEpicDir();

    await expect(createPerTaskTreeGate(rexDir)()).rejects.toThrow(/rex migrate-slugs/);
  });

  it("passes a conformant tree every time", async () => {
    const gate = createPerTaskTreeGate(rexDir, true);

    await expect(gate()).resolves.toBeUndefined();
    await expect(gate()).resolves.toBeUndefined();
  });
});
