import type { PRDItem, LogEntry } from "../schema/index.js";
import { walkTree } from "./tree.js";
import { resolveActor } from "./identity.js";

/**
 * Sync metadata attached to PRDItems via the `[key: string]: unknown` index.
 * Items that haven't been synced yet will lack these fields.
 */
export interface SyncMetadata {
  /** ISO 8601 timestamp of last local modification */
  lastModified?: string;
  /** Actor (git identity or OS user) who made the last local modification */
  lastModifiedBy?: string;
  /** ISO 8601 timestamp of last successful sync to/from remote */
  lastSyncedAt?: string;
  /** Opaque identifier for the item in the remote system (e.g. Notion page ID) */
  remoteId?: string;
}

export type ConflictResolution = "local" | "remote";

export interface ConflictRecord {
  itemId: string;
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  resolution: ConflictResolution;
  resolvedAt: string;
}

export interface SyncResult {
  /** Items synced without conflict */
  synced: string[];
  /** Items where conflicts were detected and resolved */
  conflicts: ConflictRecord[];
  /** Items that failed to sync (e.g. missing on one side) */
  errors: Array<{ itemId: string; error: string }>;
}

/**
 * Fields that are sync metadata and should not be compared for conflict detection.
 */
const SYNC_META_FIELDS = new Set([
  "lastModified",
  "lastModifiedBy",
  "lastSyncedAt",
  "remoteId",
  "children",
]);

/**
 * Fields considered structural and should not trigger conflict resolution.
 */
const STRUCTURAL_FIELDS = new Set(["id", "level"]);

/**
 * Detect which fields differ between a local and remote version of the same item.
 * Ignores sync metadata fields and structural fields that should never change.
 */
