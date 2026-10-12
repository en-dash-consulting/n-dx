/**
 * Presentation helpers for the PRD tree's usage and duration columns.
 *
 * Pure, dependency-free formatters used by `prd-tree.ts` and its tests.
 * Keeping the formatting logic here (rather than inlined in the render
 * function) lets unit tests assert the exact strings rendered to users
 * without booting the whole tree.
 *
 * @see packages/web/tests/unit/viewer/prd-tree-format-usage.test.ts
 */

/**
 * Dash glyph used for empty states ("no runs yet", "never started").
 *
 * Brief explicitly calls for a dash rather than a `0` so that a zero-cost
 * row visually encodes "no work recorded" instead of "work recorded, zero
 * tokens consumed" — a confusing false-negative.
 */
export const EMPTY_DASH = "—";

const THOUSANDS_FORMATTER = new Intl.NumberFormat("en-US");

/**
 * Format a raw token count with thousands separators (e.g. `14,321`).
 *
 * Negative or non-finite inputs render as `EMPTY_DASH`.
 */
export function formatTokensExact(n: number | null | undefined): string {
  if (n === null || n === undefined) return EMPTY_DASH;
  if (!Number.isFinite(n) || n < 0) return EMPTY_DASH;
  return THOUSANDS_FORMATTER.format(Math.round(n));
}

/**
 * Format a USD cost for display.
 *
 * Agent runs land across four orders of magnitude — a one-turn status check
 * costs a fraction of a cent, a long autonomous loop costs dollars — so the
 * precision follows the magnitude rather than being fixed. A sub-cent figure
 * that rounded to `$0.00` would read as free, which is the same failure as
 * the token column reading as millions: a number that tells you nothing.
 *
 * Negative or non-finite inputs render as `EMPTY_DASH`. Exactly zero renders
 * as `$0.00`, which is a real answer (no priced runs), not an empty state.
 */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return EMPTY_DASH;
  if (!Number.isFinite(n) || n < 0) return EMPTY_DASH;
  if (n === 0) return "$0.00";
  if (n < 0.01) return `<$0.01`;
  if (n < 10) return `$${n.toFixed(2)}`;
  if (n < 1000) return `$${n.toFixed(1)}`;
  return `$${THOUSANDS_FORMATTER.format(Math.round(n))}`;
}

/**
 * Tokens the run caused to be newly processed: uncached input, cache writes,
 * and output. Cache reads are excluded.
 *
 * This is hench's `countBudgetedTokens` measure, restated for display. A cache
 * read is by construction a re-read of tokens already counted when they were
 * written, so including it charges the same tokens once per turn — which is
 * why a run's face-value total runs tens of times its real size.
 *
 * Returns null when the bucket predates the per-class wire shape and carries
 * no breakdown, so callers can fall back rather than print a wrong zero.
 */
export function newTokens(bucket: {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  /** Accepted and ignored, so a whole usage bucket can be passed straight in. */
  cacheReadTokens?: number;
}): number | null {
  const { inputTokens, outputTokens, cacheCreationTokens } = bucket;
  if (inputTokens === undefined && outputTokens === undefined && cacheCreationTokens === undefined) {
    return null;
  }
  return (inputTokens ?? 0) + (outputTokens ?? 0) + (cacheCreationTokens ?? 0);
}

/**
 * Format a duration (milliseconds) in human-readable form:
 *   - `< 1s`  → dash
 *   - `< 60s` → `1.2s`    (one decimal; `1.0s` normalized to `1s`)
 *   - `< 1h`  → `4m 10s`
 *   - else    → `2h 15m`
 *
 * Negative or non-finite inputs render as `EMPTY_DASH`.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return EMPTY_DASH;
  if (!Number.isFinite(ms) || ms < 0) return EMPTY_DASH;

  if (ms < 1000) return EMPTY_DASH;

  const totalSeconds = Math.floor(ms / 1000);

  if (totalSeconds < 60) {
    // One decimal place for sub-minute durations. Drop a trailing `.0`
    // so `1000ms → "1s"` instead of `"1.0s"` (matches brief's `1.2s`
    // example which implies a non-zero fractional part).
    const seconds = ms / 1000;
    const fixed = seconds.toFixed(1);
    if (fixed.endsWith(".0")) return `${fixed.slice(0, -2)}s`;
    return `${fixed}s`;
  }

  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
