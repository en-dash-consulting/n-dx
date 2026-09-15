import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, appendFile, rename } from "node:fs/promises";
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
    await writeFile(join(rexDir, "execution-log.jsonl"), "baseline log\n", "utf-8");

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

  it("commits both sides of an execution-log rotation", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const rexDir = join(projectDir, ".rex");
    const logPath = join(rexDir, "execution-log.jsonl");
    let rotationPending = true;

    const mockStore = {
      getItem: vi.fn(async (id: string) =>
        id === taskId ? { id: taskId, status: "in_progress", title: "Test task", level: "task" } : null,
      ),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      appendLog: vi.fn(async () => {
        if (rotationPending) {
          rotationPending = false;
          await rename(logPath, join(rexDir, "execution-log.1.jsonl"));
        }
        await appendFile(logPath, "completion log\n", "utf-8");
      }),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    await (finalizeRun as Function)({
      run: buildCompletedRun(taskId),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store: mockStore,
    });

    expect(await getRexDirtyLines(projectDir)).toHaveLength(0);
    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    expect(changed).toContain(".rex/execution-log.jsonl");
    expect(changed).toContain(".rex/execution-log.1.jsonl");
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

  it("does not commit metadata on non-autoCommit path (no double-commit)", async () => {
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

    // On the non-autoCommit path there is no pending commit file, so
    // performCommitPromptIfNeeded is a no-op (existsSync returns false).
    // commitCompletionMetadata must NOT be called — the test verifies there
    // is exactly one commit (the initial one) after finalizeRun.
    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit: false,   // non-autoCommit path
      skipFullTestGate: true,
      store: mockStore,
    });

    const { stdout: log } = await execAsync("git log --oneline", { cwd: projectDir });
    // Only the initial commit: commitCompletionMetadata must not create a commit
    expect(log.trim().split("\n")).toHaveLength(1);
  });
});
