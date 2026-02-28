import type { TokenUsage } from "../../schema/index.js";
import {
  parseApiTokenUsage as parseTokenUsage,
  parseStreamTokenUsage,
} from "@n-dx/llm-client";

// Re-export parsing functions from the canonical source (@n-dx/llm-client).
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

export type CodexUsageDiagnostic = "codex_usage_missing";

export interface CodexTokenMapping {
  usage: TokenUsage;
  total: number;
  diagnostic?: CodexUsageDiagnostic;
}

function asUsageRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Map Codex usage payload fields into Hench's shared token usage shape.
 *
 * Explicit field mapping:
 * - input: `input_tokens` | `prompt_tokens`
 * - output: `output_tokens` | `completion_tokens`
 * - total: `total_tokens` fallback, otherwise `input + output`
 *
 * When usage is missing, returns zeros and a non-fatal diagnostic flag.
 */
export function mapCodexUsageToTokenUsage(raw: unknown): CodexTokenMapping {
  const top = asUsageRecord(raw);
  const usage = asUsageRecord(top?.usage)
    ?? asUsageRecord(asUsageRecord(top?.response)?.usage)
    ?? asUsageRecord(asUsageRecord(top?.data)?.usage);

  if (!usage && !top) {
    return {
      usage: { input: 0, output: 0 },
      total: 0,
      diagnostic: "codex_usage_missing",
    };
  }

  const source = usage ?? top ?? {};

  const input = readNumber(source, ["input_tokens", "prompt_tokens", "input"]) ?? 0;
  const output = readNumber(source, ["output_tokens", "completion_tokens", "output"]) ?? 0;
  const total = readNumber(source, ["total_tokens", "total"]) ?? (input + output);

  const hasUsageFields = usage
    ? input > 0 || output > 0 || total > 0
    : readNumber(source, ["input_tokens", "prompt_tokens", "output_tokens", "completion_tokens", "total_tokens"]) !== undefined;

  return {
    usage: { input, output },
    total,
    ...(hasUsageFields ? {} : { diagnostic: "codex_usage_missing" }),
  };
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
