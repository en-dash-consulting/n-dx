/**
 * Detecting a forked task session that refused to edit (GH #473).
 *
 * A fork inherits the orientation transcript, whose first user turn says "Do
 * not modify anything". Even with the lift sentence in front of the brief, an
 * attempt can still treat the session as read-only and end without touching a
 * file. The cached parent is not broken — other forks of the same kind of
 * parent edit fine — so the recovery is one cold re-spawn, not dropping the
 * cache.
 *
 * Detection is structural. Phrase matching on the agent's reply only refines
 * the reported message; it never decides whether the retry happens, because a
 * refusal worded differently must still be caught and a reply that quotes the
 * phrase while editing must not be.
 *
 * @module hench/agent/lifecycle/read-only-refusal
 */

import { isProgressTool } from "../analysis/livelock.js";

/** Reason recorded on the run when a forked attempt refused to edit. */
export const READ_ONLY_REFUSAL_REASON =
  "Agent treated the forked session as read-only (no edits made)";

/** Phrases that show the agent believed it was told not to edit. */
const READ_ONLY_PHRASES: readonly RegExp[] = [
  /read[- ]only/i,
  /not to (?:edit|modify|change)/i,
  /instructions say/i,
  /do not modify/i,
];

export interface ReadOnlyRefusalInput {
  /** True when this attempt forked the warm orientation parent. */
  forked: boolean;
  /** True when completion validation rejected the attempt for having no changes. */
  noChanges: boolean;
  /** Tool names the attempt called. */
  toolNames: readonly string[];
}

/** Number of calls that write to the working tree, in either vendor vocabulary. */
export function countFileEditCalls(toolNames: readonly string[]): number {
  return toolNames.filter(isProgressTool).length;
}

/**
 * True when a forked attempt ended with no diff and never tried to edit.
 *
 * All three are required: a cold attempt has no orientation to inherit, and
 * an attempt that called an edit tool was trying to do the task, so its empty
 * diff is an ordinary failure.
 */
export function isReadOnlyRefusal(input: ReadOnlyRefusalInput): boolean {
  return input.forked && input.noChanges && countFileEditCalls(input.toolNames) === 0;
}

/**
 * The reason to record, quoting the agent's own justification when it gave
 * one that names the read-only instruction.
 */
export function describeReadOnlyRefusal(summary: string | undefined): string {
  const sentence = summary
    ?.split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .find((s) => READ_ONLY_PHRASES.some((p) => p.test(s)));
  if (!sentence) return READ_ONLY_REFUSAL_REASON;
  const quoted = sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence;
  return `${READ_ONLY_REFUSAL_REASON}: "${quoted}"`;
}

/**
 * Appended to the brief of the cold re-spawn, in the place a retry notice goes.
 *
 * The prior attempt wrote nothing, so the usual "files from a prior attempt
 * exist" notice would be false; this one says what actually happened.
 */
export function buildReadOnlyRetryNotice(): string {
  return (
    "\n\n---\nRETRY NOTICE: A previous attempt at this task ended without changing " +
    "any files because it treated its session as read-only. This session is not " +
    "read-only: make the changes the task requires.\n---"
  );
}
