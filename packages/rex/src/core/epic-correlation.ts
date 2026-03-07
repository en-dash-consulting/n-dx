/**
 * Epic correlation recovery — suggests parent epics for orphaned features.
 *
 * Analyzes epicless features and ranks available epics by semantic similarity,
 * enabling automated reparenting with user approval. Combines multiple signals:
 *
 * 1. Title similarity (bigram Dice + word overlap via dedupe.similarity)
 * 2. Description similarity when both feature and epic have descriptions
 * 3. Tag overlap bonus for shared tags
 * 4. Child-content signal: similarity between feature children titles and epic children titles
 *
 * @module core/epic-correlation
 */

import type { PRDItem } from "../schema/index.js";
import { isRootLevel } from "../schema/index.js";
import type { EpiclessFeature } from "./structural.js";
import { similarity } from "../analyze/dedupe.js";
import { extractKeywords } from "./keywords.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface EpicCandidate {
  /** The epic's ID. */
  epicId: string;
  /** The epic's title. */
  epicTitle: string;
  /** Combined similarity score (0.0–1.0). */
  score: number;
  /** Breakdown of individual signal scores for transparency. */
  signals: CorrelationSignals;
}

export interface CorrelationSignals {
  /** Title similarity between feature and epic (0.0–1.0). */
  titleSimilarity: number;
  /** Description similarity, or 0 if either lacks a description. */
  descriptionSimilarity: number;
  /** Fraction of shared tags (0.0–1.0), or 0 if no tags on either side. */
  tagOverlap: number;
  /** Similarity of child content (aggregated child titles), or 0 if insufficient data. */
  childContentSimilarity: number;
}

export interface CorrelationResult {
  /** The orphaned feature being analyzed. */
  featureId: string;
  featureTitle: string;
  /** Ranked candidate epics, best match first. */
  candidates: EpicCandidate[];
  /** Whether a high-confidence match was found (score >= highConfidenceThreshold). */
  hasHighConfidence: boolean;
}

export interface CorrelationOptions {
  /** Minimum score to include a candidate. Default: 0.15 */
  minScore?: number;
  /** Score threshold for "high confidence" flag. Default: 0.5 */
  highConfidenceThreshold?: number;
  /** Maximum number of candidates to return per feature. Default: 5 */
  maxCandidates?: number;
}

// ── Signal weights ───────────────────────────────────────────────────────────

/**
 * Weights for combining individual signals into a final score.
 * Title similarity is the strongest signal; tag overlap and child content
 * provide supporting evidence.
 */
const WEIGHTS = {
  title: 0.45,
  description: 0.25,
  tags: 0.10,
  childContent: 0.20,
} as const;

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MIN_SCORE = 0.15;
const DEFAULT_HIGH_CONFIDENCE = 0.5;
const DEFAULT_MAX_CANDIDATES = 5;

// ── Core logic ───────────────────────────────────────────────────────────────

/**
 * Compute tag overlap ratio between two sets of tags.
 * Returns 0.0 when either side has no tags, 1.0 when identical.
 */
