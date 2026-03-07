import type { PRDItem } from "../schema/index.js";
import { getLevelLabel } from "../schema/index.js";
import { findItem, walkTree } from "./tree.js";
import { deleteItem, cleanBlockedByRefs } from "./delete.js";
import { extractSyncMeta } from "./sync.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * An external item that depends on something inside the feature's subtree
 * via `blockedBy`.
 */
export interface ExternalDependent {
  /** ID of the item that has the blockedBy reference. */
  itemId: string;
  /** Title of the item that has the blockedBy reference. */
  title: string;
  /** The ID within the feature's subtree that this item is blocked by. */
  blockedById: string;
}

/**
 * An item inside the feature's subtree that carries sync metadata
 * (has been synced to an external system).
 */
export interface SyncedItem {
  /** ID of the synced item. */
  itemId: string;
  /** Title of the synced item. */
  title: string;
  /** Remote system identifier. */
  remoteId: string;
}

/**
 * Result of pre-deletion integrity checks for a feature.
 *
 * Inspects the feature's subtree for external blockedBy references
 * and sync metadata that could indicate corruption risk if deleted.
 */
export interface DeletionPreCheck {
  /** ID of the feature being checked. */
  featureId: string;
  /** Title of the feature being checked. */
  featureTitle: string;
  /** Total number of items in the feature's subtree (including the feature). */
  subtreeCount: number;
  /** Items outside the subtree that reference items inside via blockedBy. */
  externalDependents: ExternalDependent[];
  /** Items in the subtree that have sync metadata (remoteId). */
  syncedItems: SyncedItem[];
  /** Whether deletion is safe (no external dependents, no synced items). */
  safe: boolean;
  /** Warning messages summarising the risks. */
  warnings: string[];
}

/**
 * Result of a {@link removeFeature} operation.
 *
 * On success, `ok` is `true` and `deletedIds` contains the IDs of every
 * item removed (the feature itself plus all descendants). On failure,
 * `ok` is `false`, `error` explains why, and the tree is left unchanged.
 */
export interface RemoveFeatureResult {
  /** Whether the removal succeeded. */
  ok: boolean;
  /** IDs of all items removed (feature + descendants). Empty on failure. */
  deletedIds: string[];
  /** Human-readable description of what happened. */
  detail: string;
  /** Error message when `ok` is `false`. Undefined on success. */
  error?: string;
  /** Number of blockedBy references cleaned up in remaining items. */
  cleanedRefs: number;
}

// ── Pre-check ────────────────────────────────────────────────────────────────

/**
 * Run pre-deletion integrity checks on a feature.
 *
 * Inspects the feature's subtree for:
 * 1. **External dependents** — items outside the subtree that reference
 *    items inside via `blockedBy`. Deleting would leave dangling references.
 * 2. **Synced items** — items in the subtree that carry sync metadata
 *    (`remoteId`). Deleting locally without syncing the deletion to the
 *    remote system risks data corruption.
 *
 * @param items     - The root-level PRD item array (read-only).
 * @param featureId - The ID of the feature to check.
 * @returns Pre-check result with safety assessment and warnings.
 */
