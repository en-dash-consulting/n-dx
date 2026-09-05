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

/** Label column width for the four-line (cached) report — `cache_write:` is the longest. */
const CACHE_LABEL_WIDTH = "cache_write:".length;

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

/** Read an optional cache field off either accepted token shape. */
function cacheField(
  tokens: TokenUsage | TokenCount,
  key: "cacheCreationInput" | "cacheReadInput",
): number {
  const value = (tokens as Partial<TokenUsage>)[key];
  return typeof value === "number" && value > 0 ? value : 0;
}

/**
 * Format a complete token usage report for a run.
 *
 * Two lines — `tokens_in` and `tokens_out` — plus, when the run used prompt
 * caching, two more for the cache halves of the input.
 *
 * ## Why the cache lines matter
 *
 * `tokens_in` counts *uncached* input only. On a cached run that is a rounding
 * error against the real figure: a measured 83-turn run reported 534 there
 * while actually reading 34.1M cached tokens and writing 876K — the headline
 * understated input by roughly 65,000x, and priced the run near zero. The
 * numbers were always recorded correctly on the run record; only this summary
 * omitted them, which is precisely the kind of report that gets believed.
 *
 * So the headline is labelled `(uncached)` whenever cache lines follow, and the
 * cache halves are shown beside it. The rollups in `rex usage` and the web
 * dashboard already account for both.
 *
 * The cache lines are appended *after* `tokens_out`, not between the two, so
 * that `tokens_in` and `tokens_out` stay on lines 0 and 1 for anything parsing
 * this block. A run with no cache activity is byte-identical to before.
 *
 * @param tokens Token usage (input/output counts, or null for unavailable)
 * @returns Multi-line formatted string suitable for info() output
 *
 * @example
 * formatTokenReport({ input: 1500, output: 300 })
 * // "tokens_in:       1,500\ntokens_out:        300"
 */
export function formatTokenReport(tokens: TokenUsage | TokenCount | null): string {
  if (!tokens || getTokenAvailability(tokens) === "unavailable") {
    return `tokens_in: ${formatTokenValue(null)}\ntokens_out: ${formatTokenValue(null)}`;
  }

  const cacheWrite = cacheField(tokens, "cacheCreationInput");
  const cacheRead = cacheField(tokens, "cacheReadInput");

  if (cacheWrite === 0 && cacheRead === 0) {
    return `tokens_in: ${formatTokenValue(tokens.input)}\ntokens_out: ${formatTokenValue(tokens.output)}`;
  }

  // Cache reads run orders of magnitude larger than the uncached counts, so the
  // shared field width is widened to whatever the largest value needs.
  const width = Math.max(
    DEFAULT_FIELD_WIDTH,
    ...[tokens.input, tokens.output, cacheWrite, cacheRead].map(
      (value) => value.toLocaleString().length,
    ),
  );
  const label = (text: string) => `${text}:`.padEnd(CACHE_LABEL_WIDTH);

  return [
    `${label("tokens_in")} ${formatTokenValue(tokens.input, width)}  (uncached)`,
    `${label("tokens_out")} ${formatTokenValue(tokens.output, width)}`,
    `${label("cache_write")} ${formatTokenValue(cacheWrite, width)}`,
    `${label("cache_read")} ${formatTokenValue(cacheRead, width)}`,
  ].join("\n");
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
 *   - Every count is 0 (fallback for missing data)
 *
 * Cache counts are part of that test. A run whose input and output are both 0
 * but which read from cache did use tokens, and reporting it as "no data" would
 * hide the only spend it had.
 *
 * @param tokens Token usage (from TokenUsage or TokenCount)
 * @returns "available" if any count > 0, "unavailable" otherwise
 */
export function getTokenAvailability(tokens: TokenUsage | TokenCount | null): TokenAvailability {
  if (!tokens) {
    return "unavailable";
  }
  if (tokens.input !== 0 || tokens.output !== 0) {
    return "available";
  }
  const hasCache =
    cacheField(tokens, "cacheCreationInput") > 0 || cacheField(tokens, "cacheReadInput") > 0;
  return hasCache ? "available" : "unavailable";
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
