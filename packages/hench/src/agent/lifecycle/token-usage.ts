import type { TokenUsage } from "../../schema/index.js";
import {
  parseApiTokenUsage as parseTokenUsage,
  parseStreamTokenUsage,
} from "@n-dx/claude-client";

// Re-export parsing functions from the canonical source (@n-dx/claude-client).
// `parseTokenUsage` is an alias for `parseApiTokenUsage` — same function,
// kept here for backward-compatible imports within hench.
export { parseTokenUsage, parseStreamTokenUsage };

// ── Aggregate token usage ──

/** Aggregated token usage across multiple API calls. */
export interface AggregateTokenUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/** Create an empty AggregateTokenUsage accumulator. */
export function emptyAggregateTokenUsage(): AggregateTokenUsage {
  return { calls: 0, inputTokens: 0, outputTokens: 0 };
}

/**
 * Accumulate a single call's token usage into the aggregate.
 *
 * Always increments the call count, even when `usage` is undefined
 * (e.g. when the API response omitted usage data).
 */
export function accumulateTokenUsage(
  aggregate: AggregateTokenUsage,
  usage?: TokenUsage,
): void {
  aggregate.calls++;
  if (!usage) return;
  aggregate.inputTokens += usage.input;
  aggregate.outputTokens += usage.output;
  if (usage.cacheCreationInput) {
    aggregate.cacheCreationInputTokens =
      (aggregate.cacheCreationInputTokens ?? 0) + usage.cacheCreationInput;
  }
  if (usage.cacheReadInput) {
    aggregate.cacheReadInputTokens =
      (aggregate.cacheReadInputTokens ?? 0) + usage.cacheReadInput;
  }
}

/**
 * Format aggregate token usage for display.
 *
 * Returns empty string when no tokens were used.
 * Single-call usage omits the call count; multi-call includes "across N calls".
 */
export function formatTokenUsage(usage: AggregateTokenUsage): string {
  if (usage.calls === 0 || (usage.inputTokens === 0 && usage.outputTokens === 0)) {
    return "";
  }

  const total = usage.inputTokens + usage.outputTokens;
  const parts = [
    `${total.toLocaleString()} tokens`,
    `(${usage.inputTokens.toLocaleString()} in`,
    `/ ${usage.outputTokens.toLocaleString()} out)`,
  ];

  if (usage.calls > 1) {
    parts.push(`across ${usage.calls} calls`);
  }

  return parts.join(" ");
}
