/**
 * Atomic PRD item creation from selected recommendations.
 *
 * Replaces the previous inline accept loop in the recommend CLI command
 * with a function that validates, creates, and persists items atomically.
 * If any validation fails, no items are created (all-or-nothing).
 *
 * Uses the same validation pipeline as `cmdAdd`:
 * - Level hierarchy validation for parent-child relationships
 * - DAG integrity checks (no duplicate IDs, no orphan blockedBy refs)
 * - Schema validation via store.saveDocument()
 *
 * @module recommend/create-from-recommendations
 */

import { randomUUID } from "node:crypto";
import type { PRDStore } from "../store/contracts.js";
import type { PRDItem, ItemLevel } from "../schema/index.js";
import { LEVEL_HIERARCHY, CHILD_LEVEL, isLeafLevel, getLevelLabel } from "../schema/index.js";
import { findItem, insertChild } from "../core/tree.js";
import { validateDAG } from "../core/dag.js";
import {
  detectRecommendationConflicts,
} from "./conflict-detection.js";
import type { ConflictReport } from "./conflict-detection.js";

// Re-export shared types for backwards compatibility — downstream
// consumers that imported from this module continue to work.
export type {
  EnrichedRecommendation,
  RecommendationMeta,
  ConflictStrategy,
} from "./types.js";
import type {
  EnrichedRecommendation,
  ConflictStrategy,
} from "./types.js";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Options for {@link createItemsFromRecommendations}.
 */
export interface CreationOptions {
  /**
   * How to handle recommendations that conflict with existing PRD items
   * or with each other. Defaults to `"force"` (no conflict checking)
   * for backwards compatibility.
   */
  conflictStrategy?: ConflictStrategy;
}

/**
 * A recommendation that was skipped due to a conflict.
 */
export interface SkippedRecommendation {
  /** Index of the recommendation in the original input array. */
  index: number;
  /** Title of the skipped recommendation. */
  title: string;
  /** Reason the recommendation was skipped. */
  reason: string;
}

/**
 * A recommendation that was reparented as a child of a completed item.
 */
export interface ReparentedRecommendation {
  /** Index of the recommendation in the original input array. */
  index: number;
  /** Title of the recommendation. */
  title: string;
  /** Original level of the recommendation before demotion. */
  originalLevel: ItemLevel;
  /** New (demoted) level of the recommendation. */
  newLevel: ItemLevel;
  /** ID of the completed parent item. */
  parentId: string;
  /** Title of the completed parent item. */
  parentTitle: string;
}

/**
 * Result of a successful batch creation.
 */
export interface CreationResult {
  /** Items that were created, in order. */
  created: Array<{
    id: string;
    title: string;
    level: ItemLevel;
    parentId?: string;
  }>;
  /** Recommendations that were skipped due to conflicts (only with skip strategy). */
  skipped?: SkippedRecommendation[];
  /** Recommendations reparented as children of completed items. */
  reparented?: ReparentedRecommendation[];
  /** Full conflict report when conflict detection was run. */
  conflictReport?: ConflictReport;
}

// ── Validation ───────────────────────────────────────────────────────

/**
 * Validate that an item can be placed under the given parent (or at root).
 *
 * When a parent is specified, validates the level hierarchy (mirrors cmdAdd).
 * When no parent is specified, root placement is allowed for any level that
 * has no strict parent-only constraint (subtasks). This is intentionally more
 * permissive than cmdAdd for root items, matching the existing recommend
 * behavior where features are created at root level from sourcevision findings.
 */
