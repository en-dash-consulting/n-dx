/**
 * Conflict detection for recommendation → PRD creation.
 *
 * Detects duplicate or conflicting items before creating PRD entries
 * from accepted recommendations. Two kinds of conflicts are identified:
 *
 * 1. **Existing-item conflicts** — a recommendation matches a PRD item
 *    that already exists (by title similarity).
 * 2. **Intra-batch conflicts** — two recommendations in the same accept
 *    batch are duplicates of each other.
 *
 * Uses the same character-bigram similarity engine as the smart-add
 * duplicate detection pipeline, ensuring consistent thresholds and
 * scoring across all duplicate-detection paths.
 *
 * @module recommend/conflict-detection
 */

import { similarity } from "../analyze/dedupe.js";
import { walkTree } from "../core/tree.js";
import type { PRDItem, ItemLevel, ItemStatus } from "../schema/index.js";
import type { EnrichedRecommendation, RecommendationMeta } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────

/** Similarity threshold for flagging a conflict with existing items. Matches smart-add. */
export const CONFLICT_THRESHOLD = 0.7;

/**
 * Stricter threshold for intra-batch duplicate detection.
 *
 * Intra-batch recommendations often share template patterns
 * (e.g. "Address X issues (N findings)") that inflate both title
 * and content similarity without meaning the items are duplicates.
 * A higher threshold avoids false positives from template-generated
 * pairs while still catching genuine duplicates.
 */
export const INTRA_BATCH_THRESHOLD = 0.85;

// ── Types ─────────────────────────────────────────────────────────────

/** Why a conflict was detected. */
export type ConflictReason =
  | "exact_title"
  | "semantic_title"
  | "content_overlap";

/** Reference to the existing PRD item that conflicts. */
export interface ConflictMatchedItem {
  id: string;
  title: string;
  level: ItemLevel;
  status: ItemStatus;
}

/** A single conflict between a recommendation and an existing PRD item. */
export interface RecommendationConflict {
  /** Index of the recommendation in the input array. */
  recommendationIndex: number;
  /** Title of the conflicting recommendation. */
  recommendationTitle: string;
  /** The existing PRD item that was matched. */
  matchedItem: ConflictMatchedItem;
  /** Why the conflict was detected. */
  reason: ConflictReason;
  /** Similarity score (0–1). */
  score: number;
}

/** An intra-batch duplicate pair. */
export interface IntraBatchDuplicate {
  /** Index of the first recommendation. */
  indexA: number;
  /** Index of the second recommendation. */
  indexB: number;
  /** Title of the first recommendation. */
  titleA: string;
  /** Title of the second recommendation. */
  titleB: string;
  /** Similarity score between the two. */
  score: number;
}

/** Full conflict report for a batch of recommendations. */
export interface ConflictReport {
  /** Conflicts with existing PRD items. */
  conflicts: RecommendationConflict[];
  /** Duplicates within the batch itself. */
  intraBatchDuplicates: IntraBatchDuplicate[];
  /** Whether any conflicts were detected. */
  hasConflicts: boolean;
  /** Indices of conflict-free recommendations (safe to create). */
  safeIndices: number[];
  /** Indices of conflicting recommendations. */
  conflictingIndices: number[];
}

// ── Helpers ───────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function titleContains(a: string, b: string): boolean {
  if (a.length < 5 || b.length < 5) return false;
  return a.includes(b) || b.includes(a);
}

function buildRecommendationContent(rec: EnrichedRecommendation): string {
  return rec.description?.trim() ?? "";
}

function buildItemContent(item: PRDItem): string {
  const parts: string[] = [];
  if (item.description) parts.push(item.description);
  if (item.acceptanceCriteria?.length) parts.push(item.acceptanceCriteria.join(" "));
  return parts.join(" ").trim();
}

interface ScoredCandidate {
  item: PRDItem;
  score: number;
  reason: ConflictReason;
}

/**
 * Score a recommendation against a single existing PRD item.
 * Returns null if the similarity is below the conflict threshold.
 */
