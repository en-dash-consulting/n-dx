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
 */
export function checkTokenBudget(
  usage: TokenUsage,
  budget: number | undefined,
): TokenBudgetResult {
  const { total: totalUsed } = normalizeRunTokens(usage);

  if (!budget) {
    return { exceeded: false, totalUsed, budget: undefined, remaining: 0 };
  }

  const exceeded = totalUsed >= budget;
  const remaining = Math.max(0, budget - totalUsed);

  return { exceeded, totalUsed, budget, remaining };
}
