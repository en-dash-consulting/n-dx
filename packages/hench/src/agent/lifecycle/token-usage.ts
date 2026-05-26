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

import type { TokenDiagnosticStatus, TokenParseResult, CodexTokenMapping, AggregateTokenUsage } from "../../prd/llm-gateway.js";
import {
  parseApiTokenUsage as parseTokenUsage,
  parseApiTokenUsageWithDiagnostic as parseTokenUsageWithDiagnostic,
  parseStreamTokenUsage,
  parseStreamTokenUsageWithDiagnostic,
  mapCodexUsageToTokenUsage,
  accumulateTokenUsage,
  emptyAggregateTokenUsage,
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
  // Token accumulation (canonical implementation moved to @n-dx/llm-client)
  accumulateTokenUsage,
  emptyAggregateTokenUsage,
};

// Re-export diagnostic and accumulation types for consumers within hench.
export type { TokenDiagnosticStatus, TokenParseResult, CodexTokenMapping, AggregateTokenUsage };

// ── Aggregate token usage ──
// Accumulation functions re-exported from @n-dx/llm-client — the canonical
// implementation used by both hench and rex.

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
