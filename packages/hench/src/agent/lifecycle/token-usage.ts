/**
 * Token usage utilities for the hench agent loop.
 *
 * This module re-exports canonical parsing functions from @n-dx/llm-client
 * via the llm-gateway, and provides hench-specific aggregation and
 * formatting utilities.
 *
 * ## Vendor-neutral diagnostics
 *
 * Token parsing uses the shared {@link TokenDiagnosticStatus} type from
 * `@n-dx/llm-client/runtime-contract` instead of hench-local string
 * literals. The `CodexTokenMapping` type is re-exported from the foundation
 * layer and uses `diagnosticStatus` instead of the previous `diagnostic`
 * field, making Codex usage diagnostics part of the same taxonomy as
 * Claude's diagnostic-aware parsers.
 */

import type { TokenUsage } from "../../schema/index.js";
import type { TokenDiagnosticStatus, TokenParseResult, CodexTokenMapping } from "../../prd/llm-gateway.js";
import {
  parseApiTokenUsage as parseTokenUsage,
  parseApiTokenUsageWithDiagnostic as parseTokenUsageWithDiagnostic,
  parseStreamTokenUsage,
  parseStreamTokenUsageWithDiagnostic,
  mapCodexUsageToTokenUsage,
} from "../../prd/llm-gateway.js";

// Re-export parsing functions from the canonical source (@n-dx/llm-client).
// `parseTokenUsage` is an alias for `parseApiTokenUsage` — same function,
// kept here for backward-compatible imports within hench.
export {
  parseTokenUsage,
  parseTokenUsageWithDiagnostic,
  parseStreamTokenUsage,
  parseStreamTokenUsageWithDiagnostic,
  mapCodexUsageToTokenUsage,
};

// Re-export diagnostic types for consumers within hench.
export type { TokenDiagnosticStatus, TokenParseResult, CodexTokenMapping };

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
