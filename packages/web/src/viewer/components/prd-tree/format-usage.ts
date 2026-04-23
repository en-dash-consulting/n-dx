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
