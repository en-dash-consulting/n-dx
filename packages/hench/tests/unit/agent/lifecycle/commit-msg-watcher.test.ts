/**
 * Unit tests for the timeout handler branches inside commit-msg-watcher.
 *
 * Covers the four observable outcomes when the timer fires:
 *   1. Empty file   → file deleted, no commit, skip logged.
 *   2. Whitespace   → file deleted, no commit, skip logged.
 *   3. Non-empty    → git commit runs, file deleted.
 *   4. Git refuses  → no commit claimed, file kept for the normal commit path.
 *
 * Each test uses a real temporary directory so file-system side-effects are
 * directly observable without complex mocking. The git repo is only needed
 * for the non-empty branch; the empty/whitespace branches are verified by
 * checking disk state alone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { initGitFixtureRepo } from "../../../helpers/index.js";

const execAsync = promisify(execCb);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until `condition()` is true or `deadlineMs` elapses. Fixed sleeps are
 * flaky under full-suite load, so tests poll for the observable outcome.
 */
async function waitFor(condition: () => boolean, deadlineMs = 5000): Promise<void> {
  const start = Date.now();
  while (!condition() && Date.now() - start < deadlineMs) {
    await sleep(25);
  }
}

async function setupGitRepo(dir: string): Promise<void> {
  await initGitFixtureRepo(dir);
  // Initial commit so HEAD exists
  await writeFile(join(dir, "src.ts"), "export const x = 1;\n", "utf-8");
  await execAsync("git add .", { cwd: dir });
  await execAsync('git commit -m "initial"', { cwd: dir });
}

async function getHeadSubject(dir: string): Promise<string> {
  const { stdout } = await execAsync("git log -1 --pretty=%s", { cwd: dir });
  return stdout.trim();
}

describe("startCommitMsgWatcher — timeout handler branches", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-watcher-unit-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("empty file: deletes the file and skips the commit", async () => {
    // No git repo needed — the empty-file branch never reaches git.
    const { startCommitMsgWatcher } = await import(
      "../../../../src/agent/lifecycle/commit-msg-watcher.js"
    );

    const msgPath = join(projectDir, ".hench-commit-msg.txt");

    // Write an empty file to trigger the watcher.
    await writeFile(msgPath, "", "utf-8");

    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 100 });

    // At expiry the watcher deletes the empty sentinel
    await waitFor(() => !existsSync(msgPath));
    watcher.cancel();

    // File must be gone — no partial state on disk.
    expect(existsSync(msgPath)).toBe(false);
  });

  it("whitespace-only file: deletes the file and skips the commit", async () => {
    const { startCommitMsgWatcher } = await import(
      "../../../../src/agent/lifecycle/commit-msg-watcher.js"
    );

    const msgPath = join(projectDir, ".hench-commit-msg.txt");

    // Write whitespace-only content.
    await writeFile(msgPath, "   \n\t  \n", "utf-8");

    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 100 });

    await waitFor(() => !existsSync(msgPath));
    watcher.cancel();

    expect(existsSync(msgPath)).toBe(false);
  });

  it("non-empty file: commits staged changes and removes the file", async () => {
    await setupGitRepo(projectDir);

    const { startCommitMsgWatcher } = await import(
      "../../../../src/agent/lifecycle/commit-msg-watcher.js"
    );

    // Stage a change (simulating agent work).
    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });

    const msgPath = join(projectDir, ".hench-commit-msg.txt");
    await writeFile(msgPath, "feat: update x to 2", "utf-8");

    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 100 });

    // Wait for the timer to fire and the commit subprocess to complete
    await waitFor(() => watcher.didAutoCommit());
    watcher.cancel();

    // The commit must exist and the file must be gone.
    expect(await getHeadSubject(projectDir)).toBe("feat: update x to 2");
    expect(existsSync(msgPath)).toBe(false);
  });

  it("rejected commit: claims no auto-commit and keeps the staged work and message file", async () => {
    await setupGitRepo(projectDir);

    const { startCommitMsgWatcher } = await import(
      "../../../../src/agent/lifecycle/commit-msg-watcher.js"
    );

    // Stage a change, then make git refuse the commit for real. A stale index
    // lock stands in for the production causes named in the ACs — a rejected
    // signing request, a failing pre-commit hook, a missing Git identity — all
    // of which reach this helper the same way: a non-zero `git commit`.
    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add src.ts", { cwd: projectDir });
    await writeFile(join(projectDir, ".git", "index.lock"), "", "utf-8");

    const msgPath = join(projectDir, ".hench-commit-msg.txt");
    await writeFile(msgPath, "feat: update x to 2", "utf-8");

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const logged = (): string => consoleLog.mock.calls.flat().join("\n");
    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 100 });

    await waitFor(() => logged().includes("Auto-commit failed"));
    watcher.cancel();

    const output = logged();
    // The success line and the flag it sets are what made a refused commit read
    // as a landed one: didAutoCommit() short-circuits performCommitPromptIfNeeded,
    // so the run's work would stay uncommitted with nobody reporting it.
    expect(output).toContain("Auto-commit failed");
    expect(output).not.toContain("committed staged changes");
    expect(watcher.didAutoCommit()).toBe(false);

    // HEAD unmoved, work still staged, and the message file preserved so the
    // normal commit prompt can still land it.
    expect(await getHeadSubject(projectDir)).toBe("initial");
    expect(existsSync(msgPath)).toBe(true);

    await rm(join(projectDir, ".git", "index.lock"), { force: true });
    const { stdout: staged } = await execAsync("git diff --cached --name-only", {
      cwd: projectDir,
    });
    expect(staged.trim()).toBe("src.ts");
  });
});
