import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";

const execAsync = promisify(execCb);

/**
 * Poll until `condition()` is true or `deadlineMs` elapses. Fixed sleeps are
 * flaky under full-suite load (the git commit subprocess can take longer than
 * any fixed buffer), so tests poll for the observable outcome instead.
 */
async function waitFor(condition: () => boolean, deadlineMs = 5000): Promise<void> {
  const start = Date.now();
  while (!condition() && Date.now() - start < deadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Integration test for timer-expiry auto-commit in --yes mode.
 *
 * Simulates the scenario: when hench runs with --yes/--auto/--loop, a timer-expiry
 * auto-commit should not stall the loop. The performCommitPromptIfNeeded function
 * must recognize that the auto-commit already happened (via didAutoCommit()) and
 * return early without waiting for a prompt.
 */

describe("Timer-expiry auto-commit in --yes mode", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-stall-test-"));
    // Set up a minimal git repo
    await execAsync("git init", { cwd: projectDir });
    await execAsync("git config user.email test@test.com", { cwd: projectDir });
    await execAsync("git config user.name Test", { cwd: projectDir });
    // Initial commit so HEAD exists
    await writeFile(join(projectDir, "file.txt"), "initial\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("recognizes timer-expiry auto-commit when performCommitPromptIfNeeded is called", async () => {
    /**
     * Simulates the flow:
     * 1. Agent completes with staged changes
     * 2. Agent writes .hench-commit-msg.txt
     * 3. Timer fires before performCommitPromptIfNeeded is called
     * 4. performCommitPromptIfNeeded detects didAutoCommit() == true
     * 5. Function returns early without prompting
     *
     * This test verifies the watcher -> performCommitPromptIfNeeded integration
     * so the loop doesn't stall on the commit gate.
     */

    const { startCommitMsgWatcher } = await import(
      "../../src/agent/lifecycle/commit-msg-watcher.js"
    );
    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    // Simulate agent work: stage a change
    await writeFile(join(projectDir, "file.txt"), "modified\n", "utf-8");
    await execAsync("git add file.txt", { cwd: projectDir });

    // Simulate agent writing commit message FIRST, then start watcher
    // This ensures the watcher sees the file immediately and arms the timer
    await writeFile(
      join(projectDir, ".hench-commit-msg.txt"),
      "feat: update file",
      "utf-8",
    );

    // Start the watcher with a short timeout
    const commitWatcher = startCommitMsgWatcher({ projectDir, timeoutMs: 150 });

    // Wait for the timer to fire and the auto-commit subprocess to complete
    await waitFor(() => commitWatcher.didAutoCommit());

    // Verify the auto-commit happened
    expect(commitWatcher.didAutoCommit()).toBe(true);

    // Verify staged count is 0 (because timer already committed)
    const { execStdout } = await import("../../src/process/exec.js");
    const stagedOutput = await execStdout("git", ["diff", "--cached", "--name-only"], {
      cwd: projectDir,
      timeout: 10_000,
    });
    expect(stagedOutput.trim()).toBe(""); // No staged files — already committed

    // Call performCommitPromptIfNeeded with yes=true (simulating --yes mode)
    // This should recognize the auto-commit and return early without stalling
    const mockRun = {
      status: "completed",
      id: "test-run-1",
      taskTitle: "Test",
      taskId: "test-task-1",
      vendor: "test",
      model: "test",
      turns: 1,
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      turnTokenUsage: [],
    };

    // This should complete quickly without waiting for a prompt
    let completed = false;
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("performCommitPromptIfNeeded timed out")), 5000)
    );
    const call = (async () => {
      await performCommitPromptIfNeeded(
        mockRun,
        projectDir,
        false, // autoCommit
        true, // yes (simulating --yes mode)
        false, // autonomous
        undefined, // store
        undefined, // taskId
        commitWatcher,
      );
      completed = true;
    })();

    // Wait for either completion or timeout
    await Promise.race([call, timeout]);

    // Verify the call completed (loop didn't stall)
    expect(completed).toBe(true);
  });

  it("does not create a duplicate commit when timer already committed", async () => {
    /**
     * Ensures that if the timer fires and commits, and later
     * performCommitPromptIfNeeded is called, a second commit is not created.
     * This tests the "advances directly" behavior from acceptance criteria.
     */

    const { startCommitMsgWatcher } = await import(
      "../../src/agent/lifecycle/commit-msg-watcher.js"
    );
    const { performCommitPromptIfNeeded } = await import(
      "../../src/agent/lifecycle/shared.js"
    );

    // Simulate agent work
    await writeFile(join(projectDir, "file.txt"), "changed\n", "utf-8");
    await execAsync("git add file.txt", { cwd: projectDir });

    const commitWatcher = startCommitMsgWatcher({ projectDir, timeoutMs: 150 });

    // Simulate commit message
    await writeFile(
      join(projectDir, ".hench-commit-msg.txt"),
      "feat: change file",
      "utf-8",
    );

    // Wait for the timer-expiry auto-commit to fully complete — the HEAD
    // sampled below must already include it, or it lands mid-assertion
    await waitFor(() => commitWatcher.didAutoCommit());

    // Get the current HEAD
    const { execStdout } = await import("../../src/process/exec.js");
    const headBeforeCall = await execStdout(
      "git",
      ["log", "-1", "--pretty=%H"],
      { cwd: projectDir, timeout: 10_000 }
    );
    const countBeforeCall = (
      await execStdout("git", ["log", "--oneline"], { cwd: projectDir, timeout: 10_000 })
    )
      .split("\n")
      .filter((l) => l.trim()).length;

    const mockRun = {
      status: "completed",
      id: "test-run-2",
      taskTitle: "Test",
      taskId: "test-task-2",
      vendor: "test",
      model: "test",
      turns: 1,
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      turnTokenUsage: [],
    };

    // Call performCommitPromptIfNeeded
    await performCommitPromptIfNeeded(
      mockRun,
      projectDir,
      false,
      true,
      false,
      undefined,
      undefined,
      commitWatcher,
    );

    // Verify no additional commit was created
    const headAfterCall = await execStdout(
      "git",
      ["log", "-1", "--pretty=%H"],
      { cwd: projectDir, timeout: 10_000 }
    );
    const countAfterCall = (
      await execStdout("git", ["log", "--oneline"], { cwd: projectDir, timeout: 10_000 })
    )
      .split("\n")
      .filter((l) => l.trim()).length;

    expect(headBeforeCall).toEqual(headAfterCall); // Same HEAD
    expect(countBeforeCall).toBe(countAfterCall); // Same number of commits
  });
});
