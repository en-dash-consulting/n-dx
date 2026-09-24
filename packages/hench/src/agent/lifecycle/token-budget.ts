import { normalizeRunTokens } from "../../schema/index.js";
import type { TokenUsage } from "../../schema/index.js";

export interface TokenBudgetResult {
  /** Whether the token budget has been met or exceeded. */
  exceeded: boolean;
  /** Total tokens consumed (uncached input + cache writes + cache reads + output). */
  totalUsed: number;
  /** The configured budget (undefined if unlimited). */
  budget: number | undefined;
  /** Tokens remaining before budget is hit (0 if exceeded or unlimited). */
  remaining: number;
}

export interface TokenBudgetOptions {
  /**
   * Leave cache reads out of the total.
   *
   * For the CLI provider's post-run check only. That check cannot stop a run
   * — it fires after the run finished, and its only effect is to mark a
   * *successful* run `budget_exceeded` and reset the task before review and
   * commit. A Claude Code session re-reads its cached prefix every turn, so
   * cache reads grow with turns × context into the millions regardless of how
   * much new work the run did; counted at face value they make every
   * configured budget read as "always exceeded". Uncached input, cache writes
   * and output — the tokens that would have been `input + output` before
   * caching existed — still count.
   */
  excludeCacheReads?: boolean;
}

/**
 * Check whether a token budget has been exceeded.
 *
 * A budget of 0 or undefined means unlimited — the check always passes.
 *
 * The budget is measured against every token the run processed: uncached
 * input, cache writes, cache reads, and output, all at face value. Cached
 * input MUST be counted. On a prompt-cached loop `usage.input` holds only the
 * uncached slice — one 83-turn run recorded 534 uncached input tokens against
 * 876K cache writes and 34.1M cache reads — so an `input + output` total
 * bounds output plus a rounding error and the budget stops applying.
 *
 * Face value rather than cost weighting keeps the number vendor-neutral and
 * free of any price table, and preserves the meaning it had before prompt
 * caching existed: tokens processed per run.
 *
 * The one exception is {@link TokenBudgetOptions.excludeCacheReads}, for the
 * post-run check where the budget cannot bound anything and would only punish
 * a finished run for its cache traffic.
 */
export function checkTokenBudget(
  usage: TokenUsage,
  budget: number | undefined,
  options: TokenBudgetOptions = {},
): TokenBudgetResult {
  const { total } = normalizeRunTokens(usage);
  const totalUsed = options.excludeCacheReads ? total - (usage?.cacheReadInput ?? 0) : total;

  if (!budget) {
    return { exceeded: false, totalUsed, budget: undefined, remaining: 0 };
  }

  const exceeded = totalUsed >= budget;
  const remaining = Math.max(0, budget - totalUsed);

  return { exceeded, totalUsed, budget, remaining };
}
