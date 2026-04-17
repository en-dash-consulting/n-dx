/**
 * Parser for extracting token usage from Codex CLI text output.
 *
 * Codex CLI outputs a token usage summary line after each run in the format:
 * "Tokens used: N in, N out" (where N may include comma separators).
 *
 * This parser scans the captured stdout/stderr buffer for this pattern and
 * extracts structured token counts compatible with the unified token metrics
 * schema.
 */

export interface CodexCliTokenUsage {
  input: number;
  output: number;
}

/**
 * Pattern to match same-line Codex CLI token usage:
 * "Tokens used: 1234 in, 567 out" (both counts on one line).
 *
 * Captures:
 * - Group 1: input token count (may include commas)
 * - Group 2: output token count (may include commas)
 */
const TOKEN_LINE_PATTERN =
  /tokens?\s+used:\s*([\d,]+)\s*(?:in(?:put)?)\s*,\s*([\d,]+)\s*(?:out(?:put)?)/i;

/**
 * Label-only pattern for the two-line Codex format:
 * "tokens used" or "Tokens used:" on its own line, count on the next line.
 */
const TWO_LINE_LABEL_PATTERN = /^tokens?\s+used:?\s*$/i;

/**
 * Count-only pattern for the second line of the two-line Codex format.
 * Captures a bare integer (possibly comma-formatted, possibly padded).
 */
const TWO_LINE_COUNT_PATTERN = /^\s*([\d,]+)\s*$/;

/**
 * Parse a comma-formatted number string into a number.
 * Returns NaN for invalid inputs.
 */
function parseCommaNumber(value: string): number {
  const cleaned = value.replace(/,/g, "");
  // Reject negative, float, or non-numeric values
  if (!/^\d+$/.test(cleaned)) {
    return NaN;
  }
  return parseInt(cleaned, 10);
}

/**
 * Extract input and output token counts from Codex CLI output.
 *
 * Scans the output buffer for a token usage summary line and extracts
 * the counts. When multiple token lines are present (e.g., in multi-turn
 * output), uses the last occurrence.
 *
 * @param output - The captured stdout/stderr buffer from Codex CLI
 * @returns Token counts, or null if no valid token line is present
 *
 * @example
 * ```ts
 * const output = "Processing...\nTokens used: 1234 in, 567 out\nDone.";
 * const tokens = parseCodexCliTokenUsage(output);
 * // { input: 1234, output: 567 }
 * ```
 */
export function parseCodexCliTokenUsage(output: string): CodexCliTokenUsage | null {
  if (!output || !output.trim()) {
    return null;
  }

  // Scan all lines; keep the last valid match across both formats.
  const lines = output.split(/\r?\n/);
  let lastResult: CodexCliTokenUsage | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Same-line format: "Tokens used: N in, N out"
    const sameLineMatch = line.match(TOKEN_LINE_PATTERN);
    if (sameLineMatch) {
      const input = parseCommaNumber(sameLineMatch[1]);
      const output_ = parseCommaNumber(sameLineMatch[2]);
      if (Number.isFinite(input) && Number.isFinite(output_)) {
        lastResult = { input, output: output_ };
      }
      continue;
    }

    // Two-line format: label on this line, count on the immediately next line.
    if (TWO_LINE_LABEL_PATTERN.test(line)) {
      const nextLine = lines[i + 1];
      if (nextLine !== undefined) {
        const countMatch = nextLine.match(TWO_LINE_COUNT_PATTERN);
        if (countMatch) {
          const total = parseCommaNumber(countMatch[1]);
          if (Number.isFinite(total)) {
            lastResult = { input: total, output: 0 };
            i++; // consume the count line
          }
        }
      }
    }
  }

  return lastResult;
}
