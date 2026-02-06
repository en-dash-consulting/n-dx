import type { TokenUsage } from "../schema/index.js";

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

// ── Parsing ──

/**
 * Parse token usage from an Anthropic API SDK response `usage` object.
 *
 * The SDK response always has `input_tokens` / `output_tokens` at the top level.
 * Cache fields (`cache_creation_input_tokens`, `cache_read_input_tokens`) are
 * present on some models/versions but not typed in the SDK, so we extract them
 * from the raw object.
 *
 * Always returns a TokenUsage — missing numeric fields default to 0.
 * Cache fields are omitted when zero or absent.
 */
export function parseTokenUsage(
  raw: Record<string, unknown>,
): TokenUsage {
  const input = typeof raw.input_tokens === "number" ? raw.input_tokens : 0;
  const output = typeof raw.output_tokens === "number" ? raw.output_tokens : 0;

  const result: TokenUsage = { input, output };

  const cacheCreation = raw.cache_creation_input_tokens;
  if (typeof cacheCreation === "number" && cacheCreation > 0) {
    result.cacheCreationInput = cacheCreation;
  }

  const cacheRead = raw.cache_read_input_tokens;
  if (typeof cacheRead === "number" && cacheRead > 0) {
    result.cacheReadInput = cacheRead;
  }

  return result;
}

/**
 * Parse token usage from a CLI stream-json event.
 *
 * Claude CLI stream-json events may include token usage:
 * - At the top level: `input_tokens`, `output_tokens`
 * - As fallback: `total_input_tokens`, `total_output_tokens`
 * - Inside a nested `usage` object (some CLI versions)
 *
 * Prefers `input_tokens` over `total_input_tokens`.
 * Prefers top-level fields over nested `usage` object.
 * Returns `undefined` when no token fields are found.
 * Cache fields are omitted when zero or absent.
 */
export function parseStreamTokenUsage(
  obj: Record<string, unknown>,
): TokenUsage | undefined {
  // Try direct fields first (prefer input_tokens over total_input_tokens)
  let input = obj.input_tokens ?? obj.total_input_tokens;
  let output = obj.output_tokens ?? obj.total_output_tokens;
  let cacheCreation = obj.cache_creation_input_tokens;
  let cacheRead = obj.cache_read_input_tokens;

  // Try nested usage object (stream-json format) — only if top-level has nothing
  if (
    typeof input !== "number" &&
    typeof output !== "number" &&
    obj.usage &&
    typeof obj.usage === "object"
  ) {
    const usage = obj.usage as Record<string, unknown>;
    input = usage.input_tokens ?? usage.total_input_tokens;
    output = usage.output_tokens ?? usage.total_output_tokens;
    cacheCreation = usage.cache_creation_input_tokens;
    cacheRead = usage.cache_read_input_tokens;
  }

  if (typeof input !== "number" && typeof output !== "number") {
    return undefined;
  }

  const result: TokenUsage = {
    input: typeof input === "number" ? input : 0,
    output: typeof output === "number" ? output : 0,
  };

  if (typeof cacheCreation === "number" && cacheCreation > 0) {
    result.cacheCreationInput = cacheCreation;
  }
  if (typeof cacheRead === "number" && cacheRead > 0) {
    result.cacheReadInput = cacheRead;
  }

  return result;
}
