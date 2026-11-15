import {
  normalize,
  splitActionContent,
  rawSimilarity,
} from "./text-similarity-shared.js";

/**
 * Compute similarity between two strings using a combination of:
 * 1. Action-verb normalization (synonyms mapped, then compared on content)
 * 2. Bigram Dice coefficient (character-level)
 * 3. Word overlap with fuzzy matching (Jaccard index)
 * 4. Substring containment bonus
 *
 * When both strings start with an action verb (e.g. "Fix", "Implement"),
 * the verb is factored out and similarity is computed on the remaining
 * content words. Synonymous verbs ("Add" / "Implement") are treated as
 * matching, so only the content difference matters.
 *
 * Returns the maximum of these scores (0.0–1.0).
 */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);

  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1.0;

  // Compute raw similarity on the full strings
  const fullScore = rawSimilarity(na, nb);

  // Action-verb-aware comparison: if both strings have a leading action verb,
  // compute similarity on content words only and weight verb match separately.
  // This prevents shared action verbs from inflating scores for unrelated items.
  const sa = splitActionContent(na);
  const sb = splitActionContent(nb);

  if (sa.verb && sb.verb && sa.content.length > 0 && sb.content.length > 0) {
    const contentScore = rawSimilarity(sa.content, sb.content);

    if (sa.verb === sb.verb) {
      // Same or synonymous verb: the verb is shared context that confirms
      // relatedness when content overlaps. Score is primarily content-driven
      // but verb agreement provides a boost when content is similar.
      // This avoids inflating scores when content is unrelated (e.g. both
      // say "Fix" but describe different bugs).
      const verbAwareScore = contentScore * 0.85 + 0.15;
      return Math.min(verbAwareScore, 1.0);
    } else {
      // Different verb classes: content similarity alone decides.
      return contentScore * 0.85;
    }
  }

  return fullScore;
}