export function computeTagOverlap(
  tagsA: string[] | undefined,
  tagsB: string[] | undefined,
): number {
  if (!tagsA?.length || !tagsB?.length) return 0;

  const setA = new Set(tagsA.map((t) => t.toLowerCase()));
  const setB = new Set(tagsB.map((t) => t.toLowerCase()));

  let intersection = 0;
  for (const tag of setA) {
    if (setB.has(tag)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Build an aggregated content string from an item's children titles.
 * Used to compare what a feature/epic "contains" at a topical level.
 */
function aggregateChildContent(item: PRDItem): string {
  const children = (item.children ?? []).filter((c) => c.status !== "deleted");
  if (children.length === 0) return "";

  return children.map((c) => c.title).join(" ");
}

/**
 * Compute all correlation signals between a feature and an epic.
 */
export function computeCorrelationSignals(
  feature: PRDItem,
  epic: PRDItem,
): CorrelationSignals {
  // 1. Title similarity
  const titleSimilarity = similarity(feature.title, epic.title);

  // 2. Description similarity
  let descriptionSimilarity = 0;
  if (feature.description && epic.description) {
    descriptionSimilarity = similarity(feature.description, epic.description);
  }

  // 3. Tag overlap
  const tagOverlap = computeTagOverlap(feature.tags, epic.tags);

  // 4. Child content similarity
  let childContentSimilarity = 0;
  const featureContent = aggregateChildContent(feature);
  const epicContent = aggregateChildContent(epic);
  if (featureContent.length > 0 && epicContent.length > 0) {
    childContentSimilarity = similarity(featureContent, epicContent);
  }

  return {
    titleSimilarity,
    descriptionSimilarity,
    tagOverlap,
    childContentSimilarity,
  };
}

/**
 * Compute the combined score from individual signals.
 *
 * When description data is missing, its weight is redistributed to title
 * to avoid penalizing items that simply lack descriptions.
 */
export function computeCombinedScore(signals: CorrelationSignals): number {
  const hasDescription = signals.descriptionSimilarity > 0;

  // Redistribute description weight to title when no description data
  const titleWeight = hasDescription
    ? WEIGHTS.title
    : WEIGHTS.title + WEIGHTS.description;
  const descWeight = hasDescription ? WEIGHTS.description : 0;

  return (
    signals.titleSimilarity * titleWeight +
    signals.descriptionSimilarity * descWeight +
    signals.tagOverlap * WEIGHTS.tags +
    signals.childContentSimilarity * WEIGHTS.childContent
  );
}

/**
 * Score and rank all available epics for a single orphaned feature.
 *
 * Returns candidates sorted by score descending, filtered by minScore
 * and capped at maxCandidates.
 */
export function rankEpicsForFeature(
  feature: PRDItem,
  availableEpics: PRDItem[],
  options: CorrelationOptions = {},
): EpicCandidate[] {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  const candidates: EpicCandidate[] = [];

  for (const epic of availableEpics) {
    const signals = computeCorrelationSignals(feature, epic);
    const score = computeCombinedScore(signals);

    if (score >= minScore) {
      candidates.push({
        epicId: epic.id,
        epicTitle: epic.title,
        score,
        signals,
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, maxCandidates);
}

/**
 * Analyze all epicless features and produce correlation results.
 *
 * This is the main entry point for the correlation recovery workflow.
 * For each orphaned feature detected by structural validation, it:
 * 1. Finds the full PRDItem from the document items
 * 2. Scores all available epics using multi-signal similarity
 * 3. Returns ranked candidates with a high-confidence flag
 *
 * @param items       Full PRD items array (for resolving features and epics)
 * @param epicless    Epicless features detected by findEpiclessFeatures()
 * @param options     Scoring configuration
 * @returns One CorrelationResult per epicless feature, in input order
 */
export function correlateEpiclessFeatures(
  items: PRDItem[],
  epicless: EpiclessFeature[],
  options: CorrelationOptions = {},
): CorrelationResult[] {
  const highConfidence =
    options.highConfidenceThreshold ?? DEFAULT_HIGH_CONFIDENCE;

  // Collect available epics (non-deleted root-level epics)
  const availableEpics = items.filter(
    (item) => isRootLevel(item.level) && item.status !== "deleted",
  );

  const results: CorrelationResult[] = [];

  for (const ef of epicless) {
    // Find the full PRDItem for this epicless feature
    const featureItem = items.find((i) => i.id === ef.itemId);
    if (!featureItem) {
      // Feature was removed between detection and correlation — skip
      results.push({
        featureId: ef.itemId,
        featureTitle: ef.title,
        candidates: [],
        hasHighConfidence: false,
      });
      continue;
    }

    const candidates = rankEpicsForFeature(
      featureItem,
      availableEpics,
      options,
    );

    results.push({
      featureId: ef.itemId,
      featureTitle: ef.title,
      candidates,
      hasHighConfidence:
        candidates.length > 0 && candidates[0].score >= highConfidence,
    });
  }

  return results;
}

/**
 * Format a score as a percentage string (e.g. "73%").
 */
export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}
