import type { RunRecord } from "../schema/index.js";

/**
 * Statuses that count as a hard failure for stuck-task detection.
 * Transient errors (API rate limits, network blips) do not count because
 * they are expected to self-resolve on retry.
 */
const FAILURE_STATUSES: Set<string> = new Set(["failed", "timeout"]);

/**
 * Count the number of consecutive recent failures for a given task.
 *
 * Walks through runs most-recent-first (the array must be sorted by
 * startedAt descending), filtering to the target taskId. Counts only
 * hard failures (failed/timeout); stops at the first non-failure run.
 */
export function countRecentFailures(
  taskId: string,
  runs: RunRecord[],
): number {
  let count = 0;
  for (const run of runs) {
    if (run.taskId !== taskId) continue;
    if (FAILURE_STATUSES.has(run.status)) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Return true if a task has accumulated enough consecutive failures
 * to be considered stuck.
 */
export function isStuckTask(
  taskId: string,
  runs: RunRecord[],
  threshold: number,
): boolean {
  return countRecentFailures(taskId, runs) >= threshold;
}

/**
 * Scan all runs and return the set of task IDs that are stuck
 * (i.e. have ≥ threshold consecutive hard failures, most-recent-first).
 *
 * @param runs  Run records sorted by startedAt **descending**
 * @param threshold  Number of consecutive failures before a task is stuck
 */
export function getStuckTaskIds(
  runs: RunRecord[],
  threshold: number,
): Set<string> {
  // Collect unique task IDs that have appeared in runs
  const taskIds = new Set<string>();
  for (const run of runs) {
    taskIds.add(run.taskId);
  }

  const stuck = new Set<string>();
  for (const taskId of taskIds) {
    if (isStuckTask(taskId, runs, threshold)) {
      stuck.add(taskId);
    }
  }

  return stuck;
}
