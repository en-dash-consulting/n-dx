/**
 * Commit message file watcher with auto-commit timer.
 *
 * When the agent writes `.hench-commit-msg.txt` during a run, this module
 * detects the write and arms a one-shot timer. This handles the case where the
 * run terminates abnormally (timeout, crash) after the agent staged its work
 * but before n-dx could process the commit prompt.
 *
 * On timer expiry the file is read, and what happens to it depends on the
 * outcome — the message is the executor's authored work and usually the only
 * copy, so it is only discarded when it is provably useless:
 *
 * | Outcome                     | Commit | Message file | `didAutoCommit()` |
 * |-----------------------------|--------|--------------|-------------------|
 * | Non-empty, commit succeeds  | yes    | removed      | true              |
 * | Empty / whitespace-only     | no     | removed      | false             |
 * | Fails, "nothing to commit"  | no     | removed      | false             |
 * | Fails for any other reason  | no     | **kept**     | false             |
 *
 * That last row is load-bearing. Deleting the message on a failed commit lost
 * it permanently AND left `performCommitPromptIfNeeded` with nothing to find,
 * so it returned silently and the staged files rode the next run's
 * `git add -A` under an unrelated task. A kept file is the recoverable
 * direction: the pre-run commit gate already handles a dirty tree with a
 * message file present.
 *
 * Call `cancel()` to disarm both the watcher and any pending timer — the normal
 * run lifecycle always cancels before calling `performCommitPromptIfNeeded` so
 * the two mechanisms cannot double-commit.
 *
 * `cancel()` only disarms; it cannot un-fire a timer that already went off.
 * A caller that must know nothing is running — the review pass, which cancels
 * and then spawns a second agent into the same working tree — awaits
 * `settle()` afterwards.
 *
 * @module
 */

import { watch as fsWatch } from "node:fs";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { exec } from "../../process/exec.js";
import { detail, info } from "../../types/output.js";

/**
 * git's phrasings for "the index holds nothing to record".
 *
 * The only `git commit` failure where the message file is genuinely useless
 * rather than precious, so the only one that still cleans up after itself.
 */
const NOTHING_TO_COMMIT = /nothing to commit|no changes added to commit|nothing added to commit/i;

/** First non-empty line of command output, for a one-line failure summary. */
function firstLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}

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
   * Wait for an auto-commit that has already started to finish.
   *
   * `cancel()` disarms a timer that has not fired; it cannot un-fire one that
   * has. When the timer fires it launches `tryAutoCommit()`, which spends up
   * to 30 seconds inside `git commit`. Cancelling during that window leaves
   * the commit running, so a caller that proceeds immediately — the review
   * pass, which cancels and then spawns — runs concurrently with it: either
   * the commit lands mid-review and moves HEAD unannounced, or the two git
   * invocations collide on `.git/index.lock` and the commit fails after the
   * message file has already been consumed.
   *
   * Resolves immediately when no commit is in flight. Never rejects — a
   * failed auto-commit is reported by `didAutoCommit()` returning false, not
   * by throwing at whoever happened to wait.
   */
  settle(): Promise<void>;
  /**
   * Check if the timer fired and successfully auto-committed changes.
   * Returns true only if tryAutoCommit() ran and completed a git commit.
   *
   * Only meaningful after {@link settle} resolves: before that, a commit may
   * still be in flight and this reads false for a commit that is about to
   * land.
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
}

/**
 * Start watching for `.hench-commit-msg.txt` in `projectDir`.
 *
 * - Arms a one-shot timer on first detection of the file (even if empty).
 * - On expiry, resolves one of the four outcomes tabulated in the module
 *   docblock above: commit and remove, skip-and-remove for an empty message or
 *   a "nothing to commit" failure, or keep the file and warn for any other
 *   commit failure.
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
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let watcherClosed = false;
  let autoCommitted = false;
  /**
   * The in-flight tryAutoCommit(), retained so cancel() has something to wait
   * on. Fire-and-forget was the hole: a commit already running outlived the
   * cancel that was meant to stop it.
   */
  let inFlight: Promise<void> | undefined;

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

    // `exec`, not `execStdout`: execStdout discards its error argument and
    // always resolves, so the failure branch below was unreachable and a
    // rejected commit set `autoCommitted = true` — the run then reported an
    // auto-commit that had not happened.
    const commit = await exec("git", ["commit", "-F", PENDING_COMMIT_FILE], {
      cwd: projectDir,
      timeout: 30_000,
    });

    if (commit.exitCode === 0) {
      detail("Auto-commit: committed staged changes (timer expiry).");
      autoCommitted = true;
      removeMsgFile();
      return;
    }

    const output = `${commit.stdout}\n${commit.stderr}`.trim();

    if (NOTHING_TO_COMMIT.test(output)) {
      // The one failure where discarding the message is correct: it describes
      // nothing, and keeping it would leave a stale file for the next run.
      detail("Auto-commit: nothing staged to commit — message file removed.");
      removeMsgFile();
      return;
    }

    // Any other failure — a rejecting hook, a signing error, a held
    // .git/index.lock. The message file is the executor's authored work and the
    // only copy; deleting it here loses it permanently AND makes
    // performCommitPromptIfNeeded bail at its `!existsSync` check, so the
    // operator sees nothing and the staged files ride the next run's
    // `git add -A` under an unrelated task. Keep the file and say so loudly:
    // a stale message file is recoverable (the pre-run commit gate handles a
    // dirty tree with one present), a destroyed one is not.
    const staged = await countStagedFiles();
    info(
      `⚠ Auto-commit failed — ${staged} staged file(s) were NOT committed.\n` +
        `  ${PENDING_COMMIT_FILE} has been kept, so the message is not lost and the ` +
        `commit prompt can still use it.\n` +
        `  git: ${firstLine(output) || `exit ${commit.exitCode}`}`,
    );
  }

  /** Remove the message file, ignoring a file that has already gone. */
  function removeMsgFile(): void {
    try { unlinkSync(msgPath); } catch { /* already gone */ }
  }

  /**
   * How many files are staged, for the failure warning.
   *
   * Best-effort: the warning is more useful with a count than blocked without
   * one, so a failure to count reports 0 rather than throwing inside the
   * handler for another failure.
   */
  async function countStagedFiles(): Promise<number> {
    const staged = await exec("git", ["diff", "--cached", "--name-only"], {
      cwd: projectDir,
      timeout: 10_000,
    });
    if (staged.exitCode !== 0) return 0;
    return staged.stdout.split("\n").filter((line) => line.trim().length > 0).length;
  }

  function armTimerOnce(): void {
    if (timerArmed || cancelled || timeoutMs === 0) return;
    timerArmed = true;
    stopPolling(); // file detected — the fallback poll has done its job
    timer = setTimeout(() => {
      timer = undefined;
      if (!cancelled) {
        // Retained (and pre-caught, so awaiting it can never reject) for
        // settle(); still not awaited here, so the timer callback returns
        // immediately and never blocks the process.
        inFlight = tryAutoCommit().catch(() => { /* swallow — never block the process */ });
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
    settle: () => inFlight ?? Promise.resolve(),
    didAutoCommit: () => autoCommitted,
  };
}
