/**
 * Tracks consecutive run failures in --loop mode.
 *
 * Purpose: Prevent unattended loops from spinning indefinitely on a broken state.
 * After 3 consecutive failures, the loop is automatically terminated with a
 * diagnostic message.
 *
 * Semantics:
 * - recordFailure() increments the counter
 * - recordSuccess() resets the counter to 0
 * - shouldCancel() returns true when count === 3
 * - Any success breaks the streak (resets count), even mid-sequence
 */

/**
 * Run statuses that count as a failure for the consecutive-failure counter.
 *
 * Aligned with `FAILURE_STATUSES` in `agent/lifecycle/shared.ts` (the rollback
 * gate). Both predicates answer "did this run end in failure?" — they must
 * agree, otherwise a status can be rolled back but still reset the counter
 * (or vice versa).
 *
 * `error_transient` and `cancelled` belong here even though `shouldContinueLoop`
 * keeps iterating on them: the loop continues so a different task can be tried,
 * but the failure still counts toward the 3-strike threshold.
 */
const FAILURE_STATUSES: ReadonlySet<string> = new Set([
  "failed",
  "timeout",
  "budget_exceeded",
  "error_transient",
  "cancelled",
]);

/**
 * Return true if a run status indicates the run ended in failure.
 *
 * Distinct from `!shouldContinueLoop(status)`: that predicate decides whether
 * the loop should keep iterating, which is true for `error_transient` and
 * `cancelled` (try the next task). This predicate decides whether the failed
 * run should bump the consecutive-failure counter, which is also true for
 * those statuses.
 */
export function isFailureStatus(status: string): boolean {
  return FAILURE_STATUSES.has(status);
}

export class ConsecutiveFailureCounter {
  private failureCount: number = 0;
  private lastTaskId: string | undefined;
  private readonly FAILURE_THRESHOLD = 3;

  /**
   * Record a failed run outcome and increment the consecutive failure count.
   */
  recordFailure(taskId: string): void {
    this.failureCount++;
    this.lastTaskId = taskId;
  }

  /**
   * Record a successful run outcome and reset the consecutive failure count to 0.
   */
  recordSuccess(): void {
    this.failureCount = 0;
    this.lastTaskId = undefined;
  }

  /**
   * Return the current consecutive failure count.
   */
  count(): number {
    return this.failureCount;
  }

  /**
   * Return true if the consecutive failure threshold (3) has been reached.
   * This is the signal to auto-cancel the loop.
   */
  shouldCancel(): boolean {
    return this.failureCount >= this.FAILURE_THRESHOLD;
  }

  /**
   * Return the task ID of the last failure, or undefined if no failures recorded.
   */
  lastFailedTaskId(): string | undefined {
    return this.lastTaskId;
  }

  /**
   * Return a diagnostic message describing the auto-cancellation.
   * Empty string if cancellation threshold has not been reached.
   *
   * Format: "Loop auto-cancelled after 3 consecutive failures (last task: <taskId>)"
   */
  getCancellationMessage(): string {
    if (!this.shouldCancel()) {
      return "";
    }

    const taskInfo = this.lastTaskId
      ? ` (last task: ${this.lastTaskId})`
      : "";
    return (
      `Loop auto-cancelled after ${this.failureCount} consecutive failures${taskInfo}. ` +
      `Inspect the run log before retrying.`
    );
  }
}
