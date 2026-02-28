/**
 * Token usage parsing utilities.
 *
 * Handles both Anthropic SDK response format and CLI stream-json format,
 * providing a single consistent TokenUsage shape.
 */

import type { TokenUsage } from "./types.js";

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
export function parseApiTokenUsage(
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
 * Parse token usage from a Claude CLI JSON envelope.
 *
 * Claude CLI --output-format json includes usage fields at the top level:
 * `input_tokens` / `total_input_tokens`, `output_tokens` / `total_output_tokens`.
 *
 * Returns undefined when no token fields are found.
 * Cache fields are omitted when zero or absent.
 */
export function parseCliTokenUsage(
  envelope: Record<string, unknown>,
): TokenUsage | undefined {
  const input = envelope.input_tokens ?? envelope.total_input_tokens;
  const output = envelope.output_tokens ?? envelope.total_output_tokens;

  if (typeof input !== "number" && typeof output !== "number") {
    return undefined;
  }

  const usage: TokenUsage = {
    input: typeof input === "number" ? input : 0,
    output: typeof output === "number" ? output : 0,
  };

  const cacheCreation = envelope.cache_creation_input_tokens;
  const cacheRead = envelope.cache_read_input_tokens;
  if (typeof cacheCreation === "number" && cacheCreation > 0) {
    usage.cacheCreationInput = cacheCreation;
  }
  if (typeof cacheRead === "number" && cacheRead > 0) {
    usage.cacheReadInput = cacheRead;
  }

  return usage;
}

/**
 * Parse token usage from a CLI stream-json event.
 *
 * Stream-json events may include token usage:
 * - At the top level: `input_tokens`, `output_tokens`
 * - As fallback: `total_input_tokens`, `total_output_tokens`
 * - Inside a nested `usage` object (some CLI versions)
 *
 * Prefers `input_tokens` over `total_input_tokens`.
 * Prefers top-level fields over nested `usage` object.
 * Returns undefined when no token fields are found.
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