export function preCheckFeatureDeletion(
  items: PRDItem[],
  featureId: string,
): DeletionPreCheck {
  const entry = findItem(items, featureId);
  if (!entry) {
    return {
      featureId,
      featureTitle: "",
      subtreeCount: 0,
      externalDependents: [],
      syncedItems: [],
      safe: false,
      warnings: [`Feature "${featureId}" not found in the PRD tree.`],
    };
  }

  if (entry.item.level !== "feature") {
    return {
      featureId,
      featureTitle: entry.item.title,
      subtreeCount: 0,
      externalDependents: [],
      syncedItems: [],
      safe: false,
      warnings: [`Item "${featureId}" is a ${getLevelLabel(entry.item.level)}, not a ${getLevelLabel("feature")}.`],
    };
  }

  // Collect all IDs in the feature's subtree
  const subtreeIds = new Set<string>();
  function collectIds(item: PRDItem): void {
    subtreeIds.add(item.id);
    if (item.children) {
      for (const child of item.children) {
        collectIds(child);
      }
    }
  }
  collectIds(entry.item);

  // Find external dependents: items outside the subtree whose blockedBy
  // references point to items inside the subtree
  const externalDependents: ExternalDependent[] = [];
  for (const { item } of walkTree(items)) {
    if (subtreeIds.has(item.id)) continue; // skip items inside the subtree
    if (!item.blockedBy || item.blockedBy.length === 0) continue;

    for (const ref of item.blockedBy) {
      if (subtreeIds.has(ref)) {
        externalDependents.push({
          itemId: item.id,
          title: item.title,
          blockedById: ref,
        });
      }
    }
  }

  // Find synced items: items in the subtree with remoteId
  const syncedItems: SyncedItem[] = [];
  function checkSync(item: PRDItem): void {
    const meta = extractSyncMeta(item);
    if (meta.remoteId) {
      syncedItems.push({
        itemId: item.id,
        title: item.title,
        remoteId: meta.remoteId,
      });
    }
    if (item.children) {
      for (const child of item.children) {
        checkSync(child);
      }
    }
  }
  checkSync(entry.item);

  // Build warnings
  const warnings: string[] = [];

  if (externalDependents.length > 0) {
    const depCount = externalDependents.length;
    const preview = externalDependents
      .slice(0, 3)
      .map((d) => `"${d.title}" [${d.itemId.slice(0, 8)}]`)
      .join(", ");
    const more = depCount > 3 ? ` +${depCount - 3} more` : "";
    warnings.push(
      `${depCount} external item${depCount === 1 ? "" : "s"} depend${depCount === 1 ? "s" : ""} on items in this feature: ${preview}${more}. ` +
      `Their blockedBy references will be removed.`,
    );
  }

  if (syncedItems.length > 0) {
    const syncCount = syncedItems.length;
    const preview = syncedItems
      .slice(0, 3)
      .map((s) => `"${s.title}" [${s.itemId.slice(0, 8)}]`)
      .join(", ");
    const more = syncCount > 3 ? ` +${syncCount - 3} more` : "";
    warnings.push(
      `${syncCount} item${syncCount === 1 ? "" : "s"} in this feature ${syncCount === 1 ? "is" : "are"} synced to an external system: ${preview}${more}. ` +
      `Deleting locally may cause data inconsistency with the remote.`,
    );
  }

  const safe = externalDependents.length === 0 && syncedItems.length === 0;

  return {
    featureId,
    featureTitle: entry.item.title,
    subtreeCount: subtreeIds.size,
    externalDependents,
    syncedItems,
    safe,
    warnings,
  };
}

// ── Removal ──────────────────────────────────────────────────────────────────

/**
 * Remove a feature and all its descendants from the PRD tree with
 * full integrity protection.
 *
 * This is a safe, atomic operation:
 * - Validates the target exists and is actually a feature before mutating.
 * - Removes the feature and every nested task/subtask.
 * - Cleans up `blockedBy` references in remaining items that pointed
 *   to any of the deleted items.
 *
 * The function mutates `items` in place (consistent with {@link deleteItem}
 * and {@link removeEpic}).
 *
 * @param items     - The root-level PRD item array (mutated on success).
 * @param featureId - The ID of the feature to remove.
 * @returns A result object describing success/failure, deleted IDs, and
 *          the number of cleaned-up blockedBy references.
 */
export function removeFeature(
  items: PRDItem[],
  featureId: string,
): RemoveFeatureResult {
  // 1. Validate the item exists
  const entry = findItem(items, featureId);
  if (!entry) {
    return {
      ok: false,
      deletedIds: [],
      detail: `Feature "${featureId}" not found.`,
      error: `Item "${featureId}" not found in the PRD tree.`,
      cleanedRefs: 0,
    };
  }

  // 2. Validate it's actually a feature
  if (entry.item.level !== "feature") {
    return {
      ok: false,
      deletedIds: [],
      detail: `Item "${featureId}" is a ${getLevelLabel(entry.item.level)}, not a ${getLevelLabel("feature")}.`,
      error: `Item "${entry.item.title}" (${featureId}) is not a ${getLevelLabel("feature")} — it is a ${getLevelLabel(entry.item.level)}.`,
      cleanedRefs: 0,
    };
  }

  const featureTitle = entry.item.title;

  // 3. Delete the feature and all descendants
  const deletedIds = deleteItem(items, featureId);
  const deletedSet = new Set(deletedIds);

  // 4. Clean up blockedBy references pointing to deleted items.
  //    Count how many individual references are removed.
  let cleanedRefs = 0;
  for (const { item } of walkTree(items)) {
    if (item.blockedBy && item.blockedBy.length > 0) {
      const before = item.blockedBy.length;
      item.blockedBy = item.blockedBy.filter((ref) => !deletedSet.has(ref));
      cleanedRefs += before - item.blockedBy.length;
      if (item.blockedBy.length === 0) {
        delete item.blockedBy;
      }
    }
  }

  return {
    ok: true,
    deletedIds,
    detail: `Removed feature: ${featureTitle} (${deletedIds.length} item(s) deleted, ${cleanedRefs} reference(s) cleaned)`,
    cleanedRefs,
  };
}
