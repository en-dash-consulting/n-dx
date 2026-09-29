/**
 * How a run's token cost is measured, in one place.
 *
 * Everything that enforces or proposes a `hench.tokenBudget` counts through
 * {@link countBudgetedTokens}. Before this module the enforcement side
 * (`checkTokenBudget`) and the proposal side (the adaptive and workflow
 * tuners) counted different things: the tuners summed input + output, which on
 * a prompt-cached run is roughly a twelfth of the budgeted total, so a tuner
 * asked to fit a 600K budget proposed something near 125K — below the initial
 * context write, which every later run would then fail on arrival.
 *
 * Pure functions over recorded run data. No I/O.
 */

import type { RunRecord, TokenUsage } from "../schema/index.js";

/** The token classes that count against `hench.tokenBudget`. */
export const BUDGET_TOKEN_CLASSES = "uncached input + cache writes + output";

/**
 * Count the tokens a run caused to be *newly* processed: uncached input,
 * cache writes, and output. Cache reads are excluded.
 *
 * Both halves of that rule are load-bearing:
 *
 * - Cached input MUST be counted, or the measure stops tracking cost. On a
 *   prompt-cached loop `usage.input` holds only the uncached slice — one
 *   83-turn run recorded 534 uncached input tokens against 876K cache writes,
 *   so an `input + output` total bounds output plus a rounding error.
 *
 * - Cache reads MUST NOT be counted, or the measure inflates on healthy runs.
 *   A cache read is by construction a re-read of tokens already counted when
 *   they were written, so counting reads charges the same tokens once per
 *   turn. Across the recorded runs in this repository (`.hench/runs/`, 2026-09)
 *   face value ran a median of 70x the counted total.
 *
 * This is a double-counting argument, not a pricing one: the rule needs no
 * price table and stays vendor-neutral.
 *
 * Accepts `undefined` and missing cache fields so it can be called on legacy
 * run records without a guard at every call site.
 */
export function countBudgetedTokens(usage: TokenUsage | undefined): number {
  return (usage?.input ?? 0) + (usage?.cacheCreationInput ?? 0) + (usage?.output ?? 0);
}

/** {@link countBudgetedTokens} for a whole run record. */
export function runBudgetedTokens(run: RunRecord): number {
  return countBudgetedTokens(run.tokenUsage);
}

/**
 * The measured floor any proposed `tokenBudget` must clear.
 *
 * A run pays its initial context write before it does any work, so a budget
 * below that write fails every run on arrival — the failure this floor exists
 * to prevent. The write is not separable from the opening turns of a recorded
 * run: vendor CLIs stream usage per event and the write lands across the first
 * several events, so turn-1 counted cost across `.hench/runs/` ranges 4.8K to
 * 128K on runs whose totals differ by 10x. It is therefore measured here as
 * the cheapest *completed, prompt-cached* run in the set — a budget below that
 * number would have killed a run that finished.
 *
 * Restricted to prompt-cached runs because a run with no cache writes never
 * paid a context write, and including the pre-caching records (one completed
 * in 21K) would put the floor an order of magnitude below the real arrival
 * cost.
 *
 * Returns 0 when there is nothing to measure — no completed prompt-cached run
 * in the set. A project with no such history has no observed floor, and
 * inventing one from this repository's numbers would over-constrain it.
 */
export function contextWriteFloor(runs: RunRecord[]): number {
  let floor = 0;
  for (const run of runs) {
    if (run.status !== "completed") continue;
    if ((run.tokenUsage?.cacheCreationInput ?? 0) <= 0) continue;
    const counted = runBudgetedTokens(run);
    if (counted <= 0) continue;
    floor = floor === 0 ? counted : Math.min(floor, counted);
  }
  return floor;
}
