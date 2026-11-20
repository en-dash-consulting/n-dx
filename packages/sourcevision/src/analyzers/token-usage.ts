/**
 * Token usage tracking utilities for sourcevision analyze.
 *
 * The empty aggregate and the per-call accumulator are llm-client's, shared
 * with rex and hench: {@link AnalyzeTokenUsage} is its `AggregateTokenUsage`
 * plus the vendor and model the manifest records.
 */

import { accumulateTokenUsage, emptyAggregateTokenUsage } from "@n-dx/llm-client";
import type { AnalyzeTokenUsage } from "../schema/index.js";

export { accumulateTokenUsage };

/** Create an empty AnalyzeTokenUsage accumulator. */
export function emptyAnalyzeTokenUsage(): AnalyzeTokenUsage {
  return emptyAggregateTokenUsage();
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

/**
 * Add one call's input/output tokens to a step's running total; nothing when
 * the call reported no usage. Cache token counts are not added.
 */
export function addCallTokens(
  total: { input: number; output: number },
  usage?: { input: number; output: number },
): void {
  if (!usage) return;
  total.input += usage.input;
  total.output += usage.output;
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
