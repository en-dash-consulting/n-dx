/**
 * CLI formatting helpers for execution queue status display.
 *
 * @module hench/queue/format
 */

import type { QueueStatus } from "./execution-queue.js";

/**
 * Format queue status as human-readable CLI output lines.
 *
 * Returns an array of strings (one per line) suitable for printing
 * to the terminal. Returns an empty array if the queue is idle
 * (no active tasks, no pending tasks).
 */
export function formatQueueStatus(status: QueueStatus): string[] {
  // Nothing to show if the queue is completely idle
  if (status.activeCount === 0 && status.queuedCount === 0) {
    return [];
  }

  const lines: string[] = [];
  const utilization = `${status.activeCount}/${status.maxConcurrent}`;

  lines.push(`Queue: ${utilization} slots active, ${status.queuedCount} queued`);

  if (!status.accepting) {
    lines.push("  ⚠ Queue is draining (not accepting new tasks)");
  }

  if (status.queued.length > 0) {
    lines.push("  Pending:");
    for (const entry of status.queued) {
      const waitMs = Date.now() - new Date(entry.enqueuedAt).getTime();
      const waitStr = formatWait(waitMs);
      lines.push(`    ${entry.position}. [${entry.priority}] ${entry.taskId} (waiting ${waitStr})`);
    }
  }

  return lines;
}

/**
 * Format queue status as a JSON-serializable object.
 * The returned object is the QueueStatus itself (already plain data).
 */
export function formatQueueStatusJson(status: QueueStatus): QueueStatus {
  return status;
}

/** Format a wait duration in ms as a human-readable string. */
function formatWait(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}
