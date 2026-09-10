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
 * Per-item bookkeeping that is never content.
 *
 * The modification stamps record *that* an item changed and the remote
 * pointers record where it was last sent; neither says anything about what the
 * item is. Every "are these the same item?" comparison in the codebase has to
 * exclude them or it answers its own writes: including `lastModified` makes a
 * stamp look like a further modification and including `lastSyncedAt` makes
 * recording a successful sync look like a local edit — each one a loop.
 *
 * Exported because `rex import-bundle` asks the same question of a bundle item
 * and its local counterpart, and answered it differently: it compared the
 * bookkeeping too, so a round-tripped item whose only delta was a stamp was
 * reported as a content collision and the operator was pointed at `--replace`
 * over nothing. One list, so the two cannot drift apart again.
 *
 * `children` is not here: it is excluded by these comparisons too, but for a
 * structural reason rather than this one, and the bundle comparison excludes
 * it on different terms — see `sameContent` in core/prd-bundle.ts.
 */
export const ITEM_BOOKKEEPING_FIELDS: ReadonlySet<string> = new Set([
  "lastModified",
  "lastModifiedBy",
  "lastSyncedAt",
  "remoteId",
]);

/**
 * Fields that are sync metadata and should not be compared for conflict detection.
 */
const SYNC_META_FIELDS = new Set<string>([...ITEM_BOOKKEEPING_FIELDS, "children"]);

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
 * Fields excluded from an item's content signature.
 *
 * The first four are sync bookkeeping rather than content: including
 * `lastModified` would make every stamp look like a further modification, and
 * including `lastSyncedAt` would make recording a successful sync look like a
 * local edit — each one a loop. `children` is excluded as an object graph and
 * re-added below as an id list, so that a parent is compared on *which*
 * children it has without being compared on their contents; each child is
 * signed in its own right.
 */
const SIGNATURE_IGNORED = new Set<string>([...ITEM_BOOKKEEPING_FIELDS, "children"]);

/** Content signature of one item, ignoring sync bookkeeping. */
function itemSignature(item: PRDItem): string {
  const record = item as unknown as Record<string, unknown>;
  const own: Record<string, unknown> = {};
  // Sorted so a field added by one writer and a field added by another in the
  // opposite order do not read as a change.
  for (const key of Object.keys(record).sort()) {
    if (SIGNATURE_IGNORED.has(key)) continue;
    own[key] = record[key];
  }
  return JSON.stringify({
    own,
    children: (item.children ?? []).map((child) => child.id),
  });
}

/**
 * Signature every item in a tree, keyed by id.
 *
 * Signatures are computed eagerly into strings rather than held as references:
 * the caller mutates the same item objects in place, so a lazy comparison
 * would be comparing each item against itself.
 */
export function snapshotItemContent(items: PRDItem[]): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const { item } of walkTree(items)) {
    snapshot.set(item.id, itemSignature(item));
  }
  return snapshot;
}

/**
 * Stamp every item whose content differs from `before`, in place.
 *
 * This is what makes a mutation performed directly on the tree — the pattern
 * every batch write uses, from the dashboard's bulk update to the CLI
 * restructurers — visible to {@link isModifiedSinceSync}. Without it the item
 * is written to disk looking untouched: never pushed to the remote, then
 * overwritten by the remote's value on the next pull, in silence.
 *
 * Three rules, all deliberate:
 *
 * - **Changed, not merely present.** An empty transaction is a real pattern
 *   here (`migrate-slugs` and `reshape` each open one purely to force a
 *   rewrite). Stamping unconditionally would mark every item in the PRD
 *   modified and queue the whole tree for push.
 * - **An author the item arrived with is kept.** `analyze.ts` stamps its
 *   accepted items before opening the transaction, deliberately and with a
 *   comment saying so, and a bundle import carries the original author of
 *   items whose source project never recorded a timestamp.
 * - **A new item always leaves here with a timestamp.** Attribution alone is
 *   not a stamp: {@link isModifiedSinceSync} returns false without a
 *   `lastModified`, and the item cannot acquire one later because the next
 *   transaction's snapshot records it as pre-existing and unchanged. So the
 *   two halves are filled independently — the timestamp because sync needs
 *   it, the author only when the item brought none.
 *
 * An item that arrives with a timestamp but no author keeps that shape: it is
 * already visible to sync, and this transaction's actor did not write it.
 *
 * @returns the ids stamped, in tree order.
 */
export function stampChangedItems(
  items: PRDItem[],
  before: Map<string, string>,
  stamp: ModifiedFields,
): string[] {
  const stamped: string[] = [];
  for (const { item } of walkTree(items)) {
    const previous = before.get(item.id);

    // Already in the tree: stamp it only if its content actually moved.
    if (previous !== undefined) {
      if (previous === itemSignature(item)) continue;
      // walkTree yields live references into the tree, so assigning here is
      // the write — no re-lookup needed.
      Object.assign(item, stamp);
      stamped.push(item.id);
      continue;
    }

    // New to the tree. Fill only the halves the item did not bring, because
    // the two halves are owed to different parties.
    //
    // `lastModifiedBy` is the caller's to set: a bundle import carries the
    // original author for items whose source project never recorded a
    // timestamp, and `analyze.ts` stamps its accepted items before opening
    // the transaction. Overwriting it would destroy exactly the provenance a
    // transport artifact exists to preserve.
    //
    // `lastModified` is owed to sync. `isModifiedSinceSync` opens with
    // `if (!meta.lastModified) return false`, so an item with no timestamp is
    // never considered modified — and it will not acquire one later either,
    // since from the next transaction on `snapshotItemContent` records it as
    // pre-existing and unchanged. Leaving it absent means the item is never
    // pushed and is overwritten by the remote's value on the next pull, in
    // silence. Treating attribution alone as a complete stamp bought the
    // author's survival at that price.
    //
    // The item is left entirely alone when it already has a timestamp: it is
    // visible to sync, so there is nothing to repair, and the actor running
    // this transaction did not write it — recording them as its author would
    // be a fabrication rather than a default.
    if (item.lastModified !== undefined) continue;

    item.lastModified = stamp.lastModified;
    if (item.lastModifiedBy === undefined) item.lastModifiedBy = stamp.lastModifiedBy;
    stamped.push(item.id);
  }
  return stamped;
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
