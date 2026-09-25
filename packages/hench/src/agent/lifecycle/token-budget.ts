import type { TokenUsage } from "../../schema/index.js";

/** The token classes that count against `hench.tokenBudget`. */
export const BUDGET_TOKEN_CLASSES = "uncached input + cache writes + output";

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
 * The budget counts the tokens a run caused to be *newly* processed: uncached
 * input, cache writes, and output. Cache reads are excluded.
 *
 * Both halves of that rule are load-bearing:
 *
 * - Cached input MUST be counted, or the budget stops applying. On a
 *   prompt-cached loop `usage.input` holds only the uncached slice — one
 *   83-turn run recorded 534 uncached input tokens against 876K cache writes,
 *   so an `input + output` total bounds output plus a rounding error.
 *
 * - Cache reads MUST NOT be counted, or the budget fires on healthy runs. A
 *   cache read is by construction a re-read of tokens already counted when
 *   they were written, so counting reads charges the same tokens once per
 *   turn. Across the 27 recorded runs in this repository (`.hench/runs/`,
 *   2026-09) face value ran a median of 70x the counted total — a Claude Code
 *   session reading millions of cached tokens tripped every built-in template
 *   budget after finishing its work, and the task was reset to pending before
 *   the review and commit steps.
 *
 * This is a double-counting argument, not a pricing one: the rule needs no
 * price table and stays vendor-neutral. Runaway loops are still bounded,
 * because cache writes and output both grow with turn count.
 */
export function checkTokenBudget(
  usage: TokenUsage,
  budget: number | undefined,
): TokenBudgetResult {
  const totalUsed =
    (usage?.input ?? 0) + (usage?.cacheCreationInput ?? 0) + (usage?.output ?? 0);
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
