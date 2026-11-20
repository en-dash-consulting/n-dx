/**
 * Proposal numbers typed at an interactive review prompt, shared by smart
 * add's approval prompt and `rex analyze`'s chunked review so both read a
 * selection and a granularity command the same way.
 *
 * @module rex/cli/commands/proposal-selection
 */

/**
 * Parse a string of comma/space-separated 1-based numbers into
 * deduplicated, sorted 0-based indices within the valid range.
 */
export function parseNumericIndices(input: string, total: number): number[] {
  return [...new Set(
    input
      .trim()
      .split(/[\s,]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n) && n >= 1 && n <= total)
      .map((n) => n - 1),
  )].sort((a, b) => a - b);
}

/**
 * Parse granularity adjustment input from the approval prompt.
 * Accepts:
 *   "b1,3" or "b 1 3" or "break down 1,3"  → break down proposals 1 and 3
 *   "c1,3" or "c 1 3" or "consolidate 1,3"  → consolidate proposals 1 and 3
 *
 * Returns null if the input is not a granularity command.
 */
export function parseGranularityInput(
  input: string,
  totalProposals: number,
): { direction: "break_down" | "consolidate"; indices: number[] } | null {
  const raw = input.trim();

  // Break down: "b1,3" or "break down 1,3" or "b 1 3"
  const breakMatch = raw.match(/^[bB](?:reak\s*down)?\s*(.+)$/i);
  if (breakMatch) {
    const indices = parseNumericIndices(breakMatch[1], totalProposals);
    if (indices.length > 0) {
      return { direction: "break_down", indices };
    }
  }

  // Consolidate: "c1,3" or "consolidate 1,3" or "c 1 3"
  const consolidateMatch = raw.match(/^[cC](?:onsolidate)?\s*(.+)$/i);
  if (consolidateMatch) {
    const indices = parseNumericIndices(consolidateMatch[1], totalProposals);
    if (indices.length > 0) {
      return { direction: "consolidate", indices };
    }
  }

  return null;
}
