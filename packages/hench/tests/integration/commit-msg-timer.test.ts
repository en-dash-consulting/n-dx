import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { initGitFixtureRepo } from "../helpers/index.js";

const execAsync = promisify(execCb);

/**
 * Integration tests for the commit-message auto-commit timer.
 *
 * Simulates the scenario where an agent writes `.hench-commit-msg.txt` and
 * then the run terminates abnormally before the normal commit-prompt flow
 * runs. The watcher must fire at the configured timeout and commit the staged
 * changes.
 */

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

/**
 * Poll until `condition()` is true or `deadlineMs` elapses. Fixed sleeps are
 * flaky under full-suite load (the git commit subprocess can take longer than
 * any fixed buffer), so positive-path tests poll for the observable outcome.
 */
async function waitFor(condition: () => boolean, deadlineMs = 5000): Promise<void> {
  const start = Date.now();
  while (!condition() && Date.now() - start < deadlineMs) {
    await sleep(25);
  }
}

describe("startCommitMsgWatcher (auto-commit timer)", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-timer-"));
    await initGitFixtureRepo(projectDir);
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

    // Wait for the timer to fire and the commit subprocess to complete
    await waitFor(() => watcher.didAutoCommit());

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
    await waitFor(() => watcher.didAutoCommit());

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

    // Generous timeout so the clear-write below reliably lands before expiry
    // even under full-suite load
    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 500 });

    // Write a non-empty file to arm the timer, then clear it before it fires
    await writeFile(
      join(projectDir, ".hench-commit-msg.txt"),
      "feat: will be cleared",
      "utf-8",
    );
    // Immediately clear — before the 500ms timer fires
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "", "utf-8");

    // At expiry the watcher deletes the empty sentinel without committing
    await waitFor(() => !existsSync(join(projectDir, ".hench-commit-msg.txt")));
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

    await waitFor(() => watcher.didAutoCommit());
    watcher.cancel();

    expect(await getHeadSubject(projectDir)).toBe("feat: early write");
    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);
  });

  /**
   * A failed auto-commit used to be indistinguishable from a successful one.
   *
   * `git commit -F` ran through `execStdout`, which ignores its error argument
   * and always resolves — so the catch was dead code, `autoCommitted` was set
   * even when the commit had failed, and the `finally` deleted the message file
   * regardless. The run then reported an auto-commit that never happened, with
   * the authored message permanently gone and the staged work left to ride the
   * next run's `git add -A` under someone else's task.
   *
   * The failure is injected via a nonexistent gpg signer: it is one of the
   * modes named in the report, it fails the commit for a reason unrelated to
   * the working tree, and unlike a `#!/bin/sh` pre-commit hook it behaves the
   * same on Windows (where such a hook fails to spawn at all, testing the wrong
   * thing).
   */
  describe("when the commit itself fails", () => {
    async function breakCommitSigning(dir: string): Promise<void> {
      await execAsync("git config commit.gpgsign true", { cwd: dir });
      await execAsync("git config gpg.program ndx-nonexistent-gpg", { cwd: dir });
    }

    it("keeps the message file, warns, and does not claim an auto-commit", async () => {
      const { startCommitMsgWatcher } = await import(
        "../../src/agent/lifecycle/commit-msg-watcher.js"
      );

      await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
      await execAsync("git add src.ts", { cwd: projectDir });
      await breakCommitSigning(projectDir);

      const headBefore = await getHeadSubject(projectDir);
      const msgPath = join(projectDir, ".hench-commit-msg.txt");

      // info() writes through console.log. The warning has to reach the
      // operator: a detail() line is what this defect already had, and it was
      // easy to miss in a long run log.
      const logged: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
        logged.push(args.join(" "));
      });

      try {
        const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 100 });
        await writeFile(msgPath, "feat: work that must not be lost", "utf-8");

        // Cannot poll on didAutoCommit() here — it must stay false — so wait
        // for the attempt to settle instead.
        await waitFor(() => false, 900);
        await watcher.settle();
        watcher.cancel();

        // The commit did not happen...
        expect(await getHeadSubject(projectDir)).toBe(headBefore);
        // ...and is not reported as having happened.
        expect(watcher.didAutoCommit()).toBe(false);
        // The authored message survives, so the commit prompt can still use it.
        expect(existsSync(msgPath)).toBe(true);
        expect(readFileSync(msgPath, "utf-8")).toContain("must not be lost");

        const warning = logged.join("\n");
        expect(warning).toMatch(/Auto-commit failed/i);
        // Names the staged count and says the message was kept, so the operator
        // knows both what is uncommitted and that nothing was destroyed.
        expect(warning).toMatch(/1 staged file/);
        expect(warning).toContain(".hench-commit-msg.txt");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("leaves the staged work committable once the cause is fixed", async () => {
      const { startCommitMsgWatcher } = await import(
        "../../src/agent/lifecycle/commit-msg-watcher.js"
      );

      await writeFile(join(projectDir, "src.ts"), "export const x = 3;\n", "utf-8");
      await execAsync("git add src.ts", { cwd: projectDir });
      await breakCommitSigning(projectDir);

      const msgPath = join(projectDir, ".hench-commit-msg.txt");
      const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 100 });
      await writeFile(msgPath, "feat: recoverable", "utf-8");

      await waitFor(() => false, 900);
      await watcher.settle();
      watcher.cancel();

      // Repair the cause and commit using the message the watcher preserved.
      await execAsync("git config --unset commit.gpgsign", { cwd: projectDir });
      await execAsync("git commit -F .hench-commit-msg.txt", { cwd: projectDir });

      expect(await getHeadSubject(projectDir)).toBe("feat: recoverable");
    });

    /**
     * The one failure where discarding the message is right: there is nothing
     * to commit, so the message describes nothing. Keeping it would leave a
     * stale file for the next run to trip over.
     */
    it("still cleans up when the failure is 'nothing to commit'", async () => {
      const { startCommitMsgWatcher } = await import(
        "../../src/agent/lifecycle/commit-msg-watcher.js"
      );

      // Nothing staged — the commit fails, but for a reason that makes the
      // message file useless rather than precious.
      const msgPath = join(projectDir, ".hench-commit-msg.txt");
      const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 100 });
      await writeFile(msgPath, "feat: describes nothing", "utf-8");

      await waitFor(() => !existsSync(msgPath), 900);
      await watcher.settle();
      watcher.cancel();

      expect(existsSync(msgPath)).toBe(false);
      expect(watcher.didAutoCommit()).toBe(false);
    });
  });
});