function validatePlacement(
  item: PRDItem,
  parentId: string | undefined,
  docItems: PRDItem[],
): string | null {
  const allowedParents = LEVEL_HIERARCHY[item.level];
  if (!allowedParents) {
    return `Unknown level "${item.level}" for item "${item.title}".`;
  }

  const allowedParentLevels = allowedParents.filter(
    (p): p is ItemLevel => p !== null,
  );

  if (parentId) {
    // Validate parent exists and level hierarchy is respected
    const parentEntry = findItem(docItems, parentId);
    if (!parentEntry) {
      return `Parent "${parentId}" not found for item "${item.title}".`;
    }
    if (
      allowedParentLevels.length > 0 &&
      !allowedParentLevels.includes(parentEntry.item.level)
    ) {
      const parentNames = allowedParentLevels.join(" or ");
      return (
        `A ${item.level} must be a child of a ${parentNames}, ` +
        `but "${parentId}" is a ${parentEntry.item.level}.`
      );
    }
  } else {
    // Root placement: only reject levels that strictly require a parent.
    // Leaf levels (subtasks) always need a parent; other levels are allowed
    // at root for recommendation workflows (e.g. features from sourcevision).
    const canBeRoot = allowedParents.includes(null);
    if (!canBeRoot && allowedParentLevels.length > 0) {
      // Only block if this is a leaf-only level (e.g. subtask→task)
      // Allow epics, features, and tasks at root for recommendation flexibility
      const isStrictlyChildOnly =
        allowedParentLevels.length > 0 && isLeafLevel(item.level);
      if (isStrictlyChildOnly) {
        const parentNames = allowedParentLevels.map(getLevelLabel).join(" or ");
        return `A ${getLevelLabel(item.level)} requires a parent (${parentNames}).`;
      }
    }
  }

  return null;
}

// ── Core creation ────────────────────────────────────────────────────

/**
 * Create PRD items from selected recommendations atomically.
 *
 * All items are validated upfront, then persisted in a single
 * `saveDocument()` call. If any validation fails, no items are created.
 *
 * Follows the same patterns as `cmdAdd`:
 * - Level hierarchy validation
 * - DAG integrity checks
 * - Schema validation (via saveDocument)
 * - Execution log entries for each created item
 *
 * @param store - The PRD store to read from and write to.
 * @param recommendations - Enriched recommendations to create items from.
 * @param options - Optional creation options including conflict strategy.
 * @returns Creation result with IDs and metadata of created items.
 * @throws If validation fails for any item (atomic: zero items are created).
 * @throws If conflict strategy is "error" and conflicts are detected.
 */
