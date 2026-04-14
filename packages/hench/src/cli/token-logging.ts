/**
 * Standardized token usage logging for both Codex and Claude vendors.
 *
 * Provides consistent formatting with right-aligned, padded token values
 * and uniform handling of missing or unavailable token data.
 *
 * Format:
 *   tokens_in:  123456
 *   tokens_out: 654321
 *
 * Missing/unavailable data:
 *   tokens_in:  —
 *   tokens_out: —
 */

import type { TokenUsage } from "../schema/index.js";

/**
 * Minimal token count interface (used for type checking and testing).
 * Matches the shape of TokenUsage but with only required fields.
 */
export interface TokenCount {
  input: number;
  output: number;
}

/**
 * Represents token availability status.
 */
export type TokenAvailability = "available" | "unavailable";

/**
 * Compute the minimum field width needed to display all token values
 * with consistent padding across both vendors.
 *
 * This ensures that whether we have 1000 input tokens and 500 output tokens,
 * or 0 tokens (unavailable), the formatting stays aligned.
 *
 * Minimum width accommodates:
 * - Typical values: 6-7 digits
 * - Fallback indicator "—": 1 char
 * Padding: 8 chars (provides visual separation)
 */
const DEFAULT_FIELD_WIDTH = 8;

/**
 * Format token count for consistent right-aligned display.
 *
 * @param count Token value or null/undefined (treated as unavailable)
 * @param width Field width for right-alignment (default 8)
 * @returns Right-aligned, padded token value or "—" if unavailable
 */
function formatTokenValue(count: number | null | undefined, width: number = DEFAULT_FIELD_WIDTH): string {
  if (count === null || count === undefined || count < 0) {
    return "—".padStart(width);
  }
  return count.toLocaleString().padStart(width);
}

/**
 * Format a complete token usage report for a run.
 *
 * Returns a formatted block with two lines: tokens_in and tokens_out.
 * Both vendors (Codex and Claude) produce identical format and structure.
 *
 * @param tokens Token usage (input/output counts, or null for unavailable)
 * @returns Multi-line formatted string suitable for info() output
 *
 * @example
 * formatTokenReport({ input: 1500, output: 300 })
 * // Returns:
 * // "tokens_in:       1,500\ntokens_out:        300"
 */
export function formatTokenReport(tokens: TokenUsage | TokenCount | null): string {
  if (!tokens || getTokenAvailability(tokens) === "unavailable") {
    return `tokens_in: ${formatTokenValue(null)}\ntokens_out: ${formatTokenValue(null)}`;
  }

  const inputFormatted = formatTokenValue(tokens.input);
  const outputFormatted = formatTokenValue(tokens.output);

  return `tokens_in: ${inputFormatted}\ntokens_out: ${outputFormatted}`;
}

/**
 * Format token availability status for diagnostic messages.
 *
 * @param availability "available" | "unavailable"
 * @returns Human-readable status message
 */
export function formatTokenAvailability(availability: TokenAvailability): string {
  return availability === "available" ? "available" : "unavailable (no data)";
}

/**
 * Determine token availability status from a token count.
 *
 * Tokens are considered unavailable when:
 *   - The count is null or undefined
 *   - Both input and output are 0 (fallback for missing data)
 *
 * @param tokens Token usage (from TokenUsage or TokenCount)
 * @returns "available" if tokens > 0, "unavailable" otherwise
 */
export function getTokenAvailability(tokens: TokenUsage | TokenCount | null): TokenAvailability {
  if (!tokens) {
    return "unavailable";
  }
  if (tokens.input === 0 && tokens.output === 0) {
    return "unavailable";
  }
  return "available";
}

/**
 * Format a fallback message for when tokens could not be retrieved.
 *
 * @param vendor "Codex" | "Claude"
 * @param reason Optional reason (e.g., "API timeout", "auth failed")
 * @returns Formatted message suitable for detail() output
 */
export function formatTokenFallback(vendor: string, reason?: string): string {
  const base = `${vendor} token data unavailable`;
  if (reason) {
    return `${base}: ${reason}`;
  }
  return base;
}
