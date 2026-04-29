import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";

const execAsync = promisify(execCb);

/**
 * Integration tests for the commit-message approval gate.
 *
 * When the agent writes a pending commit message (`.hench-commit-msg.txt`)
 * and the run completes successfully, n-dx prompts the user to approve the
 * commit. Autonomous runs (`--auto`, `--loop`) bypass the prompt so
 * unattended runs do not stall waiting for input.
 */

async function setupGitRepo(dir: string): Promise<void> {
  await execAsync("git init", { cwd: dir });
  await execAsync("git config user.email test@test.com", { cwd: dir });
  await execAsync("git config user.name Test", { cwd: dir });
}

async function makeInitialCommit(dir: string, file: string, content: string): Promise<void> {
  await writeFile(join(dir, file), content, "utf-8");
  await execAsync("git add .", { cwd: dir });
  await execAsync('git commit -m "initial"', { cwd: dir });
}

/** Stage a modification and write a pending commit message. */
async function stageChangeWithPendingMessage(
  dir: string,
  file: string,
  content: string,
  message: string,
): Promise<void> {
  await writeFile(join(dir, file), content, "utf-8");
  await execAsync(`git add ${file}`, { cwd: dir });
  await writeFile(join(dir, ".hench-commit-msg.txt"), message, "utf-8");
}

function buildCompletedRun(): RunRecord {
  return {
    id: randomUUID(),
    taskId: "task-1",
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

async function getHeadSubject(dir: string): Promise<string> {
  const { stdout } = await execAsync("git log -1 --pretty=%s", { cwd: dir });
  return stdout.trim();
}

describe("performCommitPromptIfNeeded (commit approval bypass)", () => {
  let projectDir: string;
  let henchDir: string;
  /** Original stdin.isTTY value, restored in afterEach. */
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-commit-prompt-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await setupGitRepo(projectDir);

    originalIsTTY = process.stdin.isTTY;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Restore TTY state so other tests observe the real stdin.
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    await rm(projectDir, { recursive: true, force: true });
  });

  it("bypasses the approval prompt in autonomous mode (--auto/--loop) and commits using the proposed message", async () => {
    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await stageChangeWithPendingMessage(
      projectDir,
      "src.ts",
      "export const x = 2;\n",
      "feat: bump x to 2",
    );

    // Simulate an interactive terminal so only `autonomous` controls the bypass.
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    const run = buildCompletedRun();

    await performCommitPromptIfNeeded(
      run,
      projectDir,
      /* autoCommit */ false,
      /* yes */ false,
      /* autonomous */ true,
    );

    // The commit should have been created with the proposed message and
    // the sentinel file removed — without any prompt appearing.
    expect(await getHeadSubject(projectDir)).toBe("feat: bump x to 2");
    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);
  });

  it("shows the interactive approval prompt when not in autonomous mode", async () => {
    // Replace node:readline with a stub that records the question and
    // auto-declines, exercising the interactive code path end-to-end without
    // touching the real stdin.
    const questionLog: string[] = [];
    vi.doMock("node:readline", () => ({
      createInterface: () => ({
        question: (q: string, cb: (answer: string) => void) => {
          questionLog.push(q);
          cb("n"); // decline — leaves the staged change in place
        },
        close: () => {},
        // The SIGINT-suspension shim in shared.ts registers a
        // rl.on("SIGINT", ...) listener around the question. Provide
        // no-op implementations so the fake readline satisfies the
        // expected surface without doing anything.
        on: () => {},
        removeListener: () => {},
      }),
    }));
    vi.resetModules();

    try {
      const { performCommitPromptIfNeeded } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
      await stageChangeWithPendingMessage(
        projectDir,
        "src.ts",
        "export const x = 3;\n",
        "feat: bump x to 3",
      );

      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });

      const run = buildCompletedRun();

      await performCommitPromptIfNeeded(
        run,
        projectDir,
        /* autoCommit */ false,
        /* yes */ false,
        /* autonomous */ false,
      );

      // The interactive prompt must have been invoked exactly once with the
      // commit-approval question — that is the behavior bypassed in
      // autonomous mode.
      expect(questionLog).toHaveLength(1);
      expect(questionLog[0]).toMatch(/Commit .* staged file/);

      // User declined, so HEAD should still be the initial commit and the
      // sentinel file should have been removed.
      expect(await getHeadSubject(projectDir)).toBe("initial");
      expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);

      // The decline path leaves the change staged — verify nothing was
      // committed by checking the file contents are still the staged
      // version.
      const staged = readFileSync(join(projectDir, "src.ts"), "utf-8");
      expect(staged).toBe("export const x = 3;\n");
    } finally {
      vi.doUnmock("node:readline");
      vi.resetModules();
    }
  });

  it("--yes bypasses the prompt independently of autonomous mode", async () => {
    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await stageChangeWithPendingMessage(
      projectDir,
      "src.ts",
      "export const x = 4;\n",
      "feat: bump x via --yes",
    );

    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    const run = buildCompletedRun();

    await performCommitPromptIfNeeded(
      run,
      projectDir,
      /* autoCommit */ false,
      /* yes */ true,
      /* autonomous */ false,
    );

    expect(await getHeadSubject(projectDir)).toBe("feat: bump x via --yes");
    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);
  });
});

