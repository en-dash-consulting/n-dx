/**
 * Shared types for the recommendation pipeline.
 *
 * Extracted from create-from-recommendations.ts to break the circular
 * dependency between create-from-recommendations ↔ conflict-detection.
 * Both modules import these types from here instead of from each other.
 *
 * @module recommend/types
 */

import type { ItemLevel, Priority } from "../schema/index.js";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Metadata carried forward from the recommendation's source findings.
 * Persisted on created PRDItems for traceability.
 */
export interface RecommendationMeta {
  /** Content hashes of the source findings that produced this recommendation. */
  findingHashes?: string[];
  /** Category of the grouped findings (e.g. "auth", "perf", "security"). */
  category?: string;
  /** Distribution of finding severities in this recommendation group. */
  severityDistribution?: Record<string, number>;
  /** Total number of findings that contributed to this recommendation. */
  findingCount?: number;
}

/**
 * Enriched recommendation carrying all metadata needed for PRD item creation.
 *
 * This is the input type for {@link createItemsFromRecommendations}.
 * Callers build these from whatever recommendation source they have
 * (sourcevision findings, manual input, etc.).
 */
export interface EnrichedRecommendation {
  /** Title for the PRD item. */
  title: string;
  /** PRD hierarchy level (epic, feature, task, subtask). */
  level: ItemLevel;
  /** Description text for the PRD item. */
  description: string;
  /** Priority derived from finding severities. */
  priority: Priority;
  /** Source identifier (e.g. "sourcevision"). */
  source: string;
  /** Parent PRD item ID. When omitted, item is added at root level. */
  parentId?: string;
  /** Tags to apply to the created item. */
  tags?: string[];
  /** Recommendation metadata for traceability. */
  meta?: RecommendationMeta;
}

/**
 * How to handle conflicting recommendations during creation.
 *
 * - `"skip"` — silently skip conflicting items; create only non-conflicting ones.
 * - `"force"` — ignore conflicts; create all items regardless.
 * - `"error"` — throw if any conflicts are detected (default for backwards compat).
 */
export type ConflictStrategy = "skip" | "force" | "error";
