/**
 * Commit message file watcher with auto-commit timer.
 *
 * When the agent writes `.hench-commit-msg.txt` during a run, this module
 * detects the write and arms a one-shot timer. If the file still has non-empty
 * content when the timer fires, the staged changes are committed and the file
 * is removed. This handles the case where the run terminates abnormally
 * (timeout, crash) after the agent staged its work but before n-dx could
 * process the commit prompt.
 *
 * Call `cancel()` to disarm both the watcher and any pending timer — the normal
 * run lifecycle always cancels before calling `performCommitPromptIfNeeded` so
 * the two mechanisms cannot double-commit.
 *
 * @module
 */

import { watch as fsWatch } from "node:fs";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execStdout } from "../../process/exec.js";
import { detail } from "../../types/output.js";

/** The sentinel file the agent writes its proposed commit message to. */
const PENDING_COMMIT_FILE = ".hench-commit-msg.txt";

export interface CommitMsgWatcher {
  /** Cancel the watcher and any pending timer. No-op if already cancelled. */
  cancel(): void;
}

export interface CommitMsgWatcherOptions {
  projectDir: string;
  /**
   * Milliseconds to wait after the file is first detected with non-empty
   * content before auto-committing. 0 disables the timer entirely.
   */
  timeoutMs: number;
}

/**
 * Start watching for `.hench-commit-msg.txt` in `projectDir`.
 *
 * - Arms a one-shot timer on first detection of the file with non-empty content.
 * - On expiry, reads the file; if still non-empty, runs `git commit -F` and
 *   removes the file.
 * - Returns `{ cancel }` for callers to disarm when the run ends normally.
 *
 * When `timeoutMs` is 0 the watcher still runs (tracking the file) but the
 * timer is never set, making the function a no-op for the commit path.
 */
export function startCommitMsgWatcher(opts: CommitMsgWatcherOptions): CommitMsgWatcher {
  const { projectDir, timeoutMs } = opts;
  const msgPath = join(projectDir, PENDING_COMMIT_FILE);

  let cancelled = false;
  let timerArmed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcherClosed = false;

  function closeWatcher(): void {
    if (!watcherClosed) {
      watcherClosed = true;
      try {
        watcher.close();
      } catch {
        // already closed or never opened
      }
    }
  }

  function cancel(): void {
    cancelled = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    closeWatcher();
  }

  async function tryAutoCommit(): Promise<void> {
    if (cancelled) return;

    let message = "";
    try {
      if (existsSync(msgPath)) {
        message = readFileSync(msgPath, "utf-8").trim();
      }
    } catch {
      // file gone between exists check and read
    }

    if (!message) {
      // File is gone or empty — nothing to commit.
      try { unlinkSync(msgPath); } catch { /* ignore */ }
      return;
    }

    try {
      await execStdout("git", ["commit", "-F", PENDING_COMMIT_FILE], {
        cwd: projectDir,
        timeout: 30_000,
      });
      detail("Auto-commit: committed staged changes (timer expiry).");
    } catch (err) {
      detail(`Auto-commit failed: ${(err as Error).message}`);
    } finally {
      try { unlinkSync(msgPath); } catch { /* ignore */ }
    }
  }

  function armTimerOnce(): void {
    if (timerArmed || cancelled || timeoutMs === 0) return;
    timerArmed = true;
    timer = setTimeout(() => {
      timer = undefined;
      if (!cancelled) {
        tryAutoCommit().catch(() => { /* swallow — never block the process */ });
      }
    }, timeoutMs);
  }

  function checkFile(): void {
    if (timerArmed || cancelled) return;
    try {
      if (existsSync(msgPath)) {
        const content = readFileSync(msgPath, "utf-8").trim();
        if (content) {
          armTimerOnce();
        }
      }
    } catch {
      // ignore transient read errors
    }
  }

  // Check immediately in case the file was written before the watcher started.
  checkFile();

  // Watch the project directory for filesystem events. The `filename` argument
  // carries the base name on platforms that support it (Linux, macOS); on
  // others it may be null — in that case we check unconditionally.
  const watcher = fsWatch(projectDir, (event, filename) => {
    if (filename === PENDING_COMMIT_FILE || filename === null) {
      checkFile();
    }
  });

  // Prevent the watcher from keeping the process alive after the run ends.
  if (typeof watcher.unref === "function") {
    watcher.unref();
  }

  return { cancel };
}
