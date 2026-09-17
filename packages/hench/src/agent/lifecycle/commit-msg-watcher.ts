/**
 * Commit message file watcher with auto-commit timer.
 *
 * When the agent writes `.hench-commit-msg.txt` during a run, this module
 * detects the write and arms a one-shot timer. On timer expiry the file is
 * read: if it has non-empty content the staged changes are committed and the
 * file is removed; if the file is empty or whitespace-only it is deleted
 * without committing and a distinct log line is emitted. This handles the
 * case where the run terminates abnormally (timeout, crash) after the agent
 * staged its work but before n-dx could process the commit prompt.
 *
 * A commit git refuses is reported as a refusal and claims nothing: the file
 * and the staged changes are left for the normal commit path, and
 * `didAutoCommit()` stays false so that path is not skipped.
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
import { execGitMutation } from "../../process/git-mutation.js";
import { checkRunGitOrigin, type RunGitOrigin } from "../../process/git-origin.js";
import { detail, info } from "../../types/output.js";

/** The sentinel file the agent writes its proposed commit message to. */
const PENDING_COMMIT_FILE = ".hench-commit-msg.txt";

/**
 * Fallback poll interval. `fs.watch` is platform-dependent and can miss
 * events (e.g. on macOS the FSEvents stream starts asynchronously, so a file
 * written right after the watcher is created may produce no event). A cheap
 * existsSync poll guarantees detection regardless of event delivery.
 */
const FALLBACK_POLL_INTERVAL_MS = 1000;

export interface CommitMsgWatcher {
  /** Cancel the watcher and any pending timer. No-op if already cancelled. */
  cancel(): void;
  /**
   * Check if the timer fired and successfully auto-committed changes.
   * Returns true only if tryAutoCommit() ran and completed a git commit.
   */
  didAutoCommit(): boolean;
}

export interface CommitMsgWatcherOptions {
  projectDir: string;
  /**
   * Milliseconds to wait after the file is first detected with non-empty
   * content before auto-committing. 0 disables the timer entirely.
   */
  timeoutMs: number;
  /**
   * Checkout the run started in. This timer fires precisely when the run went
   * abnormal (timeout, crash), so the checkout is at its least trustworthy —
   * a mismatch here refuses the commit and leaves both the staged changes and
   * the message file for the operator. Omitted means nothing to enforce.
   */
  origin?: RunGitOrigin;
  /** Test seam — defaults to the real git-backed check. */
  checkOrigin?: (dir: string, origin: RunGitOrigin | undefined) => string | undefined;
}

/**
 * Start watching for `.hench-commit-msg.txt` in `projectDir`.
 *
 * - Arms a one-shot timer on first detection of the file (even if empty).
 * - On expiry:
 *   - Non-empty content → runs `git commit -F` and removes the file.
 *   - Empty or whitespace-only → deletes the file without committing and
 *     logs a distinct line so operators know the skip was intentional.
 * - Returns `{ cancel }` for callers to disarm when the run ends normally.
 *
 * When `timeoutMs` is 0 the watcher still runs (tracking the file) but the
 * timer is never set, making the function a no-op for the commit path.
 */
export function startCommitMsgWatcher(opts: CommitMsgWatcherOptions): CommitMsgWatcher {
  const { projectDir, timeoutMs, origin } = opts;
  const checkOrigin = opts.checkOrigin ?? checkRunGitOrigin;
  const msgPath = join(projectDir, PENDING_COMMIT_FILE);

  let cancelled = false;
  let timerArmed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let watcherClosed = false;
  let autoCommitted = false;

  function stopPolling(): void {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

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
    stopPolling();
    closeWatcher();
  }

  async function tryAutoCommit(): Promise<void> {
    if (cancelled) return;

    let fileExists = false;
    let message = "";
    try {
      if (existsSync(msgPath)) {
        fileExists = true;
        message = readFileSync(msgPath, "utf-8").trim();
      }
    } catch {
      // file gone between exists check and read
    }

    if (!fileExists) {
      // File was already removed before the timer fired — nothing to do.
      return;
    }

    if (!message) {
      // File exists but is empty or whitespace-only — clean up without committing.
      detail("Auto-commit: skipped — commit message file was empty or whitespace-only (file removed).");
      try { unlinkSync(msgPath); } catch { /* ignore */ }
      return;
    }

    // Refusing keeps the message file too: the staged changes and the agent's
    // proposed message are both still there for the operator to land by hand
    // once the checkout is back where the run started.
    const drift = checkOrigin(projectDir, origin);
    if (drift) {
      info(
        `⚠ Auto-commit refused: ${drift}. ` +
          `The staged changes and ${PENDING_COMMIT_FILE} were left untouched.`,
      );
      return;
    }

    // Checked, not `execStdout`: that helper resolves with whatever landed on
    // stdout even when git exited non-zero, so a rejected signing request, a
    // failing pre-commit hook or a missing Git identity printed "committed",
    // set `autoCommitted`, and deleted the message file. didAutoCommit() then
    // short-circuits performCommitPromptIfNeeded, so the run's work stayed
    // uncommitted with nothing reporting it — and the next task's commit
    // absorbed it.
    try {
      await execGitMutation(projectDir, ["commit", "-F", PENDING_COMMIT_FILE], 30_000);
    } catch (err) {
      // Same disposition as the origin-drift refusal above: the staged changes
      // and the agent's proposed message both stay put, so the normal commit
      // path can still land them and the uncommitted-work gate still sees them.
      info(
        `⚠ Auto-commit failed: ${(err as Error).message}. ` +
          `The staged changes and ${PENDING_COMMIT_FILE} were left in place.`,
      );
      return;
    }

    detail("Auto-commit: committed staged changes (timer expiry).");
    autoCommitted = true;
    try { unlinkSync(msgPath); } catch { /* ignore */ }
  }

  function armTimerOnce(): void {
    if (timerArmed || cancelled || timeoutMs === 0) return;
    timerArmed = true;
    stopPolling(); // file detected — the fallback poll has done its job
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
        // Arm the timer as soon as the file appears, regardless of content.
        // tryAutoCommit() will decide at expiry whether to commit or clean up.
        armTimerOnce();
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

  // Fallback poll in case fs.watch never delivers an event (see
  // FALLBACK_POLL_INTERVAL_MS). Stopped as soon as the timer arms.
  if (timeoutMs > 0 && !timerArmed) {
    pollTimer = setInterval(checkFile, FALLBACK_POLL_INTERVAL_MS);
    pollTimer.unref?.();
  }

  return {
    cancel,
    didAutoCommit: () => autoCommitted,
  };
}
