/**
 * Spawn accounting for a single task.
 *
 * ## The multiplication this exists to stop
 *
 * A task had three independent allowances that multiplied rather than added:
 * four retry attempts, up to two plan-mode re-spawns *per attempt* which did
 * not count against the retry budget, and an outer tracker granting the same
 * task three whole runs. Worst case, one task could cold-spawn twelve times in
 * a run — each spawn re-paying the harness prompt, the project instructions,
 * and the repo re-exploration.
 *
 * The fix is not a smaller retry count. It is making every spawn draw from one
 * visible budget, so the allowances add up instead of compounding, and a task
 * that keeps failing stops at a number an operator can predict.
 *
 * ## Why a hard cap on top of the budget
 *
 * The retry budget is consumed by paths that *know* they are retrying. Some
 * re-spawns do not: the stale-parent fork fallback and any future
 * non-budget-consuming re-spawn deliberately avoid charging the retry budget
 * because nothing was learned about the task. The hard cap is the backstop
 * that counts spawns regardless of why they happened, so no future re-spawn
 * path can reintroduce unbounded multiplication by simply not asking.
 *
 * @module hench/agent/lifecycle/spawn-budget
 */

/**
 * Default ceiling on spawns for one task.
 *
 * Sized to fit the legitimate worst case rather than the old multiplied one:
 * the initial spawn, three retries, and a couple of re-spawns that did not
 * charge the retry budget (a plan-mode interception, a stale-parent fallback).
 */
export const DEFAULT_MAX_SPAWNS_PER_TASK = 8;

/** Why a spawn was made — recorded so retry overhead is attributable. */
export type SpawnReason =
  | "initial"
  | "retry"
  | "plan-respawn"
  | "fork-fallback";

export interface SpawnLedger {
  /** Total spawns made for this task. */
  total: number;
  /** Count per reason, for the run record. */
  byReason: Record<SpawnReason, number>;
  /** Ceiling in force. */
  limit: number;
}

export function createSpawnLedger(limit = DEFAULT_MAX_SPAWNS_PER_TASK): SpawnLedger {
  return {
    total: 0,
    byReason: { initial: 0, retry: 0, "plan-respawn": 0, "fork-fallback": 0 },
    limit: limit > 0 ? limit : DEFAULT_MAX_SPAWNS_PER_TASK,
  };
}

/** Record a spawn. Returns the ledger for chaining. */
export function recordSpawn(ledger: SpawnLedger, reason: SpawnReason): SpawnLedger {
  ledger.total += 1;
  ledger.byReason[reason] += 1;
  return ledger;
}

/**
 * True when another spawn would exceed the ceiling.
 *
 * Checked *before* spawning rather than after, so the cap is a refusal to
 * spend rather than a report that the spending already happened.
 */
export function spawnBudgetExhausted(ledger: SpawnLedger): boolean {
  return ledger.total >= ledger.limit;
}

/**
 * Operator-facing explanation of an exhausted budget.
 *
 * Names the breakdown, because "8 spawns" and "8 spawns, 6 of them plan-mode
 * re-spawns" call for entirely different fixes.
 */
export function describeSpawnBudget(ledger: SpawnLedger): string {
  const parts = (Object.entries(ledger.byReason) as Array<[SpawnReason, number]>)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason}=${count}`);
  return `${ledger.total}/${ledger.limit} spawns (${parts.join(", ")})`;
}
