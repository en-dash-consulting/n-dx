import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";

const execAsync = promisify(execCb);

/**
 * Integration tests for the failure rollback in finalizeRun.
 *
 * The rollback is prompt-only: a revert NEVER occurs without an express
 * interactive confirmation. These tests run under a non-TTY stdin (the test
 * environment), i.e. the non-interactive path — so finalizeRun must always
 * leave the working tree exactly as-is on failure, regardless of run status
 * or the rollbackOnFailure flag. The interactive confirm/decline behavior is
 * covered in rollback-prompt.test.ts and sigint-prompt.test.ts.
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

function buildMinimalRun(status: RunRecord["status"]): RunRecord {
  return {
    id: randomUUID(),
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    status,
    turns: 3,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
  };
}

describe("finalizeRun git rollback (prompt-only, non-interactive path)", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-rollback-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    // Suppress console output during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await setupGitRepo(projectDir);

    // Guard the invariant these tests rely on: stdin is not a TTY, so every
    // finalizeRun below exercises the non-interactive (never-revert) path.
    expect(process.stdin.isTTY).toBeFalsy();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("does NOT revert tracked changes on failure without an interactive confirmation", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "console.log('modified by agent');\n";
    await makeInitialCommit(projectDir, "src.ts", "console.log('original');\n");
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    await finalizeRun({
      run: buildMinimalRun("failed"),
      henchDir,
      projectDir,
      rollbackOnFailure: true,
    });

    // Prompt-only: no TTY confirmation available → changes are preserved.
    const fileContent = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(fileContent).toBe(modifiedContent);
  });

  // The next three cases assert the SCOPING of a revert (#303). finalizeRun
  // never reverts non-interactively, so they exercise revertChanges directly —
  // the exact call the lifecycle makes after an express confirmation.

  it("removes agent-created untracked files on a confirmed revert (empty baseline)", async () => {
    const { revertChanges } = await import("../../src/agent/analysis/review.js");

    await makeInitialCommit(projectDir, "original.ts", "export {};\n");
    // Tree started clean (empty baseline) → the new file is agent-created and
    // must be removed on revert.
    await writeFile(join(projectDir, "new-file.ts"), "new file content\n", "utf-8");

    const result = await revertChanges(projectDir, { baselineUntracked: [] });

    expect(result.removedUntracked).toEqual(["new-file.ts"]);
    // Untracked file should be removed by the scoped git clean
    let fileExists = true;
    try {
      await readFile(join(projectDir, "new-file.ts"), "utf-8");
    } catch {
      fileExists = false;
    }
    expect(fileExists).toBe(false);
  });

  it("preserves pre-existing untracked files, removing only agent-created ones (#303)", async () => {
    const { captureBaselineUntracked } = await import("../../src/agent/lifecycle/shared.js");
    const { revertChanges } = await import("../../src/agent/analysis/review.js");

    const originalTracked = "export const v = 1;\n";
    await makeInitialCommit(projectDir, "lib.ts", originalTracked);

    // The user's pre-existing untracked work — must survive rollback.
    // Includes a hidden dotfile, the exact class of file #303 was wiping.
    await writeFile(join(projectDir, "user-scratch.txt"), "do not delete me\n", "utf-8");
    await writeFile(join(projectDir, ".env"), "SECRET=keepme\n", "utf-8");

    // Capture the baseline BEFORE the agent runs, exactly as the loops do.
    const baselineUntracked = await captureBaselineUntracked(projectDir);

    // Simulate the agent: modify a tracked file AND create a new untracked file.
    await writeFile(join(projectDir, "lib.ts"), "export const v = 999;\n", "utf-8");
    await writeFile(join(projectDir, "agent-output.log"), "scratch from agent\n", "utf-8");

    const result = await revertChanges(projectDir, { baselineUntracked });

    // Pre-existing untracked files (incl. hidden) are preserved.
    expect(result.keptUntracked).toEqual(
      expect.arrayContaining([".env", "user-scratch.txt"]),
    );
    expect(await readFile(join(projectDir, "user-scratch.txt"), "utf-8")).toBe(
      "do not delete me\n",
    );
    expect(await readFile(join(projectDir, ".env"), "utf-8")).toBe("SECRET=keepme\n");

    // The agent-created untracked file is removed.
    expect(result.removedUntracked).toEqual(["agent-output.log"]);
    let agentFileExists = true;
    try {
      await readFile(join(projectDir, "agent-output.log"), "utf-8");
    } catch {
      agentFileExists = false;
    }
    expect(agentFileExists).toBe(false);

    // The tracked modification is reverted. Normalize EOL: git may restore
    // tracked files with CRLF under Windows autocrlf (unrelated to #303).
    const revertedLib = (await readFile(join(projectDir, "lib.ts"), "utf-8")).replace(
      /\r\n/g,
      "\n",
    );
    expect(revertedLib).toBe(originalTracked);
  });

  it("preserves ALL untracked files when no baseline is supplied (safe fallback)", async () => {
    const { revertChanges } = await import("../../src/agent/analysis/review.js");

    await makeInitialCommit(projectDir, "original.ts", "export {};\n");
    await writeFile(join(projectDir, "unknown-scratch.txt"), "keep me\n", "utf-8");

    // No baselineUntracked → cannot distinguish agent files from user files,
    // so nothing untracked is deleted.
    const result = await revertChanges(projectDir);

    expect(result.removedUntracked).toEqual([]);
    expect(await readFile(join(projectDir, "unknown-scratch.txt"), "utf-8")).toBe("keep me\n");
  });

  it("is a no-op when the working tree is already clean", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    await makeInitialCommit(projectDir, "clean.ts", "export {};\n");

    await finalizeRun({
      run: buildMinimalRun("failed"),
      henchDir,
      projectDir,
      rollbackOnFailure: true,
    });

    const content = await readFile(join(projectDir, "clean.ts"), "utf-8");
    expect(content).toBe("export {};\n");
  });

  it("leaves changes in place when rollbackOnFailure=false (--no-rollback)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "console.log('modified by agent');\n";
    await makeInitialCommit(projectDir, "src.ts", "console.log('original');\n");
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    await finalizeRun({
      run: buildMinimalRun("failed"),
      henchDir,
      projectDir,
      rollbackOnFailure: false,
    });

    const fileContent = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(fileContent).toBe(modifiedContent);
  });

  it("does not revert on successful completion", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modifiedContent = "console.log('modified by agent');\n";
    await makeInitialCommit(projectDir, "src.ts", "console.log('original');\n");
    await writeFile(join(projectDir, "src.ts"), modifiedContent, "utf-8");

    await finalizeRun({
      run: buildMinimalRun("completed"),
      henchDir,
      projectDir,
      rollbackOnFailure: true,
      skipFullTestGate: true,
    });

    const fileContent = await readFile(join(projectDir, "src.ts"), "utf-8");
    expect(fileContent).toBe(modifiedContent);
  });

  // Every failure status routes through the same prompt-only gate; none of
  // them auto-revert in a non-interactive run.
  for (const status of ["timeout", "budget_exceeded", "error_transient", "cancelled"] as const) {
    it(`preserves changes on ${status} status (prompt-only, non-interactive)`, async () => {
      const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

      const modified = "export const x = 999;\n";
      await makeInitialCommit(projectDir, "lib.ts", "export const x = 1;\n");
      await writeFile(join(projectDir, "lib.ts"), modified, "utf-8");

      await finalizeRun({
        run: buildMinimalRun(status),
        henchDir,
        projectDir,
        rollbackOnFailure: true,
      });

      const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
      expect(content).toBe(modified);
    });
  }

  it("preserves changes when rollbackOnFailure is not specified (default true, prompt-only)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const modified = "export const a = 999;\n";
    await makeInitialCommit(projectDir, "lib.ts", "export const a = 1;\n");
    await writeFile(join(projectDir, "lib.ts"), modified, "utf-8");

    // No rollbackOnFailure specified → defaults to true, but the revert is
    // still prompt-only, so a non-interactive run does not revert.
    await finalizeRun({
      run: buildMinimalRun("failed"),
      henchDir,
      projectDir,
    });

    const content = await readFile(join(projectDir, "lib.ts"), "utf-8");
    expect(content).toBe(modified);
  });
});
