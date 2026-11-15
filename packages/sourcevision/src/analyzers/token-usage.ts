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

/**
 * Add a step's call count and input/output tokens to the aggregate — the
 * shape judgment, naming and narration steps report. Cache token counts are
 * not added.
 */
export function addCallUsage(
  aggregate: AnalyzeTokenUsage,
  calls: number,
  usage?: { input: number; output: number },
): void {
  aggregate.calls += calls;
  aggregate.inputTokens += usage?.input ?? 0;
  aggregate.outputTokens += usage?.output ?? 0;
}

/** Merge one aggregate into another, cache token counts included. */
export function mergeTokenUsage(target: AnalyzeTokenUsage, source: AnalyzeTokenUsage): void {
  target.calls += source.calls;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  if (source.cacheCreationInputTokens) {
    target.cacheCreationInputTokens =
      (target.cacheCreationInputTokens ?? 0) + source.cacheCreationInputTokens;
  }
  if (source.cacheReadInputTokens) {
    target.cacheReadInputTokens =
      (target.cacheReadInputTokens ?? 0) + source.cacheReadInputTokens;
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
