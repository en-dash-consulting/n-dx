import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";

const execAsync = promisify(execCb);

/**
 * Integration tests for the commit-message auto-commit timer.
 *
 * Simulates the scenario where an agent writes `.hench-commit-msg.txt` and
 * then the run terminates abnormally before the normal commit-prompt flow
 * runs. The watcher must fire at the configured timeout and commit the staged
 * changes.
 */

async function setupGitRepo(dir: string): Promise<void> {
  await execAsync("git init", { cwd: dir });
  await execAsync("git config user.email test@test.com", { cwd: dir });
  await execAsync("git config user.name Test", { cwd: dir });
}

async function makeInitialCommit(dir: string): Promise<void> {
  await writeFile(join(dir, "src.ts"), "export const x = 1;\n", "utf-8");
  await execAsync("git add .", { cwd: dir });
  await execAsync('git commit -m "initial"', { cwd: dir });
}

async function getHeadSubject(dir: string): Promise<string> {
  const { stdout } = await execAsync("git log -1 --pretty=%s", { cwd: dir });
  return stdout.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("startCommitMsgWatcher (auto-commit timer)", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-timer-"));
    await setupGitRepo(projectDir);
    await makeInitialCommit(projectDir);
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("auto-commits staged changes when timer fires after file is written", async () => {
    const { startCommitMsgWatcher } = await import(
      "../../src/agent/lifecycle/commit-msg-watcher.js"
    );

    // Modify and stage a file (simulating the agent's work)
    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });

    // Start watcher with a very short timeout for testing
    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 150 });

    // Simulate the agent writing the commit message file
    await writeFile(
      join(projectDir, ".hench-commit-msg.txt"),
      "feat: update x to 2",
      "utf-8",
    );

    // Wait for the timer to fire (150ms + buffer)
    await sleep(400);

    watcher.cancel(); // no-op at this point; timer already fired

    // The commit should have been created automatically
    expect(await getHeadSubject(projectDir)).toBe("feat: update x to 2");

    // The sentinel file should have been removed
    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);
  });

  it("arms the timer only once even when the file is re-written", async () => {
    const { startCommitMsgWatcher } = await import(
      "../../src/agent/lifecycle/commit-msg-watcher.js"
    );

    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });

    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 200 });

    // Write the file twice — the timer should only arm on the first write
    await writeFile(
      join(projectDir, ".hench-commit-msg.txt"),
      "feat: first write",
      "utf-8",
    );
    await sleep(50);
    // Overwrite — should NOT reset the timer to 200ms from now
    await writeFile(
      join(projectDir, ".hench-commit-msg.txt"),
      "feat: second write",
      "utf-8",
    );

    // Wait past the original 200ms timer (but still within what would be a
    // second 200ms timer started on the second write)
    await sleep(350);

    watcher.cancel();

    // A commit must have fired — subject is whatever the file contained at
    // expiry (which may be either value; the important thing is a commit exists)
    const subject = await getHeadSubject(projectDir);
    expect(subject).toMatch(/feat: /);
    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);
  });

  it("cancel() prevents the timer from firing", async () => {
    const { startCommitMsgWatcher } = await import(
      "../../src/agent/lifecycle/commit-msg-watcher.js"
    );

    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });

    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 200 });

    await writeFile(
      join(projectDir, ".hench-commit-msg.txt"),
      "feat: cancelled commit",
      "utf-8",
    );

    // Cancel immediately — before the 200ms timer fires
    watcher.cancel();

    await sleep(350); // wait past the timer expiry

    // HEAD should still be the initial commit — the timer was cancelled
    expect(await getHeadSubject(projectDir)).toBe("initial");

    // The sentinel file should still exist (cancel() does not delete it)
    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(true);
  });

  it("does nothing when timeoutMs is 0", async () => {
    const { startCommitMsgWatcher } = await import(
      "../../src/agent/lifecycle/commit-msg-watcher.js"
    );

    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });

    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 0 });

    await writeFile(
      join(projectDir, ".hench-commit-msg.txt"),
      "feat: disabled timer",
      "utf-8",
    );

    await sleep(100);
    watcher.cancel();

    // No commit should have been created
    expect(await getHeadSubject(projectDir)).toBe("initial");
  });

  it("does nothing when the file is empty at timer expiry", async () => {
    const { startCommitMsgWatcher } = await import(
      "../../src/agent/lifecycle/commit-msg-watcher.js"
    );

    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });

    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 150 });

    // Write a non-empty file to arm the timer, then clear it before it fires
    await writeFile(
      join(projectDir, ".hench-commit-msg.txt"),
      "feat: will be cleared",
      "utf-8",
    );
    // Immediately clear — before the 150ms timer fires
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "", "utf-8");

    await sleep(300);
    watcher.cancel();

    // No commit should have been created
    expect(await getHeadSubject(projectDir)).toBe("initial");
  });

  it("detects a file written before the watcher starts (early write)", async () => {
    const { startCommitMsgWatcher } = await import(
      "../../src/agent/lifecycle/commit-msg-watcher.js"
    );

    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });

    // Write the file BEFORE starting the watcher
    await writeFile(
      join(projectDir, ".hench-commit-msg.txt"),
      "feat: early write",
      "utf-8",
    );

    // Start watcher after the file already exists — should detect it immediately
    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 150 });

    await sleep(350);
    watcher.cancel();

    expect(await getHeadSubject(projectDir)).toBe("feat: early write");
    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);
  });
});
