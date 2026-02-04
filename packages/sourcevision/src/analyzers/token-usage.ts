/**
 * Token usage tracking utilities for sourcevision analyze.
 * Mirrors the pattern from rex's analyze token tracking.
 */

import type { TokenUsage, AnalyzeTokenUsage } from "../schema/index.js";

/** Create an empty AnalyzeTokenUsage accumulator. */
export function emptyAnalyzeTokenUsage(): AnalyzeTokenUsage {
  return { calls: 0, inputTokens: 0, outputTokens: 0 };
}

/** Accumulate a single call's token usage into the aggregate. */
export function accumulateTokenUsage(
  aggregate: AnalyzeTokenUsage,
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

/** Format token usage for display. Returns empty string when no tokens were used. */
export function formatTokenUsage(usage: AnalyzeTokenUsage): string {
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
    parts.push(`across ${usage.calls} LLM calls`);
  }

  return parts.join(" ");
}
