/**
 * Bidirectional sync engine for PRDStore instances.
 *
 * Coordinates between a local store and a remote store using the primitives
 * from `sync.ts` (conflict detection, resolution, timestamping). Supports
 * three sync modes:
 *
 * - **push**: local → remote (send local changes out)
 * - **pull**: remote → local (fetch remote changes in)
 * - **sync**: bidirectional (push + pull with unified conflict resolution)
 *
 * The engine operates on flat item maps built from each store's document tree,
 * then writes the merged result back to both stores.
 */

import type { PRDStore } from "../store/contracts.js";
import type { PRDItem, PRDDocument } from "../schema/index.js";
import { walkTree } from "./tree.js";
import {
  detectChangedFields,
  isModifiedSinceSync,
  resolveConflicts,
  stampSynced,
  extractSyncMeta,
  conflictToLogEntry,
  type ConflictRecord,
} from "./sync.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SyncDirection = "push" | "pull" | "sync";

export interface SyncReport {
  direction: SyncDirection;
  /** Items pushed from local to remote */
  pushed: string[];
  /** Items pulled from remote to local */
  pulled: string[];
  /** Items unchanged and skipped */
  skipped: string[];
  /** Conflicts detected and resolved */
  conflicts: ConflictRecord[];
  /** Items deleted from remote during sync */
  deleted: string[];
  /** Errors encountered during sync */
  errors: Array<{ itemId: string; error: string }>;
  /** ISO 8601 timestamp of the sync operation */
  timestamp: string;
}

export interface SyncOptions {
  /** Set of item IDs that were locally deleted since last sync. */
  deletions?: Set<string>;
}

// ---------------------------------------------------------------------------
// SyncEngine
// ---------------------------------------------------------------------------

export class SyncEngine {
  constructor(
    private local: PRDStore,
    private remote: PRDStore,
  ) {}