function scoreRecommendationAgainstItem(
  rec: EnrichedRecommendation,
  item: PRDItem,
): ScoredCandidate | null {
  // Category-aware short-circuit: when both items carry recommendation
  // metadata with a category (e.g. "observation", "suggestion", "anti-pattern"),
  // different categories mean different work — skip the match entirely.
  // Template-style titles like "Address X issues (N findings)" inflate
  // similarity across categories without representing actual duplicates.
  const recCategory = rec.meta?.category;
  const itemCategory = (item.recommendationMeta as RecommendationMeta | undefined)?.category;
  if (recCategory && itemCategory && recCategory !== itemCategory) {
    return null;
  }

  const recTitle = normalize(rec.title);
  const itemTitle = normalize(item.title);

  // Exact title match
  if (recTitle === itemTitle) {
    return { item, score: 1.0, reason: "exact_title" };
  }

  // Title containment
  if (titleContains(recTitle, itemTitle)) {
    return { item, score: 0.95, reason: "semantic_title" };
  }

  // Blended similarity (title + content)
  const titleScore = similarity(rec.title, item.title);
  const recContent = buildRecommendationContent(rec);
  const itemContent = buildItemContent(item);
  const contentScore =
    recContent.length > 0 && itemContent.length > 0
      ? similarity(recContent, itemContent)
      : 0;

  const blended = Math.max(
    titleScore,
    titleScore * 0.75 + contentScore * 0.25,
    contentScore * 0.7,
  );

  const isConflict =
    blended >= CONFLICT_THRESHOLD ||
    (titleScore >= 0.62 && contentScore >= 0.55);

  if (!isConflict) return null;

  return {
    item,
    score: blended,
    reason: contentScore > titleScore ? "content_overlap" : "semantic_title",
  };
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Detect conflicts between recommendations and existing PRD items.
 *
 * Each recommendation is scored against every item in the PRD tree
 * using the same similarity engine as smart-add duplicate detection.
 * The best match (highest score) is kept per recommendation.
 *
 * Also detects intra-batch duplicates where two recommendations in
 * the same batch would create near-identical PRD items.
 *
 * @param recommendations - The recommendations to check.
 * @param existingItems - The current PRD item tree.
 * @returns A conflict report with conflicts, safe indices, etc.
 */
export function detectRecommendationConflicts(
  recommendations: readonly EnrichedRecommendation[],
  existingItems: PRDItem[],
): ConflictReport {
  const conflicts: RecommendationConflict[] = [];
  const conflictingSet = new Set<number>();

  // 1. Check each recommendation against existing PRD items.
  //    Skip completed items — they represent finished work, and new
  //    recommendations with similar titles represent new findings that
  //    need separate attention (e.g. "Address observation issues (4 findings)"
  //    is genuinely new work even if "(1 findings)" was already completed).
  for (let i = 0; i < recommendations.length; i++) {
    const rec = recommendations[i];
    let best: ScoredCandidate | null = null;

    for (const { item } of walkTree(existingItems)) {
      if (item.status === "completed") continue;
      const candidate = scoreRecommendationAgainstItem(rec, item);
      if (!candidate) continue;
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }

    if (best) {
      conflicts.push({
        recommendationIndex: i,
        recommendationTitle: rec.title,
        matchedItem: {
          id: best.item.id,
          title: best.item.title,
          level: best.item.level,
          status: best.item.status,
        },
        reason: best.reason,
        score: best.score,
      });
      conflictingSet.add(i);
    }
  }

  // 2. Detect intra-batch duplicates.
  //
  //    Intra-batch detection is deliberately stricter than existing-item
  //    conflict detection because recommendations from the same source
  //    often share template patterns (e.g. "Address X issues (N findings)")
  //    that inflate title similarity without meaning the items are duplicates.
  //
  //    A pair is flagged only when:
  //    - The exact normalized titles match (score >= 0.95), OR
  //    - BOTH title AND content similarity independently exceed the threshold.
  //
  //    This avoids false positives from template-generated titles while still
  //    catching genuine duplicates that share both title and description.
  const intraBatchDuplicates: IntraBatchDuplicate[] = [];
  for (let i = 0; i < recommendations.length; i++) {
    for (let j = i + 1; j < recommendations.length; j++) {
      const titleScore = similarity(
        recommendations[i].title,
        recommendations[j].title,
      );

      // Near-exact title match is always a duplicate
      if (titleScore >= 0.95) {
        intraBatchDuplicates.push({
          indexA: i,
          indexB: j,
          titleA: recommendations[i].title,
          titleB: recommendations[j].title,
          score: titleScore,
        });
        conflictingSet.add(j);
        continue;
      }

      // For non-exact matches, require both title AND content to exceed
      // the stricter intra-batch threshold to avoid template false positives
      const contentA = buildRecommendationContent(recommendations[i]);
      const contentB = buildRecommendationContent(recommendations[j]);
      const contentScore =
        contentA.length > 0 && contentB.length > 0
          ? similarity(contentA, contentB)
          : 0;

      if (
        titleScore >= INTRA_BATCH_THRESHOLD &&
        contentScore >= INTRA_BATCH_THRESHOLD
      ) {
        const blended = Math.max(
          titleScore * 0.75 + contentScore * 0.25,
          contentScore * 0.7,
        );
        intraBatchDuplicates.push({
          indexA: i,
          indexB: j,
          titleA: recommendations[i].title,
          titleB: recommendations[j].title,
          score: blended,
        });
        conflictingSet.add(j);
      }
    }
  }

  // 3. Build safe indices (those not in any conflict)
  const safeIndices: number[] = [];
  for (let i = 0; i < recommendations.length; i++) {
    if (!conflictingSet.has(i)) {
      safeIndices.push(i);
    }
  }

  return {
    conflicts,
    intraBatchDuplicates,
    hasConflicts: conflictingSet.size > 0,
    safeIndices,
    conflictingIndices: [...conflictingSet].sort((a, b) => a - b),
  };
}

/**
 * Format a human-readable summary of a conflict for CLI output.
 */
export function formatConflict(conflict: RecommendationConflict): string {
  const pct = Math.round(conflict.score * 100);
  const statusNote = conflict.matchedItem.status === "completed"
    ? " (completed)"
    : conflict.matchedItem.status === "in_progress"
      ? " (in progress)"
      : "";
  const reasonLabel =
    conflict.reason === "exact_title" ? "exact title match" :
    conflict.reason === "semantic_title" ? "similar title" :
    "overlapping content";

  return (
    `"${conflict.recommendationTitle}" conflicts with existing ` +
    `${conflict.matchedItem.level} "${conflict.matchedItem.title}"${statusNote} ` +
    `(${reasonLabel}, ${pct}% similarity)`
  );
}

/**
 * Format a human-readable summary of an intra-batch duplicate.
 */
export function formatIntraBatchDuplicate(dup: IntraBatchDuplicate): string {
  const pct = Math.round(dup.score * 100);
  return (
    `Recommendations #${dup.indexA + 1} "${dup.titleA}" and ` +
    `#${dup.indexB + 1} "${dup.titleB}" are duplicates (${pct}% similarity)`
  );
}
