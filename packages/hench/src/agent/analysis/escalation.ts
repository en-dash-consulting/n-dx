/**
 * Escalating a task that keeps failing to a stronger vendor or model before it
 * is skipped as stuck (`hench.escalation.*`).
 *
 * WHY. After `hench.maxFailedAttempts` consecutive failures a task is skipped
 * as stuck, which only postpones it: the next invocation picks it up on the
 * same model and fails the same way. A local model that cannot finish a task
 * is the common case. With escalation on, the attempt after `after` failures
 * runs on `vendor` (and `model`), and only when `maxAttempts` escalated
 * attempts have also failed does the stuck logic skip the task.
 *
 * Pure: decided from the run history (most recent first), so a loop, a later
 * invocation and `ndx work --resolve` all reach the same answer.
 */

import type { EscalationConfig, RunRecord } from "../../schema/index.js";
import { DEFAULT_ESCALATION_AFTER, DEFAULT_ESCALATION_MAX_ATTEMPTS } from "../../schema/index.js";
import { countRecentFailures, isCountedFailure } from "./stuck.js";

/** `hench.escalation.*` with its defaults applied; only produced when escalation can happen. */
export interface ActiveEscalation {
  after: number;
  vendor: NonNullable<EscalationConfig["vendor"]>;
  model?: string;
  maxAttempts: number;
}

/**
 * The escalation settings in force, or undefined when escalation is off or has
 * no vendor to escalate to — in which case nothing about selection or
 * stuck-task handling changes.
 */
export function activeEscalation(config: EscalationConfig | undefined): ActiveEscalation | undefined {
  if (config?.enabled !== true || !config.vendor) return undefined;
  const model = config.model?.trim();
  return {
    after: config.after ?? DEFAULT_ESCALATION_AFTER,
    vendor: config.vendor,
    ...(model ? { model } : {}),
    maxAttempts: config.maxAttempts ?? DEFAULT_ESCALATION_MAX_ATTEMPTS,
  };
}

/**
 * Failures in the task's current streak that were themselves escalated
 * attempts. Same walk as {@link countRecentFailures}: most recent first,
 * stopping at the first run that did not fail.
 */
export function countEscalatedFailures(taskId: string, runs: RunRecord[]): number {
  let count = 0;
  for (const run of runs) {
    if (run.taskId !== taskId) continue;
    const counted = isCountedFailure(run);
    if (counted === undefined) continue;
    if (!counted) break;
    if (run.escalation?.escalated === true) count++;
  }
  return count;
}

/**
 * The failure count that triggers escalation: `after`, or the stuck threshold
 * when that is lower — a task about to be skipped as stuck is escalated first,
 * so a threshold below `after` cannot make escalation unreachable.
 */
function triggerAt(escalation: ActiveEscalation, stuckThreshold: number): number {
  return stuckThreshold > 0 ? Math.min(escalation.after, stuckThreshold) : escalation.after;
}

export interface EscalationDecision {
  /** Whether the task's next attempt runs on the escalation vendor/model. */
  escalate: boolean;
  /** Consecutive failed attempts in the task's current streak. */
  failures: number;
  /** How many of those were escalated attempts. */
  escalatedFailures: number;
  /** The settings it escalates to; set when {@link escalate} is. */
  escalation?: ActiveEscalation;
  /** One line for the log and the run record; set when {@link escalate} is. */
  reason?: string;
}

/**
 * Whether `taskId`'s next attempt is escalated: escalation is on with a
 * vendor, the task has failed at least `after` times in a row (or reached the
 * stuck threshold), and fewer than `maxAttempts` of those failures were
 * already escalated.
 */
export function decideEscalation(
  taskId: string,
  runs: RunRecord[],
  config: EscalationConfig | undefined,
  stuckThreshold: number,
): EscalationDecision {
  const escalation = activeEscalation(config);
  const failures = countRecentFailures(taskId, runs);
  const escalatedFailures = escalation ? countEscalatedFailures(taskId, runs) : 0;
  if (!escalation || failures < triggerAt(escalation, stuckThreshold) || escalatedFailures >= escalation.maxAttempts) {
    return { escalate: false, failures, escalatedFailures };
  }
  const attempt = escalatedFailures + 1;
  return {
    escalate: true,
    failures,
    escalatedFailures,
    escalation,
    reason:
      `${failures} consecutive failed attempt${failures === 1 ? "" : "s"}; ` +
      `escalated attempt ${attempt} of ${escalation.maxAttempts}`,
  };
}

/**
 * True while an escalation is still owed to `taskId`: escalation is on and
 * fewer than `maxAttempts` escalated attempts have failed. Stuck-task
 * detection holds such a task back from being skipped.
 */
export function isEscalationPending(
  taskId: string,
  runs: RunRecord[],
  config: EscalationConfig | undefined,
): boolean {
  const escalation = activeEscalation(config);
  if (!escalation) return false;
  return countEscalatedFailures(taskId, runs) < escalation.maxAttempts;
}
