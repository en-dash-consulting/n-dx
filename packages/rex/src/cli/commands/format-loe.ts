/**
 * Shared LoE display formatting for proposal review.
 *
 * Used by analyze, smart-add, and chunked-review to render LoE labels
 * consistently across interactive and non-interactive modes.
 *
 * @module rex/cli/commands/format-loe
 */

import type { ProposalTask } from "../../analyze/index.js";

/**
 * Format an inline LoE label for a task. Returns empty string if no LoE data.
 *
 * - Normal: ` (LoE: 1.5w)`
 * - Over threshold: ` (LoE: 4w ⚠ exceeds 2w threshold)`
 * - No LoE: ``
 */
export function formatTaskLoE(
  task: ProposalTask,
  thresholdWeeks?: number,
): string {
  if (task.loe === undefined) return "";

  const loeLabel = `${task.loe}w`;

  if (thresholdWeeks !== undefined && task.loe > thresholdWeeks) {
    return ` (LoE: ${loeLabel} ⚠ exceeds ${thresholdWeeks}w threshold)`;
  }

  return ` (LoE: ${loeLabel})`;
}

/**
 * Format a rationale line for a task. Returns empty string if no rationale.
 * Intended to be printed as an indented line below the task title.
 */
export function formatTaskLoERationale(
  task: ProposalTask,
  indent: string,
): string {
  if (!task.loeRationale) return "";
  const confidence = task.loeConfidence ? ` [${task.loeConfidence}]` : "";
  return `${indent}LoE rationale: ${task.loeRationale}${confidence}`;
}
