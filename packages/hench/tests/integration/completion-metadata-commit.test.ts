import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";
import { PRD_TREE_DIRNAME } from "../../src/prd/rex-gateway.js";
import { initGitFixtureRepo } from "../helpers/index.js";

const execAsync = promisify(execCb);

function buildCompletedRun(taskId: string): RunRecord {
  return {
    id: randomUUID(),
    taskId,
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    status: "completed",
    turns: 3,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
  };
}

/**
 * Returns lines from `git status --porcelain` that reference the .rex/ tree.
 */
async function getRexDirtyLines(projectDir: string): Promise<string[]> {
  const { stdout } = await execAsync("git status --porcelain", { cwd: projectDir });
  return stdout
    .split("\n")
    .filter(Boolean)
    .filter((line) => line.replace(/\r/g, "").includes(".rex"));
}

describe("commitCompletionMetadata — autoCommit path (Bug A)", () => {
  let projectDir: string;
  let henchDir: string;
  let taskIndexPath: string;
  const taskId = "task-abc-123";

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-completion-commit-"));
    henchDir = join(projectDir, ".hench");
    const rexDir = join(projectDir, ".rex");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);

    // Create a tracked task file in prd_tree
    const taskSlug = "task-slug-abc";
    const taskDir = join(rexDir, PRD_TREE_DIRNAME, taskSlug);
    await mkdir(taskDir, { recursive: true });
    taskIndexPath = join(taskDir, "index.md");
    await writeFile(taskIndexPath, "# Test task\nstatus: in_progress\n", "utf-8");

    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("commits .rex/prd_tree metadata on autoCommit path, leaving working tree clean", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // Mock store: updateItem writes file to disk (simulates real store behaviour)
    const mockStore = {
      getItem: vi.fn(async (id: string) => {
        if (id !== taskId) return null;
        return { id: taskId, status: "in_progress", title: "Test task", level: "task" };
      }),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    const run = buildCompletedRun(taskId);

    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store: mockStore,
    });

    // .rex/prd_tree changes must be committed — no dirty entries
    const dirty = await getRexDirtyLines(projectDir);
    expect(dirty).toHaveLength(0);

    // The completion metadata commit should exist and contain the task id
    const { stdout: logMsg } = await execAsync("git log -1 --format='%s'", { cwd: projectDir });
    expect(logMsg.trim()).toContain(taskId);
  });

  it("commits with Co-Authored-By trailer on the autoCommit path", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const mockStore = {
      getItem: vi.fn(async (id: string) => {
        if (id !== taskId) return null;
        return { id: taskId, status: "in_progress", title: "Test task", level: "task" };
      }),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    const run = buildCompletedRun(taskId);

    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store: mockStore,
    });

    const { stdout: fullMsg } = await execAsync("git log -1 --format='%B'", { cwd: projectDir });
    expect(fullMsg).toContain("Co-Authored-By:");
  });

  it("no-ops cleanly when task is already completed (nothing to stage)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // Store returns already-completed — updateCompletedTaskStatus short-circuits
    const mockStore = {
      getItem: vi.fn(async (id: string) => {
        if (id !== taskId) return null;
        return { id: taskId, status: "completed", title: "Test task", level: "task" };
      }),
      updateItem: vi.fn(async () => {}),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    const run = buildCompletedRun(taskId);

    await expect(
      (finalizeRun as Function)({
        run,
        henchDir,
        projectDir,
        autoCommit: true,
        skipFullTestGate: true,
        store: mockStore,
      }),
    ).resolves.not.toThrow();

    // Working tree should remain clean — nothing was written
    const dirty = await getRexDirtyLines(projectDir);
    expect(dirty).toHaveLength(0);
  });

  /**
   * This case used to assert the opposite — that the non-autoCommit path must
   * NOT produce a metadata commit — back when the cleanup was gated on the
   * autoCommit flag and "not autoCommit" was taken to mean "the commit prompt
   * will handle it".
   *
   * `--review` broke that assumption: it forces autoCommit off precisely so
   * the tree stays uncommitted for the reviewer, and the agent may commit its
   * own work anyway (the prompt forbids it, but `git commit` remains in its
   * allowed commands, and the HEAD-move warning in runAdversarialReviewPass
   * exists because the path is anticipated). Then there is no pending message
   * file and nothing staged, the commit prompt returns early, and the
   * completion metadata `updateCompletedTaskStatus` already wrote sits dirty
   * until the next run's `git add -A` sweeps it into unrelated work.
   *
   * The double-commit this case was guarding against cannot happen: the gate
   * is now the commit prompt's own outcome, so a finalize that committed never
   * commits again.
   */
  it("commits metadata on the non-autoCommit path when nothing else committed", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const mockStore = {
      getItem: vi.fn(async (id: string) => {
        if (id !== taskId) return null;
        return { id: taskId, status: "in_progress", title: "Test task", level: "task" };
      }),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    // The agent committed its own work mid-run, the way a --review run's
    // executor can: HEAD moved, nothing is staged, no .hench-commit-msg.txt.
    await writeFile(join(projectDir, "app.js"), "// the agent's own work\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "feat: the agent committed this itself"', { cwd: projectDir });

    const run = buildCompletedRun(taskId);

    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit: false,   // what --review forces
      skipFullTestGate: true,
      store: mockStore,
    });

    // Not left for the next run to sweep up.
    expect(await getRexDirtyLines(projectDir)).toHaveLength(0);

    // And committed as itself, naming the task, rather than discarded.
    const { stdout: committed } = await execAsync(
      `git show HEAD:.rex/${PRD_TREE_DIRNAME}/task-slug-abc/index.md`,
      { cwd: projectDir },
    );
    expect(committed).toContain("status: completed");
    const { stdout: subject } = await execAsync("git log -1 --format='%s'", { cwd: projectDir });
    expect(subject).toContain(taskId);
  });

  it("leaves the PRD tree alone when the run did not complete", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const mockStore = {
      getItem: vi.fn(async (id: string) => {
        if (id !== taskId) return null;
        return { id: taskId, status: "in_progress", title: "Test task", level: "task" };
      }),
      updateItem: vi.fn(async () => {}),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    // A failed run writes no completion status, so anything dirty in the tree
    // belongs to someone else. Committing it would attribute a stranger's edit
    // to this task.
    const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
    await writeFile(taskIndexPath, `${current}edited-by: someone-else\n`, "utf-8");

    const run = buildCompletedRun(taskId);
    run.status = "failed";

    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit: false,
      skipFullTestGate: true,
      rollbackOnFailure: false,
      store: mockStore,
    });

    expect(await getRexDirtyLines(projectDir)).not.toHaveLength(0);
  });
});