describe("performCommitPromptIfNeeded (PRD status integration)", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-prd-status-"));
    henchDir = join(projectDir, ".hench");
    rexDir = join(projectDir, ".rex");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
    await mkdir(join(rexDir, "tree", "task-slug-1"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await setupGitRepo(projectDir);

    originalIsTTY = process.stdin.isTTY;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    await rm(projectDir, { recursive: true, force: true });
  });

  it("stages PRD status file alongside code changes in the same commit", async () => {
    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    // Create initial PRD task file with status "in_progress"
    const taskIndexPath = join(rexDir, "tree", "task-slug-1", "index.md");
    const initialTaskContent = `# Task
status: in_progress
`;
    await mkdir(join(rexDir, "tree", "task-slug-1"), { recursive: true });
    await writeFile(taskIndexPath, initialTaskContent, "utf-8");

    // Create initial code file
    await writeFile(join(projectDir, "src.ts"), "export const x = 1;\n", "utf-8");

    // Create initial commit with both files
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });

    // Modify code file
    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });

    // Write proposed commit message
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: update x", "utf-8");

    // Create a mock store that updates the task file's status
    const mockStore = {
      getItem: vi.fn(async (taskId: string) => {
        if (taskId === "task-1") {
          return { status: "in_progress", id: "task-1", title: "Test Task", level: "task" };
        }
        return null;
      }),
      loadDocument: vi.fn(async () => ({
        items: [
          { id: "task-1", status: "in_progress", title: "Test Task", level: "task", children: [] },
        ],
      })),
      updateItem: vi.fn(async (taskId: string, updates: any) => {
        if (taskId === "task-1") {
          let content = readFileSync(taskIndexPath, "utf-8");
          if (updates.status) {
            content = content.replace("status: in_progress", `status: ${updates.status}`);
          }
          await writeFile(taskIndexPath, content, "utf-8");
        }
      }),
      appendLog: vi.fn(async () => {}),
    };

    Object.defineProperty(process.stdin, "isTTY", {
      value: false, // non-interactive so it auto-commits
      configurable: true,
    });

    const run = buildCompletedRun();

    await performCommitPromptIfNeeded(
      run,
      projectDir,
      /* autoCommit */ false,
      /* yes */ false,
      /* autonomous */ true,
      mockStore as any,
      "task-1",
    );

    // Verify the commit was created
    expect(await getHeadSubject(projectDir)).toBe("feat: update x");

    // Verify both the code file and PRD status file are in the commit
    const { stdout: commitFiles } = await execAsync(
      "git diff-tree --no-commit-id --name-only -r HEAD",
      { cwd: projectDir },
    );
    const files = commitFiles.trim().split("\n");
    expect(files).toContain("src.ts");
    expect(files.some((f) => f.includes(".rex/tree"))).toBe(true);

    // Verify the PRD file content shows status: completed
    const committedTask = readFileSync(taskIndexPath, "utf-8");
    expect(committedTask).toContain("status: completed");

    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);
  });

  it("does not update PRD status if commit is declined", async () => {
    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    vi.doMock("node:readline", () => ({
      createInterface: () => ({
        question: (q: string, cb: (answer: string) => void) => {
          cb("n"); // decline
        },
        close: () => {},
        on: () => {},
        removeListener: () => {},
      }),
    }));
    vi.resetModules();

    try {
      const { performCommitPromptIfNeeded: updated } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const taskIndexPath = join(rexDir, "tree", "task-slug-1", "index.md");
      const initialTaskContent = `# Task
status: in_progress
`;
      await writeFile(taskIndexPath, initialTaskContent, "utf-8");
      await writeFile(join(projectDir, "src.ts"), "export const x = 1;\n", "utf-8");

      await execAsync("git add .", { cwd: projectDir });
      await execAsync('git commit -m "initial"', { cwd: projectDir });

      await writeFile(join(projectDir, "src.ts"), "export const x = 3;\n", "utf-8");
      await execAsync("git add src.ts", { cwd: projectDir });
      await writeFile(
        join(projectDir, ".hench-commit-msg.txt"),
        "feat: update to 3",
        "utf-8",
      );

      let statusWasUpdated = false;
      const mockStore = {
        updateItem: vi.fn(async () => {
          statusWasUpdated = true;
          // Normally this would update the file, but we're testing that it's NOT called
          throw new Error("updateItem should not be called when commit is declined");
        }),
        appendLog: vi.fn(async () => {}),
      };

      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        configurable: true,
      });

      const run = buildCompletedRun();

      // This should decline the commit
      await updated(
        run,
        projectDir,
        /* autoCommit */ false,
        /* yes */ false,
        /* autonomous */ false,
        mockStore as any,
        "task-1",
      );

      // Verify updateItem was not called (status not updated)
      expect(statusWasUpdated).toBe(false);
      expect(mockStore.updateItem).not.toHaveBeenCalled();

      // Verify HEAD is still the initial commit
      expect(await getHeadSubject(projectDir)).toBe("initial");

      // Verify the file still has status: in_progress
      const taskContent = readFileSync(taskIndexPath, "utf-8");
      expect(taskContent).toContain("status: in_progress");
    } finally {
      vi.resetModules();
    }
  });

  it("adds N-DX-Status trailer to commit message when status changes from in_progress to completed", async () => {
    // This test verifies that the N-DX-Status trailer is correctly appended
    // to the commit message when a task status changes.

    // We'll test this at a lower level by directly testing the message file modification,
    // since the full toolRexUpdateStatus function is complex to mock.

    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    // Setup: Create initial code file
    await writeFile(join(projectDir, "src.ts"), "export const x = 1;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });

    // Modify and stage a file
    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });

    // Write proposed commit message
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: update x", "utf-8");

    // Create a minimal mock store that only needs to support getItem
    // (performCommitPromptIfNeeded only calls toolRexUpdateStatus which requires more,
    // but our implementation catches any errors and continues)
    const mockStore = {
      getItem: vi.fn(async (taskId: string) => {
        if (taskId === "task-1") {
          return { status: "in_progress" };
        }
        return null;
      }),
      updateItem: vi.fn(async () => { /* no-op */ }),
      appendLog: vi.fn(async () => { /* no-op */ }),
      loadDocument: vi.fn(async () => ({
        items: [{ id: "task-1", status: "in_progress" }],
      })),
    };

    Object.defineProperty(process.stdin, "isTTY", {
      value: false, // non-interactive so it auto-commits
      configurable: true,
    });

    const run = buildCompletedRun();

    await performCommitPromptIfNeeded(
      run,
      projectDir,
      /* autoCommit */ false,
      /* yes */ false,
      /* autonomous */ true,
      mockStore as any,
      "task-1",
    );

    // Verify the commit was created
    expect(await getHeadSubject(projectDir)).toBe("feat: update x");

    // Verify the commit message includes the N-DX-Status trailer
    const { stdout: trailers } = await execAsync("git log -1 --format='%(trailers)'", { cwd: projectDir });
    expect(trailers.trim()).toContain("N-DX-Status:");
    expect(trailers).toContain("task-1");
    expect(trailers).toContain("in_progress");
    expect(trailers).toContain("completed");

    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);
  });
});
