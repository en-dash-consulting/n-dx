/**
 * Detect a CLI session that ended waiting on a background command, and decide
 * whether to resume it.
 *
 * WHY THIS EXISTS. The system prompt's Foreground Invariant
 * (`agent/planning/prompt.ts`) tells the agent never to background a command
 * and never to end its turn waiting for a notification. That is prompt text,
 * and nothing enforces it: Bash's `run_in_background` is a parameter of an
 * allowed tool, so the `--allowed-tools` allowlist cannot forbid it. In run
 * 01d15d75 the agent backgrounded the full suite, called `ScheduleWakeup` and
 * `Monitor`, and ended its turn. In a `claude -p` session nothing ever
 * delivers that notification, so the work sat uncommitted, the completion gate
 * reset the task, and the reviewer (resuming the same transcript) inherited
 * the wait and never wrote its report.
 *
 * The session is still resumable, though, because its id is on the spawn
 * result. So the fix is to detect and resume, on the same pattern as
 * `planModeIntercept`: `spawnWithAdapter` records a signal on the spawn
 * result, and the caller acts on it once the process has exited. It does not
 * kill the process: the agent may still finish in the foreground, and a
 * session that commits despite having backgrounded something needs no help.
 *
 * Vendor knowledge stays in the adapters: which tool calls count is
 * `VendorAdapter.detectBackgroundWait`, and whether a session may be resumed
 * is `VendorAdapter.resumesUnfinishedSessions`. This module holds only the
 * vendor-neutral parts — the messages, the failure text, and the
 * unfinished-work check.
 *
 * @module hench/agent/lifecycle/background-wait
 */

import { findUncommittedWork, PRD_COMMIT_PATHS } from "./uncommitted-work-gate.js";
import { pendingCommitMessageExists } from "./shared.js";
import type { BackgroundWaitSignal } from "./vendor-adapter.js";

export type { BackgroundWaitSignal };

/**
 * The message that resumes a work session which ended waiting.
 *
 * Fixed text on purpose. It is the whole turn: the resumed session already
 * holds the task, so repeating the brief would only grow the prompt.
 */
export const WORK_SESSION_RESUME_MESSAGE =
  "Nothing will notify you: this run is non-interactive, and a background command, " +
  "scheduled wake-up, or monitor will never report back to this session. " +
  "Run the command again in the foreground and wait for it to exit, then finish: " +
  "commit your work, update the task status, and write your summary.";

/**
 * The message that resumes a review session which ended waiting instead of
 * writing its report.
 */
export function buildReviewResumeMessage(reportPath: string): string {
  return (
    "Nothing will notify you: this review is non-interactive, and a background command, " +
    "scheduled wake-up, or monitor will never report back to this session. Do not wait " +
    "for anything and do not start another check. Write the JSON report now, from what " +
    `you already have, to this exact path:\n\n    ${reportPath}\n\n` +
    "Say in `summary` which checks you did not see finish."
  );
}

/**
 * The run error when a work session ends waiting a second time, after it has
 * already been resumed once.
 */
export function formatBackgroundWaitFailure(signal: BackgroundWaitSignal): string {
  const what = signal.detail ? `${signal.tool} (${signal.detail})` : signal.tool;
  return (
    `The agent ended its session waiting on a background command again after being resumed ` +
    `to finish in the foreground (last: ${what}). Nothing notifies a non-interactive run, ` +
    `so its work was left uncommitted. The task is reset to pending.`
  );
}

export interface UnfinishedWorkOptions {
  projectDir: string;
  /** `hench.autoCommit`: the agent was supposed to commit itself. */
  autoCommit: boolean;
  /** Test seam: the porcelain listing, as in {@link findUncommittedWork}. */
  listDirty?: (dir: string) => Promise<string[]>;
}

/**
 * True when the session left work the completion gate would refuse.
 *
 * The same view as the uncommitted-work gate in `finalizeRun`, minus the
 * review repairs (no review has run yet): PRD paths are discounted because a
 * later step commits them, and the staged index is discounted only when the
 * commit prompt will actually run. Anything else still in the tree means the
 * session stopped before its commit step, which is what a resume is for.
 */
export async function hasUnfinishedWork(opts: UnfinishedWorkOptions): Promise<boolean> {
  const leaked = await findUncommittedWork({
    projectDir: opts.projectDir,
    stagedCommitFollows: !opts.autoCommit && pendingCommitMessageExists(opts.projectDir),
    discountPaths: PRD_COMMIT_PATHS,
    deps: opts.listDirty ? { listDirty: opts.listDirty } : undefined,
  });
  return !leaked.clean;
}
