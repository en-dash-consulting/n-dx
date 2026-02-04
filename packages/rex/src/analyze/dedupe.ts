import type { ScanResult } from "./scanners.js";

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Default similarity threshold for merging near-duplicates */
const DEFAULT_THRESHOLD = 0.7;

// ── Similarity scoring ──

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2));
  }
  return set;
}

function wordSet(s: string): Set<string> {
  return new Set(s.split(" ").filter(Boolean));
}

/**
 * Compute similarity between two strings using a combination of:
 * 1. Bigram Dice coefficient (character-level)
 * 2. Word overlap (Jaccard index)
 * 3. Substring containment bonus
 *
 * Returns the maximum of these scores (0.0–1.0).
 */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);

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
  const wA = wordSet(na);
  const wB = wordSet(nb);
  let wordScore = 0;
  if (wA.size > 0 && wB.size > 0) {
    let matched = 0;
    const allWords = new Set([...wA, ...wB]);

    for (const w of wA) {
      if (wB.has(w)) {
        matched++;
      } else {
        // Check if w is a prefix of any word in wB, or vice versa
        for (const wb of wB) {
          if (wb.startsWith(w) || w.startsWith(wb)) {
            matched += 0.8; // Partial credit for prefix match
            break;
          }
        }
      }
    }

    wordScore = matched / allWords.size;
  }

  return Math.max(bigramScore, wordScore);
}

// ── Merge strategy: pick the "best" representative from a cluster ──

function priorityRank(p?: string): number {
  return PRIORITY_RANK[p ?? "medium"] ?? 2;
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
 * Deduplicate scan results by merging near-duplicates within the same kind.
 *
 * Uses bigram-based Dice coefficient to detect similarity. Results of different
 * kinds (epic vs feature vs task) are never merged with each other.
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

    // Compare all pairs within this kind
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const score = similarity(kindResults[i].name, kindResults[j].name);
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
