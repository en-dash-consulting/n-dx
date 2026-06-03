import {
  normalize,
  bigrams,
  wordSet,
  splitActionContent,
  rawSimilarity,
} from "./text-similarity-shared.js";

export function similarity(a: string, b: string): number {
  const normalizedA = normalize(a);
  const normalizedB = normalize(b);

  if (normalizedA.length === 0 || normalizedB.length === 0) return 0;
  if (normalizedA === normalizedB) return 1.0;

  const fullScore = rawSimilarity(normalizedA, normalizedB);
  const actionA = splitActionContent(normalizedA);
  const actionB = splitActionContent(normalizedB);

  if (actionA.verb && actionB.verb && actionA.content.length > 0 && actionB.content.length > 0) {
    const contentScore = rawSimilarity(actionA.content, actionB.content);
    if (actionA.verb === actionB.verb) {
      return Math.min(contentScore * 0.85 + 0.15, 1.0);
    }
    return contentScore * 0.85;
  }

  return fullScore;
}
