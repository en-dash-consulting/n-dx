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
