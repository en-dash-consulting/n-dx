/**
 * Unit tests for the timeout handler branches inside commit-msg-watcher.
 *
 * Covers the three observable outcomes when the timer fires:
 *   1. Empty file   → file deleted, no commit, skip logged.
 *   2. Whitespace   → file deleted, no commit, skip logged.
 *   3. Non-empty    → git commit runs, file deleted.
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

const execAsync = promisify(execCb);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupGitRepo(dir: string): Promise<void> {
  await execAsync("git init", { cwd: dir });
  await execAsync("git config user.email test@test.com", { cwd: dir });
  await execAsync("git config user.name Test", { cwd: dir });
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

    await sleep(300); // wait past timer
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

    await sleep(300);
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

    await sleep(300);
    watcher.cancel();

    // The commit must exist and the file must be gone.
    expect(await getHeadSubject(projectDir)).toBe("feat: update x to 2");
    expect(existsSync(msgPath)).toBe(false);
  });
});
