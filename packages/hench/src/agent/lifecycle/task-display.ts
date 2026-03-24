import type { TaskBrief } from "../../schema/index.js";
import type { SelectionExplanation } from "../../prd/rex-gateway.js";
import { subsection, stream, detail } from "../../types/output.js";

export type SelectionReason = "auto" | "explicit" | "interactive";

/** Prior attempt history for the selected task. */
export interface PriorAttemptInfo {
  /** Number of prior run attempts for this task. */
  count: number;
  /** How long ago the most recent attempt finished (human-readable). */
  lastAttemptAgo?: string;
  /** Status of the most recent attempt. */
  lastStatus?: string;
}

/**
 * Display task information before any work begins.
 * Shows task ID, title, priority, parent chain, acceptance criteria count,
 * and why this task was selected (auto-selected by priority, explicit ID,
 * or interactive selection).
 *
 * When auto-selected, shows rich selection reasoning including skipped items,
 * dependency info, and downstream unblock potential.
 */
export function displayTaskInfo(
  brief: TaskBrief,
  reason?: SelectionReason,
  explanation?: SelectionExplanation,
  priorAttempts?: PriorAttemptInfo,
): void {
  subsection("Task");

  stream("Task", `${brief.task.title}`);
  detail(`ID: ${brief.task.id}`);

  if (brief.task.priority) {
    detail(`Priority: ${brief.task.priority}`);
  }

  if (reason === "auto") {
    if (explanation) {
      detail(`Selected: auto — ${formatSelectionSummary(explanation)}`);
    } else {
      detail("Selected: auto (highest priority)");
    }
  }

  if (brief.parentChain.length > 0) {
    const chain = brief.parentChain.map((p) => p.title).join(" → ");
    detail(`Context: ${chain}`);
  }

  if (brief.task.acceptanceCriteria && brief.task.acceptanceCriteria.length > 0) {
    detail(`Acceptance criteria: ${brief.task.acceptanceCriteria.length}`);
  }

  if (priorAttempts && priorAttempts.count > 0) {
    const timePart = priorAttempts.lastAttemptAgo && priorAttempts.lastStatus
      ? ` (last ${priorAttempts.lastStatus} ${priorAttempts.lastAttemptAgo})`
      : "";
    const timesLabel = priorAttempts.count === 1 ? "time" : "times";
    detail(`Previously attempted: ${priorAttempts.count} ${timesLabel}${timePart}`);
  }
}

/**
 * Build a concise one-line summary from a SelectionExplanation.
 *
 * Examples:
 *   "highest priority, 3 blocked items skipped, unblocks 2 downstream"
 *   "in_progress (resuming), 1 blocker resolved"
 *   "high priority, 5 items skipped"
 */
function formatSelectionSummary(explanation: SelectionExplanation): string {
  const parts: string[] = [];

  // Priority / status context
  if (explanation.summary.includes("already in_progress")) {
    parts.push("resuming in-progress task");
  } else if (explanation.summary.includes("all children completed")) {
    parts.push("all children completed, ready to finalize");
  } else {
    parts.push(`${explanation.priority.itemPriority} priority`);
  }

  // Blocked higher-priority items
  if (explanation.priority.higherPriorityBlocked > 0) {
    const n = explanation.priority.higherPriorityBlocked;
    parts.push(`${n} higher-priority item${n === 1 ? "" : "s"} blocked`);
  }

  // Total skipped (non-trivial)
  const skippedNonDone = explanation.skipped.blocked +
    explanation.skipped.unresolvedDeps +
    explanation.skipped.actionable +
    explanation.skipped.inProgress;
  if (skippedNonDone > 0) {
    parts.push(`${skippedNonDone} item${skippedNonDone === 1 ? "" : "s"} skipped`);
  }

  // Resolved blockers
  if (explanation.dependencies.status === "resolved" && explanation.dependencies.resolvedBlockers.length > 0) {
    const n = explanation.dependencies.resolvedBlockers.length;
    parts.push(`${n} blocker${n === 1 ? "" : "s"} resolved`);
  }

  return parts.join(", ");
}
