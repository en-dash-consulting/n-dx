/**
 * How a run's token cost is measured, for the dashboard's tuners.
 *
 * ## Why this is a port and not an import
 *
 * The canonical module is `packages/hench/src/agent/token-cost.ts`. Web sits
 * alongside the orchestration tier and does not depend on hench — there is no
 * hench gateway in `src/server/`, and adding one to reach three pure functions
 * would be an architecture change made incidentally. So the rules are ported
 * here, deliberately, and `tests/e2e/token-cost-parity.test.js` drives both
 * implementations over the same fixtures and fails when they disagree.
 *
 * Keep the two in step: a change to the counting rule, the floor, or the
 * high-consumption thresholds belongs in hench first and here second, and the
 * parity test is what makes the second half non-optional.
 *
 * ## Why it exists at all
 *
 * `routes-adaptive.ts` and `routes-workflow.ts` each carried their own
 * `totalTokens` of `input + output`. On a prompt-cached run that is roughly a
 * twelfth of the budgeted total, because `usage.input` holds only the uncached
 * slice — so a tuner asked to fit a 600K budget proposed something near 125K,
 * below the context write every later run pays on arrival. Unlike hench's own
 * tuners these routes are wired into the dashboard, so an operator could apply
 * that number from a button.
 *
 * @module web/server/token-cost
 */

/** The token classes that count against `hench.tokenBudget`. */
export const BUDGET_TOKEN_CLASSES = "uncached input + cache writes + output";

/** The token usage shape the run records carry. */
export interface RunTokenUsage {
  input?: number;
  output?: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
}

/** The slice of a run record this module reads. */
export interface CountableRun {
  status: string;
  tokenUsage?: RunTokenUsage;
}

/**
 * Count the tokens a run caused to be newly processed: uncached input, cache
 * writes, and output. Cache reads are excluded — a read is by construction a
 * re-read of tokens already counted when they were written, so counting reads
 * charges the same tokens once per turn.
 */
export function countBudgetedTokens(usage: RunTokenUsage | undefined): number {
  return (usage?.input ?? 0) + (usage?.cacheCreationInput ?? 0) + (usage?.output ?? 0);
}

/** {@link countBudgetedTokens} for a whole run record. */
export function runBudgetedTokens(run: CountableRun): number {
  return countBudgetedTokens(run.tokenUsage);
}

/**
 * Whether this project runs prompt-cached, from any run that wrote cache —
 * failed runs included.
 *
 * Deliberately not "is {@link contextWriteFloor} non-zero": whether totals
 * carry cache writes is a property of how the runs were made, while the floor
 * needs a run that survived.
 */
export function hasCacheWrites(runs: CountableRun[]): boolean {
  return runs.some((run) => (run.tokenUsage?.cacheCreationInput ?? 0) > 0);
}

/**
 * The measured floor any proposed `tokenBudget` must clear, in two steps:
 * the cheapest completed prompt-cached run's counted total, and failing that
 * the cheapest cache-write component among the cache-writing runs.
 *
 * A run pays its initial context write before it does any work, so a budget
 * below that write fails every run on arrival. Returns 0 only when no run in
 * the set wrote cache.
 */
export function contextWriteFloor(runs: CountableRun[]): number {
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
 * Where "high token consumption" starts for a run set with no cache writes —
 * `avgTokensPerRun` is then still an input + output sum.
 */
export const HIGH_COUNTED_TOKENS_PER_RUN_UNCACHED = 100_000;

/**
 * Where it starts once any run in the set wrote cache. Counting cache writes
 * moved the measure by roughly 12x, so the uncached number would fire on
 * almost every prompt-cached project.
 */
export const HIGH_COUNTED_TOKENS_PER_RUN_CACHED = 1_200_000;

/** The high-consumption threshold in the units `runs` are counted in. */
export function highConsumptionThreshold(runs: CountableRun[]): number {
  return hasCacheWrites(runs)
    ? HIGH_COUNTED_TOKENS_PER_RUN_CACHED
    : HIGH_COUNTED_TOKENS_PER_RUN_UNCACHED;
}
