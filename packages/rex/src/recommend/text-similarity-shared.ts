/**
 * Shared text similarity utilities used across recommendation and deduplication.
 *
 * These utilities provide character-bigram and word-level fuzzy matching
 * for duplicate detection and recommendation conflict detection.
 */

export function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

export function bigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}

export function wordSet(text: string): Set<string> {
  return new Set(text.split(" ").filter(Boolean));
}

/**
 * Action verbs that appear at the start of scan result names as prefixes.
 * These are semantically "noise" for similarity — "Implement caching" and
 * "Implement auth" should not score high just because they share "implement".
 * Grouped by synonym class so e.g. "add" and "implement" are treated as
 * interchangeable before content comparison.
 */
export const ACTION_SYNONYM_MAP: Record<string, string> = {
  add: "implement",
  implement: "implement",
  create: "implement",
  build: "implement",
  setup: "implement",
  set: "implement", // "set up"
  introduce: "implement",
  fix: "fix",
  resolve: "fix",
  repair: "fix",
  patch: "fix",
  refactor: "refactor",
  restructure: "refactor",
  reorganize: "refactor",
  clean: "refactor",
  update: "update",
  upgrade: "update",
  improve: "update",
  enhance: "update",
  optimize: "update",
  remove: "remove",
  delete: "remove",
  drop: "remove",
  investigate: "investigate",
  analyze: "investigate",
  review: "investigate",
  audit: "investigate",
};

/**
 * Words that carry little semantic weight for distinguishing scan results.
 * These are excluded from word-level matching so they don't inflate scores.
 */
export const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "in", "of", "on", "with",
  "is", "be", "up", "by", "at", "as", "its", "it", "this", "that",
]);

/**
 * Strip leading action verb from a normalized string and return the
 * canonical verb + remaining content words.
 */
export function splitActionContent(text: string): { verb: string | null; content: string } {
  const words = text.split(" ").filter(Boolean);
  if (words.length === 0) return { verb: null, content: "" };

  // Strip colon suffixes (e.g., "Fix:" → "fix")
  const first = words[0].replace(/:$/, "");
  const canonical = ACTION_SYNONYM_MAP[first];
  if (canonical) {
    // Also skip "up" after "set" (handles "set up caching")
    let skip = 1;
    if (first === "set" && words.length > 1 && words[1] === "up") skip = 2;
    const contentWords = words.slice(skip).filter((w) => !STOPWORDS.has(w));
    return { verb: canonical, content: contentWords.join(" ") };
  }

  const contentWords = words.filter((w) => !STOPWORDS.has(w));
  return { verb: null, content: contentWords.join(" ") };
}

/**
 * Compute raw (non-action-aware) similarity between two normalized strings.
 */
export function rawSimilarity(na: string, nb: string): number {
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1.0;

  // Substring containment: if one fully contains the other, high similarity
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    // Scale by length ratio so "a" contained in "abcdefghij" scores lower
    // than "login flow" contained in "user login flow"
    return Math.max(0.7, shorter / longer);
  }

  // Bigram Dice coefficient
  const biA = bigrams(na);
  const biB = bigrams(nb);
  let bigramScore = 0;
  if (biA.size > 0 && biB.size > 0) {
    let intersection = 0;
    for (const gram of biA) {
      if (biB.has(gram)) intersection++;
    }
    bigramScore = (2 * intersection) / (biA.size + biB.size);
  }

  // Word-level fuzzy Jaccard: counts a word as matching if it equals or is a
  // prefix of a word in the other set (e.g. "auth" matches "authentication").
  // Prefix-matched pairs reduce the effective union size so that
  // "auth bug" vs "authentication bug" isn't penalized for having 3 unique
  // strings when "auth" and "authentication" represent the same concept.
  const wA = wordSet(na);
  const wB = wordSet(nb);
  let wordScore = 0;
  if (wA.size > 0 && wB.size > 0) {
    let matched = 0;
    let prefixPairs = 0; // count of prefix-matched pairs (collapse in union)

    for (const w of wA) {
      if (wB.has(w)) {
        matched++;
      } else {
        // Check if w is a prefix of any word in wB, or vice versa
        for (const wb of wB) {
          if (wb.startsWith(w) || w.startsWith(wb)) {
            matched += 0.8; // Partial credit for prefix match
            prefixPairs++;
            break;
          }
        }
      }
    }

    // Effective union: total unique strings minus prefix-matched duplicates
    const rawUnion = new Set([...wA, ...wB]).size;
    const effectiveUnion = rawUnion - prefixPairs;
    wordScore = matched / effectiveUnion;
  }

  return Math.max(bigramScore, wordScore);
}
