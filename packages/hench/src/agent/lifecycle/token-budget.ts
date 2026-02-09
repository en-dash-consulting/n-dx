import type { TokenUsage } from "../../schema/index.js";

export interface TokenBudgetResult {
  /** Whether the token budget has been met or exceeded. */
  exceeded: boolean;
  /** Total tokens consumed (input + output). */
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
 * The budget is measured against total tokens (input + output combined).
 */
export function checkTokenBudget(
  usage: TokenUsage,
  budget: number | undefined,
): TokenBudgetResult {
  const totalUsed = usage.input + usage.output;

  if (!budget) {
    return { exceeded: false, totalUsed, budget: undefined, remaining: 0 };
  }

  const exceeded = totalUsed >= budget;
  const remaining = Math.max(0, budget - totalUsed);

  return { exceeded, totalUsed, budget, remaining };
}