export async function createItemsFromRecommendations(
  store: PRDStore,
  recommendations: readonly EnrichedRecommendation[],
  options?: CreationOptions,
): Promise<CreationResult> {
  if (recommendations.length === 0) {
    return { created: [] };
  }

  const strategy = options?.conflictStrategy ?? "force";

  // 1. Load current document for validation and conflict detection
  const doc = await store.loadDocument();

  // 2. Run conflict detection when strategy is not "force"
  let conflictReport: ConflictReport | undefined;
  let effectiveRecommendations = recommendations;
  const skipped: SkippedRecommendation[] = [];
  const reparented: ReparentedRecommendation[] = [];

  if (strategy !== "force") {
    conflictReport = detectRecommendationConflicts(recommendations, doc.items);

    if (conflictReport.hasConflicts) {
      if (strategy === "error") {
        const messages: string[] = [];
        for (const c of conflictReport.conflicts) {
          messages.push(
            `"${c.recommendationTitle}" conflicts with existing ${c.matchedItem.level} "${c.matchedItem.title}" (${c.reason}, ${Math.round(c.score * 100)}% match)`,
          );
        }
        for (const d of conflictReport.intraBatchDuplicates) {
          messages.push(
            `Recommendations "${d.titleA}" and "${d.titleB}" are intra-batch duplicates (${Math.round(d.score * 100)}% match)`,
          );
        }
        throw new Error(
          `Conflict detection found ${conflictReport.conflictingIndices.length} conflicting recommendation(s):\n${messages.join("\n")}`,
        );
      }

      // strategy === "skip": split completed-item conflicts (reparent) from active conflicts (skip)
      const reparentedRecs: EnrichedRecommendation[] = [];

      for (const idx of conflictReport.conflictingIndices) {
        const rec = recommendations[idx];
        const conflict = conflictReport.conflicts.find(
          (c) => c.recommendationIndex === idx,
        );
        const intraDup = conflictReport.intraBatchDuplicates.find(
          (d) => d.indexB === idx,
        );

        // Completed-item conflicts: reparent as child (if level allows demotion
        // AND the matched item's level is a valid parent for the demoted level)
        if (conflict && conflict.matchedItem.status === "completed") {
          const childLevel = CHILD_LEVEL[rec.level];
          const allowedParents = childLevel ? LEVEL_HIERARCHY[childLevel] : undefined;
          const parentLevelValid = allowedParents?.some(
            (p) => p === conflict.matchedItem.level,
          );
          if (childLevel && parentLevelValid) {
            reparented.push({
              index: idx,
              title: rec.title,
              originalLevel: rec.level,
              newLevel: childLevel,
              parentId: conflict.matchedItem.id,
              parentTitle: conflict.matchedItem.title,
            });
            reparentedRecs.push({
              ...rec,
              level: childLevel,
              parentId: conflict.matchedItem.id,
            });
            continue;
          }
          // subtask has no child level — fall through to skip
        }

        const reason = conflict
          ? `Conflicts with existing ${conflict.matchedItem.level} "${conflict.matchedItem.title}"`
          : intraDup
            ? `Duplicate of recommendation "${intraDup.titleA}"`
            : "Detected as conflicting";
        skipped.push({ index: idx, title: rec.title, reason });
      }

      effectiveRecommendations = [
        ...conflictReport.safeIndices.map((i) => recommendations[i]),
        ...reparentedRecs,
      ];

      if (effectiveRecommendations.length === 0) {
        const result: CreationResult = { created: [], skipped, conflictReport };
        if (reparented.length > 0) result.reparented = reparented;
        return result;
      }
    }
  }

  // 3. Build PRDItems from effective recommendations
  const pending: Array<{ item: PRDItem; parentId?: string }> = [];
  for (const rec of effectiveRecommendations) {
    const item: PRDItem = {
      id: randomUUID(),
      title: rec.title,
      status: "pending",
      level: rec.level,
      description: rec.description,
      priority: rec.priority,
      source: rec.source,
    };

    if (rec.tags && rec.tags.length > 0) {
      item.tags = rec.tags;
    }

    // Preserve recommendation metadata for traceability
    if (rec.meta) {
      item.recommendationMeta = rec.meta;
    }

    pending.push({ item, parentId: rec.parentId });
  }

  // 4. Validate placement (level hierarchy) for each item
  const placementErrors: string[] = [];
  for (const { item, parentId } of pending) {
    const err = validatePlacement(item, parentId, doc.items);
    if (err) placementErrors.push(err);
  }
  if (placementErrors.length > 0) {
    throw new Error(
      `Placement validation failed:\n${placementErrors.join("\n")}`,
    );
  }

  // 5. Add all items to the in-memory document
  for (const { item, parentId } of pending) {
    if (parentId) {
      const inserted = insertChild(doc.items, parentId, item);
      if (!inserted) {
        throw new Error(
          `Failed to insert "${item.title}" under parent "${parentId}".`,
        );
      }
    } else {
      doc.items.push(item);
    }
  }

  // 6. Validate DAG integrity with all new items in place
  const dagResult = validateDAG(doc.items);
  if (!dagResult.valid) {
    throw new Error(
      `DAG validation failed after adding recommendations: ${dagResult.errors.join("; ")}`,
    );
  }

  // 7. Persist atomically — single write for all items
  await store.saveDocument(doc);

  // 8. Log creation events
  const created: CreationResult["created"] = [];
  for (const { item, parentId } of pending) {
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "item_added",
      itemId: item.id,
      detail: `Added ${item.level} from recommendation: ${item.title}`,
    });
    created.push({
      id: item.id,
      title: item.title,
      level: item.level,
      parentId,
    });
  }

  const result: CreationResult = { created };
  if (skipped.length > 0) result.skipped = skipped;
  if (reparented.length > 0) result.reparented = reparented;
  if (conflictReport) result.conflictReport = conflictReport;
  return result;
}
