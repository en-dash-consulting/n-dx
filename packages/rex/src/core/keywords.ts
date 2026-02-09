/**
 * Keyword extraction and matching utilities.
 *
 * Shared by the verify module (mapping acceptance criteria to test files)
 * and the next-task module (keyword-based task matching/search).
 *
 * @module core/keywords
 */

/** Words to ignore when matching criteria to file names. */
export const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could",
  "and", "but", "or", "nor", "not", "no", "so", "if", "then",
  "for", "in", "on", "at", "to", "of", "by", "with", "from",
  "up", "out", "off", "over", "under", "into", "through",
  "that", "this", "it", "its",
  "test", "tests", "when", "each", "all", "any",
]);

/**
 * Extract matching keywords from a text string.
 * Returns lowercased, deduplicated tokens suitable for fuzzy matching.
 */
export function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Deduplicate while preserving order
  return [...new Set(tokens)];
}

/**
 * Score how well a target string matches a set of keywords.
 * Returns 0 for no match, higher values for better matches.
 */
export function scoreMatch(target: string, keywords: string[]): number {
  const normalized = target.toLowerCase().replace(/[/\\]/g, " ").replace(/[.-]/g, " ");
  let score = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword)) {
      score += 1;
    }
  }
  return score;
}
