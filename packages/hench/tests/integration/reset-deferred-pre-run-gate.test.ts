/**
 * `--reset-deferred` must be able to start the run it enables (GitHub #365).
 *
 * `ndx work --auto --loop --reset-deferred` on a clean tree reset deferred
 * tasks to pending — which WRITES `.rex/prd_tree/` — and the pre-run commit
 * gate then refused to start because the tree was dirty with the files the
 * reset itself just produced. Exit code was 0, so the refusal read as success.
 *
 * The fix commits the reset's own PRD-tree write immediately
 * ({@link commitResetDeferredChanges}), the same pattern
 * `commitCompletionMetadata` already uses for a task's completion write. This
 * suite drives the real reset + real gate together against a real git
 * repository to prove:
 *  - a clean tree resets and then proceeds, with no manual commit in between
 *  - a genuinely dirty tree (the operator's own uncommitted work) still stops
 *
 * @see packages/hench/src/cli/commands/run.ts — resetDeferredTasks
 * @see packages/hench/src/agent/lifecycle/shared.ts — commitResetDeferredChanges, performPreRunCommitGateIfNeeded
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { resetDeferredTasks } from "../../src/cli/commands/run.js";
import {
  commitResetDeferredChanges,
  performPreRunCommitGateIfNeeded,
} from "../../src/agent/lifecycle/shared.js";
import { PRD_TREE_DIRNAME } from "../../src/prd/rex-gateway.js";
import { initGitFixtureRepo } from "../helpers/index.js";

const execFile = promisify(execFileCb);

describe("--reset-deferred vs the pre-run commit gate", () => {
  let projectDir: string;
  let henchDir: string;
  let taskIndexPath: string;
  const taskId = "task-deferred-1";

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-reset-deferred-"));
    henchDir = join(projectDir, ".hench");
    const rexDir = join(projectDir, ".rex");
    await mkdir(henchDir, { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);

    // A tracked task file already deferred (e.g. by a prior session-limit
    // interruption) — the state --reset-deferred is meant to resume from.
    const taskDir = join(rexDir, PRD_TREE_DIRNAME, "task-slug");
    await mkdir(taskDir, { recursive: true });
    taskIndexPath = join(taskDir, "index.md");
    await writeFile(taskIndexPath, "# Deferred task\nstatus: deferred\n", "utf-8");

    await execFile("git", ["add", "."], { cwd: projectDir });
    await execFile("git", ["commit", "-m", "initial"], { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  /** Mock PRDStore: updateItem writes the same index.md a real store would. */
  function buildStore() {
    return {
      loadDocument: vi.fn(async () => ({
        items: [{ id: taskId, title: "Deferred task", status: "deferred", children: [] }],
      })),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "pending") {
          const current = (await readFile(taskIndexPath, "utf-8")).replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: deferred", "status: pending"), "utf-8");
        }
      }),
    };
  }

  async function gitStatus(): Promise<string> {
    const { stdout } = await execFile("git", ["status", "--porcelain"], { cwd: projectDir });
    return stdout;
  }

  it("resets deferred tasks and commits the write, leaving the tree clean", async () => {
    const store = buildStore();

    const resetCount = await resetDeferredTasks(store as never);
    expect(resetCount).toBe(1);
    expect(await readFile(taskIndexPath, "utf-8")).toContain("status: pending");

    // Before the fix, this is where the reset's own write sat uncommitted.
    expect((await gitStatus()).trim()).not.toBe("");

    await commitResetDeferredChanges(projectDir, resetCount);

    expect((await gitStatus()).trim()).toBe("");
    const { stdout: logMsg } = await execFile("git", ["log", "-1", "--format=%s"], { cwd: projectDir });
    expect(logMsg).toContain("reset-deferred");
  });

  it("reset-then-run: an autonomous run proceeds on an otherwise clean tree", async () => {
    const store = buildStore();
    const resetCount = await resetDeferredTasks(store as never);
    await commitResetDeferredChanges(projectDir, resetCount);

    const result = await performPreRunCommitGateIfNeeded({
      projectDir,
      henchDir,
      autonomous: true,
      deps: { isTTY: false },
    });

    expect(result).toBe("proceed");
  });

  it("reset-then-refuse: a genuinely dirty tree still stops the run", async () => {
    const store = buildStore();
    const resetCount = await resetDeferredTasks(store as never);
    await commitResetDeferredChanges(projectDir, resetCount);

    // The operator's own uncommitted work, unrelated to the reset.
    await writeFile(join(projectDir, "README.md"), "# fixture\n\nwork in progress\n", "utf-8");

    const result = await performPreRunCommitGateIfNeeded({
      projectDir,
      henchDir,
      autonomous: true,
      deps: { isTTY: false },
    });

    expect(result).toBe("stop");
  });

  it("no-op reset (nothing deferred) never touches git", async () => {
    const store = {
      loadDocument: vi.fn(async () => ({ items: [] })),
      updateItem: vi.fn(async () => {}),
    };

    const resetCount = await resetDeferredTasks(store as never);
    expect(resetCount).toBe(0);

    // commitResetDeferredChanges must be a no-op for a zero reset count —
    // there is nothing of this call's own to commit.
    await commitResetDeferredChanges(projectDir, resetCount);

    const { stdout: log } = await execFile("git", ["log", "--oneline"], { cwd: projectDir });
    expect(log.trim().split("\n")).toHaveLength(1); // only the initial commit
  });
});
