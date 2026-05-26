import type { ScanResult } from "./scanners.js";
import { PRIORITY_ORDER } from "../schema/index.js";
import {
  normalize,
  splitActionContent,
  rawSimilarity,
} from "../recommend/text-similarity-shared.js";

/** Default similarity threshold for merging near-duplicates */
const DEFAULT_THRESHOLD = 0.7;

// ── Similarity scoring ──

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

// ── Merge strategy: pick the "best" representative from a cluster ──

function priorityRank(p?: string): number {
  const key = p ?? "medium";
  return key in PRIORITY_ORDER
    ? PRIORITY_ORDER[key as keyof typeof PRIORITY_ORDER]
    : 2;
}

/**
 * Score a result for "richness" — higher is better.
 * Prefers: higher priority > has description > has acceptance criteria > longer title.
 */
function richness(r: ScanResult): number {
  let score = 0;
  // Higher priority = lower rank number = better
  score += (4 - priorityRank(r.priority)) * 100;
  if (r.description) score += 50;
  if (r.acceptanceCriteria && r.acceptanceCriteria.length > 0) score += 30;
  if (r.tags && r.tags.length > 0) score += 10;
  score += r.name.length; // prefer longer, more descriptive titles
  return score;
}

/**
 * Merge a cluster of near-duplicate ScanResults into a single representative.
 * Picks the "richest" result as the base, then merges metadata from others.
 */
function mergeCluster(cluster: ScanResult[]): ScanResult {
  if (cluster.length === 1) return cluster[0];

  // Sort by richness descending; pick the best as base
  const sorted = [...cluster].sort((a, b) => richness(b) - richness(a));
  const best = sorted[0];

  // Merge acceptance criteria from all members
  const allCriteria = new Set<string>();
  for (const r of cluster) {
    if (r.acceptanceCriteria) {
      for (const c of r.acceptanceCriteria) allCriteria.add(c);
    }
  }

  // Merge tags from all members
  const allTags = new Set<string>();
  for (const r of cluster) {
    if (r.tags) {
      for (const t of r.tags) allTags.add(t);
    }
  }

  return {
    ...best,
    acceptanceCriteria:
      allCriteria.size > 0 ? [...allCriteria] : best.acceptanceCriteria,
    tags: allTags.size > 0 ? [...allTags] : best.tags,
  };
}

// ── Public API ──

/**
 * Compute a combined similarity score for two scan results, considering
 * both name and description similarity. When both results have descriptions,
 * high description similarity can compensate for lower name similarity,
 * catching duplicates that describe the same work in different words.
 */
function resultSimilarity(a: ScanResult, b: ScanResult): number {
  const nameScore = similarity(a.name, b.name);

  // If both have descriptions, also consider description similarity
  if (a.description && b.description) {
    const descScore = similarity(a.description, b.description);

    // High description overlap is a strong signal of duplication even when
    // names differ (e.g. "Auth refactor" vs "JWT migration" with identical
    // descriptions). Blend: use whichever signal is stronger, with a boost
    // when both signals agree.
    if (descScore >= 0.8) {
      // Very similar descriptions: boost the combined score significantly
      return Math.max(nameScore, descScore * 0.9 + nameScore * 0.1);
    }
    if (descScore >= 0.5) {
      // Moderately similar descriptions: blend with name score
      return Math.max(nameScore, nameScore * 0.6 + descScore * 0.4);
    }
  }

  return nameScore;
}

/**
 * Deduplicate scan results by merging near-duplicates within the same kind.
 *
 * Uses multi-signal similarity: name comparison (bigram Dice + word overlap
 * with action-verb normalization) combined with description similarity for
 * results that describe the same work in different words.
 *
 * Results of different kinds (epic vs feature vs task) are never merged.
 *
 * @param results - Raw scan results
 * @param threshold - Similarity threshold (0.0–1.0). Default 0.7.
 * @returns Deduplicated results with merged metadata
 */
export function deduplicateScanResults(
  results: ScanResult[],
  threshold: number = DEFAULT_THRESHOLD,
): ScanResult[] {
  if (results.length === 0) return [];

  // Group by kind — only merge within same kind
  const byKind = new Map<string, ScanResult[]>();
  for (const r of results) {
    const group = byKind.get(r.kind) ?? [];
    group.push(r);
    byKind.set(r.kind, group);
  }

  const output: ScanResult[] = [];

  for (const [, kindResults] of byKind) {
    // Build clusters using union-find approach
    const n = kindResults.length;
    const parent = Array.from({ length: n }, (_, i) => i);

    function find(i: number): number {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]]; // path compression
        i = parent[i];
      }
      return i;
    }

    function union(i: number, j: number): void {
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }

    // Compare all pairs within this kind using combined similarity
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const score = resultSimilarity(kindResults[i], kindResults[j]);
        if (score >= threshold) {
          union(i, j);
        }
      }
    }

    // Collect clusters
    const clusters = new Map<number, ScanResult[]>();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      const cluster = clusters.get(root) ?? [];
      cluster.push(kindResults[i]);
      clusters.set(root, cluster);
    }

    // Merge each cluster into a single representative
    for (const [, cluster] of clusters) {
      output.push(mergeCluster(cluster));
    }
  }

  return output;
}
