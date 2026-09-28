import type { TokenUsage } from "../../schema/index.js";
import { BUDGET_TOKEN_CLASSES, countBudgetedTokens } from "../token-cost.js";

// Re-exported from its new home so existing importers of this module keep
// resolving it. The definition lives beside the counter it describes.
export { BUDGET_TOKEN_CLASSES };

export interface TokenBudgetResult {
  /** Whether the token budget has been met or exceeded. */
  exceeded: boolean;
  /** Counted tokens: uncached input + cache writes + output. */
  totalUsed: number;
  /** Cache-read tokens seen but deliberately excluded from `totalUsed`. */
  cacheReadNotCounted: number;
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
 * The budget counts what {@link countBudgetedTokens} counts — uncached input,
 * cache writes, and output, excluding cache reads. That measure is shared with
 * the adaptive and workflow tuners so a proposed budget and an enforced one
 * are in the same units; see `agent/token-cost.ts` for why each class is in or
 * out. Runaway loops are still bounded, because cache writes and output both
 * grow with turn count.
 *
 * Counting cache reads used to make this fire on healthy runs: a Claude Code
 * session reading millions of cached tokens tripped every built-in template
 * budget after finishing its work, and the task was reset to pending before
 * the review and commit steps.
 */
export function checkTokenBudget(
  usage: TokenUsage,
  budget: number | undefined,
): TokenBudgetResult {
  const totalUsed = countBudgetedTokens(usage);
  const cacheReadNotCounted = usage?.cacheReadInput ?? 0;

  if (!budget) {
    return { exceeded: false, totalUsed, cacheReadNotCounted, budget: undefined, remaining: 0 };
  }

  const exceeded = totalUsed >= budget;
  const remaining = Math.max(0, budget - totalUsed);

  return { exceeded, totalUsed, cacheReadNotCounted, budget, remaining };
}

/**
 * Render the operator-facing budget-exceeded message.
 *
 * Names the token classes that counted, and how many cache-read tokens were
 * seen but excluded, so an operator can tell a genuine overrun from the
 * cache-read inflation this check used to mistake for one.
 */
export function formatBudgetExceeded(result: TokenBudgetResult): string {
  const note = result.cacheReadNotCounted > 0
    ? `; ${result.cacheReadNotCounted.toLocaleString("en-US")} cache-read tokens not counted`
    : "";
  return (
    `Token budget exceeded: ${result.totalUsed.toLocaleString("en-US")} of ` +
    `${(result.budget ?? 0).toLocaleString("en-US")} (${BUDGET_TOKEN_CLASSES}${note})`
  );
}