export function detectChangedFields(
  local: PRDItem,
  remote: PRDItem,
): string[] {
  const allKeys = new Set([
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);

  const changed: string[] = [];
  for (const key of allKeys) {
    if (SYNC_META_FIELDS.has(key) || STRUCTURAL_FIELDS.has(key)) continue;
    const lv = local[key];
    const rv = remote[key];
    if (!deepEqual(lv, rv)) {
      changed.push(key);
    }
  }

  return changed.sort();
}

/**
 * Determine whether a field was modified locally since last sync.
 * If no lastSyncedAt exists, assume the item has never been synced,
 * so any difference is a local change.
 */
export function isModifiedSinceSync(item: PRDItem): boolean {
  const meta = extractSyncMeta(item);
  if (!meta.lastModified) return false;
  if (!meta.lastSyncedAt) return true;
  return meta.lastModified > meta.lastSyncedAt;
}

/**
 * Resolve conflicts between a local and remote item using last-write-wins.
 *
 * For each differing field:
 * - Compares local lastModified vs remote lastModified
 * - The more recently modified version's field value wins
 * - All conflicts are recorded for logging
 *
 * Returns the merged item and a list of conflict records.
 */
export function resolveConflicts(
  local: PRDItem,
  remote: PRDItem,
  remoteLastModified?: string,
): { merged: PRDItem; conflicts: ConflictRecord[] } {
  const changedFields = detectChangedFields(local, remote);
  if (changedFields.length === 0) {
    return { merged: { ...local }, conflicts: [] };
  }

  const localMeta = extractSyncMeta(local);
  const localTime = localMeta.lastModified ?? "";
  const remoteTime = remoteLastModified ?? "";
  const now = new Date().toISOString();

  const conflicts: ConflictRecord[] = [];
  const merged: PRDItem = { ...local };

  for (const field of changedFields) {
    // Last-write-wins: compare timestamps
    const resolution: ConflictResolution =
      remoteTime > localTime ? "remote" : "local";

    conflicts.push({
      itemId: local.id,
      field,
      localValue: local[field],
      remoteValue: remote[field],
      resolution,
      resolvedAt: now,
    });

    if (resolution === "remote") {
      merged[field] = remote[field];
    }
    // "local" means we keep merged[field] as-is (from local)
  }

  return { merged, conflicts };
}

/**
 * Reconcile an entire list of local items against a map of remote items (keyed by id).
 * Returns a full SyncResult with synced IDs, conflict records, and errors.
 */
export function reconcile(
  localItems: PRDItem[],
  remoteItemsById: Map<string, PRDItem & { lastModified?: string }>,
): SyncResult {
  const result: SyncResult = {
    synced: [],
    conflicts: [],
    errors: [],
  };

  for (const { item: local } of walkTree(localItems)) {
    const remote = remoteItemsById.get(local.id);
    if (!remote) {
      // Item only exists locally — nothing to conflict with
      result.synced.push(local.id);
      continue;
    }

    const changedFields = detectChangedFields(local, remote);
    if (changedFields.length === 0) {
      result.synced.push(local.id);
      continue;
    }

    const localMeta = extractSyncMeta(local);
    const localModified = isModifiedSinceSync(local);
    const remoteModified = remote.lastModified
      ? !localMeta.lastSyncedAt || remote.lastModified > localMeta.lastSyncedAt
      : false;

    if (localModified && remoteModified) {
      // True conflict: both sides changed since last sync
      const { conflicts } = resolveConflicts(
        local,
        remote,
        remote.lastModified,
      );
      result.conflicts.push(...conflicts);
    } else {
      // Only one side changed — no conflict, just sync
      result.synced.push(local.id);
    }
  }

  return result;
}

/**
 * Build a LogEntry for a conflict that was resolved.
 */
export function conflictToLogEntry(conflict: ConflictRecord): LogEntry {
  return {
    timestamp: conflict.resolvedAt,
    event: "sync_conflict",
    itemId: conflict.itemId,
    detail: `Conflict on field "${conflict.field}": resolved with ${conflict.resolution} value`,
    field: conflict.field,
    resolution: conflict.resolution,
    localValue:
      typeof conflict.localValue === "string"
        ? conflict.localValue
        : JSON.stringify(conflict.localValue),
    remoteValue:
      typeof conflict.remoteValue === "string"
        ? conflict.remoteValue
        : JSON.stringify(conflict.remoteValue),
  };
}

/** The two fields stamped by {@link stampModified}. */
export interface ModifiedFields {
  lastModified: string;
  lastModifiedBy: string;
}

/**
 * Resolve the `lastModified` / `lastModifiedBy` field values without
 * requiring a full {@link PRDItem}. Used by store adapters that apply a
 * partial update (e.g. `Object.assign`-style merges) rather than
 * constructing the full merged item up front.
 */
export async function stampModifiedFields(
  timestamp?: string,
  actor?: string,
): Promise<ModifiedFields> {
  return {
    lastModified: timestamp ?? new Date().toISOString(),
    lastModifiedBy: actor ?? (await resolveActor()),
  };
}

/**
 * Stamp the current time and resolved actor as lastModified/lastModifiedBy
 * on an item. Used by store operations to track when — and by whom — items
 * change locally.
 */
export async function stampModified(
  item: PRDItem,
  timestamp?: string,
  actor?: string,
): Promise<PRDItem> {
  return {
    ...item,
    ...(await stampModifiedFields(timestamp, actor)),
  };
}

/**
 * Stamp the resolved actor identity onto a log entry, unless the entry
 * already carries an explicit `actor` (e.g. one reconstructed from a
 * remote sync, authored by someone else).
 */
export async function stampActor(
  entry: LogEntry,
  actor?: string,
): Promise<LogEntry> {
  return {
    actor: actor ?? (await resolveActor()),
    ...entry,
  };
}

/**
 * Mark an item as having been synced at the current time.
 */
export function stampSynced(
  item: PRDItem,
  remoteId?: string,
  timestamp?: string,
): PRDItem {
  const now = timestamp ?? new Date().toISOString();
  return {
    ...item,
    lastSyncedAt: now,
    ...(remoteId !== undefined ? { remoteId } : {}),
  };
}

/**
 * Extract sync metadata from a PRDItem (which stores it via index signature).
 */
export function extractSyncMeta(item: PRDItem): SyncMetadata {
  return {
    lastModified: typeof item.lastModified === "string" ? item.lastModified : undefined,
    lastSyncedAt: typeof item.lastSyncedAt === "string" ? item.lastSyncedAt : undefined,
    remoteId: typeof item.remoteId === "string" ? item.remoteId : undefined,
  };
}

// ---- Internal helpers ----

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const key of keys) {
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }
  return false;
}
