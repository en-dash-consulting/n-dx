/**
 * Integration tests for Co-Authored-By trailer presence and absence across
 * hench commit paths.
 *
 * Coverage:
 *   - Autonomous path (--auto / --loop): trailer present in git log
 *   - Interactive path (--yes): trailer present in git log
 *   - Interactive decline: no commit created, trailer cannot appear
 *   - Failed-run rollback: no new commit created, trailer absent from HEAD
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";

const execAsync = promisify(execCb);

// ---------------------------------------------------------------------------
// Helpers shared across suites
// ---------------------------------------------------------------------------

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
    vendor: "claude",
    weight: "standard",
  };
}

function buildFailedRun(): RunRecord {
  return {
    id: randomUUID(),
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    status: "failed",
    turns: 3,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
    vendor: "claude",
    weight: "standard",
  };
}

async function getHeadCommitBody(dir: string): Promise<string> {
  const { stdout } = await execAsync("git log -1 --format='%B'", { cwd: dir });
  return stdout;
}

async function getHeadSubject(dir: string): Promise<string> {
  const { stdout } = await execAsync("git log -1 --pretty=%s", { cwd: dir });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Suite: autonomous commit path (--auto / --loop)
// ---------------------------------------------------------------------------

describe("Co-Authored-By trailer — autonomous path (--auto/--loop)", () => {
  let projectDir: string;
  let henchDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-coauth-auto-"));
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
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    await rm(projectDir, { recursive: true, force: true });
  });

  it("appends Co-Authored-By trailer in autonomous mode", async () => {
    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await stageChangeWithPendingMessage(
      projectDir,
      "src.ts",
      "export const x = 2;\n",
      "feat: autonomous commit",
    );

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    await performCommitPromptIfNeeded(
      buildCompletedRun(),
      projectDir,
      /* autoCommit */ false,
      /* yes */ false,
      /* autonomous */ true,
    );

    expect(await getHeadSubject(projectDir)).toBe("feat: autonomous commit");
    const body = await getHeadCommitBody(projectDir);
    expect(body).toContain("Co-Authored-By: ndx <NDX_EMAIL_PLACEHOLDER>");
    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);
  });

  it("placeholder token is exactly NDX_EMAIL_PLACEHOLDER — regression guard", async () => {
    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await stageChangeWithPendingMessage(
      projectDir,
      "src.ts",
      "export const x = 2;\n",
      "feat: placeholder guard",
    );

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    await performCommitPromptIfNeeded(
      buildCompletedRun(),
      projectDir,
      /* autoCommit */ false,
      /* yes */ false,
      /* autonomous */ true,
    );

    const body = await getHeadCommitBody(projectDir);
    // Assert the literal placeholder token — must NOT be substituted at source time.
    expect(body).toContain("NDX_EMAIL_PLACEHOLDER");
    // And the full trailer line must match exactly.
    expect(body).toMatch(/Co-Authored-By: ndx <NDX_EMAIL_PLACEHOLDER>/);
  });
});

// ---------------------------------------------------------------------------
// Suite: interactive commit path (--yes approval)
// ---------------------------------------------------------------------------

describe("Co-Authored-By trailer — interactive path (--yes)", () => {
  let projectDir: string;
  let henchDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-coauth-interactive-"));
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
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    await rm(projectDir, { recursive: true, force: true });
  });

  it("appends Co-Authored-By trailer when --yes bypasses the interactive prompt", async () => {
    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");
    await stageChangeWithPendingMessage(
      projectDir,
      "src.ts",
      "export const x = 2;\n",
      "feat: yes-approved commit",
    );

    // Simulate interactive TTY — --yes flag should bypass the prompt
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    await performCommitPromptIfNeeded(
      buildCompletedRun(),
      projectDir,
      /* autoCommit */ false,
      /* yes */ true,
      /* autonomous */ false,
    );

    expect(await getHeadSubject(projectDir)).toBe("feat: yes-approved commit");
    const body = await getHeadCommitBody(projectDir);
    expect(body).toContain("Co-Authored-By: ndx <NDX_EMAIL_PLACEHOLDER>");
    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);
  });

  it("trailer is absent when user declines the interactive commit prompt", async () => {
    // Stub readline so the user "presses n" — no commit should be created.
    vi.doMock("node:readline", () => ({
      createInterface: () => ({
        question: (_q: string, cb: (answer: string) => void) => { cb("n"); },
        close: () => {},
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
        "feat: declined commit",
      );

      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

      await performCommitPromptIfNeeded(
        buildCompletedRun(),
        projectDir,
        /* autoCommit */ false,
        /* yes */ false,
        /* autonomous */ false,
      );

      // No commit was created — HEAD is still the initial commit.
      expect(await getHeadSubject(projectDir)).toBe("initial");

      // The HEAD commit (initial) must not contain the Co-Authored-By trailer.
      const body = await getHeadCommitBody(projectDir);
      expect(body).not.toContain("Co-Authored-By: ndx <NDX_EMAIL_PLACEHOLDER>");
    } finally {
      vi.doUnmock("node:readline");
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: rollback / failed-run path
// ---------------------------------------------------------------------------

describe("Co-Authored-By trailer — rollback path", () => {
  let projectDir: string;
  let henchDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-coauth-rollback-"));
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
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    await rm(projectDir, { recursive: true, force: true });
  });

  it("no commit is created on a failed run — Co-Authored-By trailer absent from HEAD", async () => {
    // When a run fails, performCommitPromptIfNeeded is a no-op (run.status ≠ "completed")
    // and the rollback path reverts changes without creating a commit.
    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");

    // Agent staged work and wrote a commit message, but the run failed.
    await writeFile(join(projectDir, "src.ts"), "export const x = 99;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });
    await writeFile(
      join(projectDir, ".hench-commit-msg.txt"),
      "feat: work that never landed",
      "utf-8",
    );

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    const failedRun = buildFailedRun();
    await performCommitPromptIfNeeded(
      failedRun,
      projectDir,
      /* autoCommit */ false,
      /* yes */ false,
      /* autonomous */ true,
    );

    // performCommitPromptIfNeeded is a no-op for failed runs — no commit.
    // HEAD is still the initial commit and must NOT contain Co-Authored-By.
    expect(await getHeadSubject(projectDir)).toBe("initial");
    const body = await getHeadCommitBody(projectDir);
    expect(body).not.toContain("Co-Authored-By: ndx <NDX_EMAIL_PLACEHOLDER>");
  });

  it("autoCommit=true path skips performCommitPromptIfNeeded entirely — no double-trailer", async () => {
    // When the agent commits itself (legacy autoCommit mode), our function is
    // bypassed and we don't append the trailer (the agent's own commit message
    // is taken as-is). This test confirms no spurious commit is created by
    // our function in that mode.
    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    await makeInitialCommit(projectDir, "src.ts", "export const x = 1;\n");

    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    const run = buildCompletedRun();
    await performCommitPromptIfNeeded(
      run,
      projectDir,
      /* autoCommit */ true, // <-- agent handles its own commit
      /* yes */ false,
      /* autonomous */ true,
    );

    // No new commit should have been created by our function.
    expect(await getHeadSubject(projectDir)).toBe("initial");
  });
});
