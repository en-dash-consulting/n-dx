/**
 * Task-boundary divider for the batch session strategy.
 *
 * Batching resumes the previous task's session, so the model receives the next
 * brief as a follow-up turn in a conversation it already had. Without an
 * explicit boundary the second brief reads as a continuation of the first —
 * the model may treat the finished task's plan as still open, or carry
 * decisions across tasks that have nothing to do with each other. That
 * cross-task pollution is the known cost of batching, and this divider is the
 * stated mitigation.
 *
 * It is deliberately emphatic rather than decorative: it names the previous
 * task as finished and committed, and instructs the model to treat prior turns
 * as background only. A subtle marker would be cheaper and would not work.
 *
 * @module hench/agent/lifecycle/batch-divider
 */

export interface TaskBoundaryDividerInput {
  /** Position of the incoming task within this session, 1-based. */
  taskNumber: number;
  /** Tasks this session may serve in total. */
  tasksPerSession: number;
  /** Title of the task that just finished, when known. */
  previousTaskTitle?: string;
}

/**
 * Build the divider prepended to a brief delivered as a follow-up turn.
 *
 * Never used for the first task in a session: there is no prior context to
 * separate from, and prepending it would describe a boundary that does not
 * exist.
 */
export function buildTaskBoundaryDivider(input: TaskBoundaryDividerInput): string {
  const { taskNumber, tasksPerSession, previousTaskTitle } = input;
  const finished = previousTaskTitle
    ? `The previous task ("${previousTaskTitle}") is finished and committed.`
    : "The previous task is finished and committed.";

  return [
    "",
    "═".repeat(72),
    `NEW TASK — task ${taskNumber} of up to ${tasksPerSession} in this session`,
    "═".repeat(72),
    "",
    finished,
    "Do not continue it, revisit its decisions, or re-open its plan.",
    "",
    "Everything earlier in this conversation is background only: it tells you how",
    "this repository is laid out and how to build and test it. Treat the brief",
    "below as a fresh assignment, and re-read any file you intend to change —",
    "the working tree has moved since those earlier turns.",
    "",
    "═".repeat(72),
    "",
  ].join("\n");
}
