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
 * Whether this project runs prompt-cached, from any run that wrote cache —
 * failed runs included.
 *
 * Deliberately not "is {@link contextWriteFloor} non-zero". The two questions
 * look alike and are not: whether the project's recorded totals *count cache
 * writes* is a property of how its runs were made, while the floor is a
 * measurement that needs a run which survived. Reading one off the other is
 * what made an all-failed prompt-cached run set look uncached, so the workflow
 * tuner compared its 12x-inflated `avgTokensPerRun` against the uncached
 * 100K threshold and fired a suggestion the 1.2M rescale exists to silence.
 */
export function hasCacheWrites(runs: RunRecord[]): boolean {
  return runs.some((run) => (run.tokenUsage?.cacheCreationInput ?? 0) > 0);
}

/**
 * The measured floor any proposed `tokenBudget` must clear.
 *
 * A run pays its initial context write before it does any work, so a budget
 * below that write fails every run on arrival — the failure this floor exists
 * to prevent. The write is not separable from the opening turns of a recorded
 * run: vendor CLIs stream usage per event and the write lands across the first
 * several events, so turn-1 counted cost across `.hench/runs/` ranges 4.8K to
 * 128K on runs whose totals differ by 10x.
 *
 * Measured in two steps, best evidence first:
 *
 * 1. The cheapest *completed, prompt-cached* run in the set. A budget below
 *    that number would have killed a run that finished, which makes it the
 *    strongest floor available.
 * 2. Failing that, the cheapest cache-write component (`cacheCreationInput`)
 *    among the runs that wrote cache. This is the case the floor matters most
 *    in and used to be the case it abandoned: a project whose runs keep
 *    failing had no completed run, so the floor was 0 and every clamp built on
 *    it became `Math.max(x, 0)` — a no-op, in exactly the situation it was
 *    built for. The cache-write component rather than the run's total,
 *    because a failed run's total also carries whatever work it managed
 *    before failing, which is not arrival cost.
 *
 * Step 2 is weaker than step 1, and not in the direction the first version of
 * this comment claimed. `cacheCreationInput` is a run's cache writes summed
 * over every turn, not the arrival write alone, so the cheapest failed run is
 * at least the arrival cost and can be far above it: an upper estimate, not a
 * lower bound. It is safe to raise a budget to, and unsafe to floor a
 * *reduction* with — flooring the high-usage cap with it lifts the cap meant
 * to curb waste up to the cheapest runaway's whole cache-write total. Ask
 * {@link contextWriteFloorFromCompletedRun} before using it that way.
 *
 * Both steps are restricted to prompt-cached runs, because a run with no cache
 * writes never paid a context write; including the pre-caching records (one
 * completed in 21K) would put the floor an order of magnitude below the real
 * arrival cost.
 *
 * Returns 0 only when no run in the set wrote cache at all. Such a project has
 * no observed floor, and inventing one from this repository's numbers would
 * over-constrain it. Ask {@link hasCacheWrites}, not this, to find out whether
 * a run set is prompt-cached.
 */
export function contextWriteFloorFromCompletedRun(runs: RunRecord[]): boolean {
  return runs.some(
    (run) =>
      run.status === "completed" &&
      (run.tokenUsage?.cacheCreationInput ?? 0) > 0 &&
      runBudgetedTokens(run) > 0,
  );
}

export function contextWriteFloor(runs: RunRecord[]): number {
  let completedFloor = 0;
  let cacheWriteFloor = 0;

  for (const run of runs) {
    const cacheWrite = run.tokenUsage?.cacheCreationInput ?? 0;
    if (cacheWrite <= 0) continue;

    cacheWriteFloor = cacheWriteFloor === 0 ? cacheWrite : Math.min(cacheWriteFloor, cacheWrite);

    if (run.status !== "completed") continue;
    const counted = runBudgetedTokens(run);
    if (counted <= 0) continue;
    completedFloor = completedFloor === 0 ? counted : Math.min(completedFloor, counted);
  }

  return completedFloor || cacheWriteFloor;
}

/**
 * Where "high token consumption" starts, in budgeted units, for a run set with
 * no cache writes at all — `avgTokensPerRun` is then still an input + output
 * sum. This is the original threshold, unchanged.
 */
export const HIGH_COUNTED_TOKENS_PER_RUN_UNCACHED = 100_000;

/**
 * Where "high token consumption" starts once any run in the set wrote cache,
 * whatever its status — `avgTokensPerRun` then counts cache writes too.
 *
 * Counting cache writes moved the measure by roughly 12x — across the
 * completed runs in this repository's `.hench/runs/` (2026-09) the median went
 * from 39.5K to 489K — so the uncached number would fire on almost every
 * prompt-cached project. 1.2M keeps it at the same place the uncached
 * threshold used to occupy relative to that population: about 2.5x the median
 * completed run.
 *
 * Gating on whether the set has cache writes, rather than switching globally,
 * matters because a project with no cache writes never gets the 12x
 * inflation: the 100K threshold still fits its `avgTokensPerRun`, and raising
 * it 12x for those runs would silence a suggestion that should fire.
 *
 * Gating on `promptCached` rather than on `contextWriteFloor > 0` matters for
 * the other direction: a project whose cached runs have all failed has no
 * completed run to measure a floor from, but its totals are inflated exactly
 * the same, and comparing them against 100K fired this suggestion on every
 * such project.
 */
export const HIGH_COUNTED_TOKENS_PER_RUN_CACHED = 1_200_000;

/**
 * The high-consumption threshold in the units `runs` are counted in.
 *
 * Gating on {@link hasCacheWrites} rather than on `contextWriteFloor > 0`: a
 * project whose cached runs have all failed has no completed run to measure a
 * floor from, but its totals are inflated exactly the same.
 */
export function highConsumptionThreshold(runs: RunRecord[]): number {
  return hasCacheWrites(runs)
    ? HIGH_COUNTED_TOKENS_PER_RUN_CACHED
    : HIGH_COUNTED_TOKENS_PER_RUN_UNCACHED;
}
