/**
 * Typo correction utilities for CLI commands.
 *
 * Uses Levenshtein edit distance to suggest similar commands when
 * the user types an unrecognized command. Shared across all n-dx
 * packages via the foundation layer.
 *
 * @module @n-dx/llm-client/suggest
 */

/**
 * Compute Levenshtein edit distance between two strings.
 * Uses single-row DP for O(n) memory.
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const prev = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = prev[j];
      if (a[i - 1] === b[j - 1]) {
        prev[j] = prevDiag;
      } else {
        prev[j] = 1 + Math.min(prevDiag, prev[j - 1], prev[j]);
      }
      prevDiag = temp;
    }
  }

  return prev[n];
}

/**
 * Find the closest command names to the given input using edit distance.
 * Returns suggestions sorted by distance, filtered to distance ≤ maxDistance.
 */
export function suggestCommands(
  input: string,
  candidates: string[],
  maxDistance = 2,
): Array<{ name: string; distance: number }> {
  const lower = input.toLowerCase();
  return candidates
    .map((name) => ({ name, distance: editDistance(lower, name.toLowerCase()) }))
    .filter((s) => s.distance > 0 && s.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Format a "Did you mean?" suggestion string for CLI output.
 * Returns null if no close matches are found.
 */
export function formatTypoSuggestion(
  input: string,
  candidates: string[],
  prefix = "",
): string | null {
  const suggestions = suggestCommands(input, candidates);
  if (suggestions.length === 0) return null;

  if (suggestions.length === 1) {
    return `Did you mean '${prefix}${suggestions[0].name}'?`;
  }

  const names = suggestions.slice(0, 3).map((s) => `${prefix}${s.name}`);
  return `Did you mean one of: ${names.join(", ")}?`;
}
