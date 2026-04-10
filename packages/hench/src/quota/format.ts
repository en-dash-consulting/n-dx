/**
 * ANSI color-coded quota log formatter.
 *
 * Accepts an array of QuotaRemaining snapshots and returns an array of
 * human-readable strings with ANSI color codes applied per threshold:
 *
 *   - red   (ANSI 31) when percentRemaining < 5 %
 *   - yellow (ANSI 33) when percentRemaining >= 5 % and < 10 %
 *   - default terminal color when percentRemaining >= 10 %
 *
 * Returns an empty array when the input is empty so callers can skip
 * output with a simple `.length` check.
 */

import type { QuotaRemaining } from "./types.js";

/** ANSI escape sequences used by the formatter. */
const ANSI = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
} as const;

/**
 * Return the ANSI open-sequence for a given percent-remaining value,
 * or an empty string when no colouring is needed.
 */
function colorFor(percentRemaining: number): string {
  if (percentRemaining < 5) return ANSI.red;
  if (percentRemaining < 10) return ANSI.yellow;
  return "";
}

/**
 * Format a single QuotaRemaining entry into a human-readable string.
 *
 * Example outputs:
 *   "\x1b[31mclaude / claude-opus-4-5: 3% remaining\x1b[0m"
 *   "\x1b[33mcodex / gpt-4o: 7% remaining\x1b[0m"
 *   "claude / claude-sonnet-4-5: 42% remaining"
 */
function formatEntry(entry: QuotaRemaining): string {
  const open = colorFor(entry.percentRemaining);
  const close = open ? ANSI.reset : "";
  const label = `${entry.vendor} / ${entry.model}: ${Math.round(entry.percentRemaining)}% remaining`;
  return `${open}${label}${close}`;
}

/**
 * Format an array of QuotaRemaining entries into an array of ANSI-colored
 * strings suitable for logging to the console.
 *
 * Returns an empty array when `quotas` is empty, allowing callers to guard
 * output with a simple `.length` check:
 *
 * ```ts
 * const lines = formatQuotaLog(quotas);
 * if (lines.length) console.log(lines.join("\n"));
 * ```
 */
export function formatQuotaLog(quotas: QuotaRemaining[]): string[] {
  return quotas.map(formatEntry);
}