  /**
   * Push local changes to the remote store.
   * Items modified locally since last sync are written to remote.
   * If the remote also changed the same item, conflict resolution applies.
   */
  async push(): Promise<SyncReport> {
    const now = new Date().toISOString();
    const report = emptyReport("push", now);

    const localDoc = await this.local.loadDocument();
    const remoteDoc = await this.remote.loadDocument();

    const localMap = buildItemMap(localDoc.items);
    const remoteMap = buildItemMap(remoteDoc.items);

    // Track items that were conflict-merged so local gets the merged values too
    const conflictMergedIds = new Set<string>();

    // Process all local items
    for (const [id, localItem] of localMap) {
      const remoteItem = remoteMap.get(id);

      if (!remoteItem) {
        // New local item — push to remote
        report.pushed.push(id);
        continue;
      }

      const changedFields = detectChangedFields(localItem, remoteItem);
      if (changedFields.length === 0) {
        report.skipped.push(id);
        continue;
      }

      const localModified = isModifiedSinceSync(localItem);
      if (!localModified) {
        report.skipped.push(id);
        continue;
      }

      const remoteMeta = extractSyncMeta(remoteItem);
      const localMeta = extractSyncMeta(localItem);
      const remoteModified = remoteMeta.lastModified
        ? !localMeta.lastSyncedAt || remoteMeta.lastModified > localMeta.lastSyncedAt
        : false;

      if (remoteModified) {
        // Both modified — resolve conflict
        const { merged, conflicts } = resolveConflicts(
          localItem,
          remoteItem,
          remoteMeta.lastModified,
        );
        report.conflicts.push(...conflicts);
        localMap.set(id, merged);
        conflictMergedIds.add(id);
        report.pushed.push(id);
      } else {
        // Only local changed
        report.pushed.push(id);
      }
    }

    // Build and save the merged remote document
    const mergedRemoteItems = mergeItemsIntoTree(
      remoteDoc,
      localMap,
      new Set(report.pushed),
      localDoc,
    );
    remoteDoc.items = stampAllSynced(mergedRemoteItems, now);

    // Write merged conflict values back into local so both stores converge
    if (conflictMergedIds.size > 0) {
      localDoc.items = mergeItemsIntoTree(
        localDoc,
        localMap,
        conflictMergedIds,
        localDoc,
      );
    }
    localDoc.items = stampAllSynced(localDoc.items, now);

    try {
      await this.remote.saveDocument(remoteDoc);
      await this.local.saveDocument(localDoc);
    } catch (err) {
      report.errors.push({
        itemId: "*",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return report;
  }

  /**
   * Pull remote changes to the local store.
   * Items modified remotely since last sync are written to local.
   * If the local also changed the same item, conflict resolution applies.
   */
  async pull(): Promise<SyncReport> {
    const now = new Date().toISOString();
    const report = emptyReport("pull", now);

    const localDoc = await this.local.loadDocument();
    const remoteDoc = await this.remote.loadDocument();

    const localMap = buildItemMap(localDoc.items);
    const remoteMap = buildItemMap(remoteDoc.items);

    // Track items that were conflict-merged so remote gets the merged values too
    const conflictMergedIds = new Set<string>();

    // Process all remote items
    for (const [id, remoteItem] of remoteMap) {
      const localItem = localMap.get(id);

      if (!localItem) {
        // New remote item — pull to local
        report.pulled.push(id);
        continue;
      }

      const changedFields = detectChangedFields(localItem, remoteItem);
      if (changedFields.length === 0) {
        report.skipped.push(id);
        continue;
      }

      const remoteMeta = extractSyncMeta(remoteItem);
      const remoteModified = remoteMeta.lastModified
        ? !remoteMeta.lastSyncedAt || remoteMeta.lastModified > remoteMeta.lastSyncedAt
        : false;

      if (!remoteModified) {
        report.skipped.push(id);
        continue;
      }

      const localModified = isModifiedSinceSync(localItem);

      if (localModified) {
        // Both modified — resolve conflict
        const { merged, conflicts } = resolveConflicts(
          localItem,
          remoteItem,
          remoteMeta.lastModified,
        );
        report.conflicts.push(...conflicts);
        remoteMap.set(id, merged);
        conflictMergedIds.add(id);
        report.pulled.push(id);
      } else {
        // Only remote changed
        report.pulled.push(id);
      }
    }

    // Build and save the merged local document
    const mergedLocalItems = mergeItemsIntoTree(
      localDoc,
      remoteMap,
      new Set(report.pulled),
      remoteDoc,
    );
    localDoc.items = stampAllSynced(mergedLocalItems, now);

    // Write merged conflict values back into remote so both stores converge
    if (conflictMergedIds.size > 0) {
      remoteDoc.items = mergeItemsIntoTree(
        remoteDoc,
        remoteMap,
        conflictMergedIds,
        remoteDoc,
      );
    }
    remoteDoc.items = stampAllSynced(remoteDoc.items, now);

    try {
      await this.local.saveDocument(localDoc);
      await this.remote.saveDocument(remoteDoc);
    } catch (err) {
      report.errors.push({
        itemId: "*",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return report;
  }

  /**
   * Full bidirectional sync: push local changes, pull remote changes,
   * resolve any conflicts with last-write-wins.
   */
  async sync(options?: SyncOptions): Promise<SyncReport> {
    const now = new Date().toISOString();
    const report = emptyReport("sync", now);
    const deletions = options?.deletions ?? new Set<string>();

    const localDoc = await this.local.loadDocument();
    const remoteDoc = await this.remote.loadDocument();

    const localMap = buildItemMap(localDoc.items);
    const remoteMap = buildItemMap(remoteDoc.items);

    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
    const mergedMap = new Map<string, PRDItem>();

    for (const id of allIds) {
      const localItem = localMap.get(id);
      const remoteItem = remoteMap.get(id);

      // Handle deletions
      if (deletions.has(id)) {
        report.deleted.push(id);
        // Don't include in merged — item is deleted
        continue;
      }

      if (localItem && !remoteItem) {
        // Local only — push
        report.pushed.push(id);
        mergedMap.set(id, localItem);
        continue;
      }

      if (!localItem && remoteItem) {
        // Remote only — pull
        report.pulled.push(id);
        mergedMap.set(id, remoteItem);
        continue;
      }

      if (localItem && remoteItem) {
        const changedFields = detectChangedFields(localItem, remoteItem);
        if (changedFields.length === 0) {
          report.skipped.push(id);
          mergedMap.set(id, localItem);
          continue;
        }

        const localModified = isModifiedSinceSync(localItem);
        const remoteMeta = extractSyncMeta(remoteItem);
        const localMeta = extractSyncMeta(localItem);
        const remoteModified = remoteMeta.lastModified
          ? !localMeta.lastSyncedAt || remoteMeta.lastModified > localMeta.lastSyncedAt
          : false;

        if (localModified && remoteModified) {
          // True conflict — both sides changed
          const { merged, conflicts } = resolveConflicts(
            localItem,
            remoteItem,
            remoteMeta.lastModified,
          );
          report.conflicts.push(...conflicts);
          mergedMap.set(id, merged);
          // Determine whether it was effectively a push or pull
          const winner = conflicts.length > 0 && conflicts[0].resolution === "remote"
            ? "pulled" : "pushed";
          report[winner === "pulled" ? "pulled" : "pushed"].push(id);
        } else if (localModified) {
          // Only local changed — push
          report.pushed.push(id);
          mergedMap.set(id, localItem);
        } else if (remoteModified) {
          // Only remote changed — pull
          report.pulled.push(id);
          mergedMap.set(id, remoteItem);
        } else {
          // Neither modified since last sync, but fields differ
          // (e.g. both changed before any sync tracking). Treat as skip.
          report.skipped.push(id);
          mergedMap.set(id, localItem);
        }
      }
    }

    // Rebuild both trees from the merged flat map, preserving hierarchy
    const mergedLocalItems = rebuildTree(localDoc, remoteDoc, mergedMap);
    const stampedItems = stampAllSynced(mergedLocalItems, now);

    localDoc.items = stampedItems;
    remoteDoc.items = structuredClone(stampedItems);

    await this.local.saveDocument(localDoc);
    await this.remote.saveDocument(remoteDoc);

    // Log any conflicts
    for (const conflict of report.conflicts) {
      await this.local.appendLog(conflictToLogEntry(conflict));
    }

    return report;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emptyReport(direction: SyncDirection, timestamp: string): SyncReport {
  return {
    direction,
    pushed: [],
    pulled: [],
    skipped: [],
    conflicts: [],
    deleted: [],
    errors: [],
    timestamp,
  };
}

/**
 * Flatten a PRD item tree into a map keyed by item ID.
 * Preserves all fields including children references.
 */
function buildItemMap(items: PRDItem[]): Map<string, PRDItem> {
  const map = new Map<string, PRDItem>();
  for (const { item } of walkTree(items)) {
    map.set(item.id, item);
  }
  return map;
}

/**
 * Stamp all items in a tree with lastSyncedAt.
 * Returns a new array (does not mutate).
 */
function stampAllSynced(items: PRDItem[], timestamp: string): PRDItem[] {
  return items.map((item) => {
    const stamped = stampSynced(item, undefined, timestamp);
    if (item.children && item.children.length > 0) {
      stamped.children = stampAllSynced(item.children, timestamp);
    }
    return stamped;
  });
}

/**
 * Merge source items into a target document tree.
 * For items in `idsToMerge`, copies the value from sourceMap.
 * For existing items not in idsToMerge, keeps the target version.
 * For items only in sourceMap and in idsToMerge, appends at root
 * preserving their subtree from sourceDoc.
 */
function mergeItemsIntoTree(
  targetDoc: PRDDocument,
  sourceMap: Map<string, PRDItem>,
  idsToMerge: Set<string>,
  sourceDoc: PRDDocument,
): PRDItem[] {
  const targetMap = buildItemMap(targetDoc.items);
  const placedIds = new Set<string>();

  // Update existing items in-tree, tracking which IDs get placed
  const result = updateItemsInTree(targetDoc.items, sourceMap, idsToMerge, placedIds);

  // Add root-level items from the source tree that aren't already in the target.
  // We walk the source tree to preserve hierarchy (children stay nested).
  addNewItemsFromSource(sourceDoc.items, targetMap, idsToMerge, placedIds, result);

  return result;
}

/**
 * Walk the source tree and add items that exist in idsToMerge
 * but not in the target. Preserves hierarchy by recursing into children.
 */
function addNewItemsFromSource(
  sourceItems: PRDItem[],
  targetMap: Map<string, PRDItem>,
  idsToMerge: Set<string>,
  placedIds: Set<string>,
  result: PRDItem[],
): void {
  for (const item of sourceItems) {
    if (idsToMerge.has(item.id) && !targetMap.has(item.id) && !placedIds.has(item.id)) {
      // Add this item and its subtree
      const clone = structuredClone(item);
      result.push(clone);
      markPlaced(clone, placedIds);
    } else if (item.children) {
      // Item itself is already placed, but check children
      addNewItemsFromSource(item.children, targetMap, idsToMerge, placedIds, result);
    }
  }
}

/** Mark an item and all descendants as placed. */
function markPlaced(item: PRDItem, placedIds: Set<string>): void {
  placedIds.add(item.id);
  if (item.children) {
    for (const child of item.children) {
      markPlaced(child, placedIds);
    }
  }
}

/**
 * Walk a tree and replace items whose IDs are in the merge set.
 * Tracks placed IDs so callers know which items were already in the tree.
 */
function updateItemsInTree(
  items: PRDItem[],
  sourceMap: Map<string, PRDItem>,
  idsToMerge: Set<string>,
  placedIds: Set<string>,
): PRDItem[] {
  return items.map((item) => {
    let result: PRDItem;
    if (idsToMerge.has(item.id) && sourceMap.has(item.id)) {
      result = structuredClone(sourceMap.get(item.id)!);
    } else {
      result = { ...item };
    }
    placedIds.add(item.id);

    if (item.children && item.children.length > 0) {
      result.children = updateItemsInTree(item.children, sourceMap, idsToMerge, placedIds);
    }

    return result;
  });
}

/**
 * Rebuild a tree from a merged flat map, using both source trees
 * as structural references. Items are placed in hierarchy based on
 * the first tree that contains them; new items go to the root.
 */
function rebuildTree(
  localDoc: PRDDocument,
  remoteDoc: PRDDocument,
  mergedMap: Map<string, PRDItem>,
): PRDItem[] {
  // Use local tree structure as the primary skeleton
  const placedIds = new Set<string>();
  const result = rebuildBranch(localDoc.items, mergedMap, placedIds);

  // Add items from remote that weren't placed from local tree
  addUnplacedItems(remoteDoc.items, mergedMap, placedIds, result);

  // Add any remaining items from mergedMap not placed by either tree
  for (const [id, item] of mergedMap) {
    if (!placedIds.has(id)) {
      const clone = structuredClone(item);
      delete clone.children;
      result.push(clone);
      placedIds.add(id);
    }
  }

  return result;
}

function rebuildBranch(
  templateItems: PRDItem[],
  mergedMap: Map<string, PRDItem>,
  placedIds: Set<string>,
): PRDItem[] {
  const result: PRDItem[] = [];

  for (const item of templateItems) {
    const merged = mergedMap.get(item.id);
    if (!merged) continue; // Item was deleted

    const rebuilt: PRDItem = { ...structuredClone(merged) };
    delete rebuilt.children;
    placedIds.add(item.id);

    if (item.children && item.children.length > 0) {
      const children = rebuildBranch(item.children, mergedMap, placedIds);
      if (children.length > 0) {
        rebuilt.children = children;
      }
    }

    result.push(rebuilt);
  }

  return result;
}

function addUnplacedItems(
  templateItems: PRDItem[],
  mergedMap: Map<string, PRDItem>,
  placedIds: Set<string>,
  result: PRDItem[],
): void {
  for (const item of templateItems) {
    if (!placedIds.has(item.id) && mergedMap.has(item.id)) {
      const merged = mergedMap.get(item.id)!;
      const rebuilt: PRDItem = { ...structuredClone(merged) };
      delete rebuilt.children;
      placedIds.add(item.id);

      if (item.children && item.children.length > 0) {
        const children: PRDItem[] = [];
        addUnplacedItems(item.children, mergedMap, placedIds, children);
        if (children.length > 0) {
          rebuilt.children = children;
        }
      }

      result.push(rebuilt);
    }

    // Recurse into children even if this item was already placed
    // (to find unplaced grandchildren)
    if (item.children) {
      addUnplacedItems(item.children, mergedMap, placedIds, result);
    }
  }
}

/**
 * Deep clone with structural sharing avoidance.
 */
function structuredClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
