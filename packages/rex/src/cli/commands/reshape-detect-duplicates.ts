/**
 * Cross-PRD duplicate detection for reshape pass.
 *
 * Detects duplicates among siblings across multiple PRD files and generates
 * merge proposals. The newer item (by file age) is merged into the older item.
 *
 * @module cli/commands/reshape-detect-duplicates
 */

import { similarity } from "../../analyze/dedupe.js";
import { findItem, walkTree } from "../../core/tree.js";
import { comparePRDFileAge } from "./smart-add-duplicates.js";
import type { ReshapeProposal, MergeAction } from "../../core/reshape.js";
import type { PRDItem, ItemLevel } from "../../schema/index.js";
import type { ItemFileMap } from "./smart-add-duplicates.js";

const DUPLICATE_THRESHOLD = 0.7;

/**
 * Score a pair of sibling items for duplication.
 *
 * Uses multi-signal similarity: normalized title comparison blended with
 * description and acceptance criteria similarity when available.
 */
function scorePairForDuplication(a: PRDItem, b: PRDItem): number {
  const titleScore = similarity(a.title, b.title);

  // If both have descriptions, also consider description similarity
  if (a.description && b.description) {
    const descScore = similarity(a.description, b.description);

    // High description overlap is a strong signal of duplication even when
    // names differ. Blend: use whichever signal is stronger, with a boost
    // when both signals agree.
    if (descScore >= 0.8) {
      return Math.max(titleScore, descScore * 0.9 + titleScore * 0.1);
    }
    if (descScore >= 0.5) {
      return Math.max(titleScore, titleScore * 0.6 + descScore * 0.4);
    }
  }

  return titleScore;
}

/**
 * Find duplicate pairs within a cohort of siblings.
 *
 * Returns array of { survivor, loser } pairs where survivor is from the newer file.
 * The newer item survives with its ID/title/status/priority/updatedAt.
 * The older item's non-empty fields are used to fill missing values on the survivor.
 * Only items with similarity >= DUPLICATE_THRESHOLD are returned.
 */
function findDuplicatePairsInCohort(
  items: PRDItem[],
  itemFileMap: ItemFileMap,
): Array<{ survivor: PRDItem; loser: PRDItem }> {
  const pairs: Array<{ survivor: PRDItem; loser: PRDItem }> = [];

  // Build union-find structure to detect transitive duplicates
  const n = items.length;
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

  // Compare all pairs within this cohort
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const score = scorePairForDuplication(items[i], items[j]);
      if (score >= DUPLICATE_THRESHOLD) {
        union(i, j);
      }
    }
  }

  // Collect clusters
  const clusters = new Map<number, PRDItem[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const cluster = clusters.get(root) ?? [];
    cluster.push(items[i]);
    clusters.set(root, cluster);
  }

  // For each cluster > 1 item, pick newest file's item as survivor
  for (const [, cluster] of clusters) {
    if (cluster.length < 2) continue;

    // Sort by file age (oldest first, so newest is last)
    const sorted = [...cluster].sort((a, b) => {
      const fileA = itemFileMap.get(a.id) ?? "prd.json";
      const fileB = itemFileMap.get(b.id) ?? "prd.json";
      return comparePRDFileAge(fileA, fileB);
    });

    // Newer item is the survivor (last in sorted order)
    const survivor = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      // Older items (all except last) are losers
      pairs.push({ survivor, loser: sorted[i] });
    }
  }

  return pairs;
}

/**
 * Detect cross-PRD duplicates among siblings and generate merge proposals.
 *
 * Groups items by sibling cohort (parentId, level), finds duplicates within
 * each cohort, and generates merge actions that merge newer items into older files.
 */
export function detectCrossPRDDuplicates(
  items: PRDItem[],
  itemFileMap: ItemFileMap,
): ReshapeProposal[] {
  if (items.length === 0) return [];

  // Group items by sibling cohort: (parentId, level) → items
  const cohortKey = (parentId: string | undefined, level: ItemLevel): string => {
    return `${parentId ?? "root"}:${level}`;
  };

  const cohorts = new Map<string, PRDItem[]>();

  for (const { item, parents } of walkTree(items)) {
    const parentId = parents.length > 0 ? parents[parents.length - 1].id : undefined;
    const key = cohortKey(parentId, item.level);
    const cohort = cohorts.get(key) ?? [];
    cohort.push(item);
    cohorts.set(key, cohort);
  }

  // Find duplicates within each cohort
  const proposals: ReshapeProposal[] = [];
  const processedMerges = new Set<string>(); // Track processed pairs to avoid duplicates

  for (const [, cohort] of cohorts) {
    if (cohort.length < 2) continue;

    const pairs = findDuplicatePairsInCohort(cohort, itemFileMap);

    for (const { survivor, loser } of pairs) {
      // Skip if we've already processed this merge
      const mergeKey = `${survivor.id}:${loser.id}`;
      if (processedMerges.has(mergeKey)) continue;
      processedMerges.add(mergeKey);

      // Generate merge proposal: newer item (loser) merges into older item (survivor)
      const action: MergeAction = {
        action: "merge",
        survivorId: survivor.id,
        mergedIds: [loser.id],
        reason: "cross-prd-duplicate-sibling-merge",
        mergeReasoning: `Detected cross-PRD duplicate: merged ${loser.id} into ${survivor.id} (same parent, high similarity)`,
      };

      const proposal: ReshapeProposal = {
        id: `dup-${survivor.id}-${loser.id}`,
        action,
      };

      proposals.push(proposal);
    }
  }

  return proposals;
}
