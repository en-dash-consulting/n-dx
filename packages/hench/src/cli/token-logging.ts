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

/** Cache fields, when the vendor reports them. */
function cacheFields(tokens: TokenUsage | TokenCount): { write: number; read: number } {
  const t = tokens as TokenUsage;
  return { write: t.cacheCreationInput ?? 0, read: t.cacheReadInput ?? 0 };
}

/**
 * Render `label: value` rows with both columns aligned.
 *
 * The value column is sized to the widest number rather than fixed, because a
 * resumed run's cache reads run to eight digits while its fresh input is three
 * — a fixed width would either wrap the large figure or strand the small one.
 */
function formatRows(rows: Array<[string, number]>): string {
  const labelWidth = Math.max(...rows.map(([label]) => label.length)) + 1; // + ":"
  const valueWidth = Math.max(
    DEFAULT_FIELD_WIDTH,
    ...rows.map(([, value]) => value.toLocaleString().length),
  );
  return rows
    .map(([label, value]) => `${`${label}:`.padEnd(labelWidth)} ${formatTokenValue(value, valueWidth)}`)
    .join("\n");
}

/**
 * Format a complete token usage report for a run.
 *
 * Without cache activity — Codex, or a Claude run that never hit the cache —
 * this is the historical two lines, `tokens_in` and `tokens_out`.
 *
 * When the vendor reports cache tokens, they get their own labelled lines plus
 * a total. They are not folded into `tokens_in`, because fresh input and
 * re-read context are neither priced the same nor interpreted the same: a
 * resumed `--review` session re-reads the whole work session, so almost all of
 * its cost is cache reads. Run 60c3a951 printed `tokens_in: 319` against a real
 * input of ~15.29M, which made the review pass look free — the opposite of what
 * charging the review to the run was for.
 *
 * @param tokens Token usage (input/output counts, or null for unavailable)
 * @returns Multi-line formatted string suitable for info() output
 *
 * @example
 * formatTokenReport({ input: 1500, output: 300 })
 * // "tokens_in:     1,500\ntokens_out:      300"
 *
 * @example
 * formatTokenReport({ input: 319, output: 42733, cacheCreationInput: 553572, cacheReadInput: 14740617 })
 * // "tokens_in:          319
 * //  cache_write:    553,572
 * //  cache_read:  14,740,617
 * //  tokens_out:      42,733
 * //  total:       15,337,241"
 */
export function formatTokenReport(tokens: TokenUsage | TokenCount | null): string {
  if (!tokens || getTokenAvailability(tokens) === "unavailable") {
    return `tokens_in: ${formatTokenValue(null)}\ntokens_out: ${formatTokenValue(null)}`;
  }

  const { write, read } = cacheFields(tokens);
  if (write === 0 && read === 0) {
    const inputFormatted = formatTokenValue(tokens.input);
    const outputFormatted = formatTokenValue(tokens.output);
    return `tokens_in: ${inputFormatted}\ntokens_out: ${outputFormatted}`;
  }

  return formatRows([
    ["tokens_in", tokens.input],
    ["cache_write", write],
    ["cache_read", read],
    ["tokens_out", tokens.output],
    ["total", tokens.input + tokens.output + write + read],
  ]);
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
