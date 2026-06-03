/**
 * Shared archive I/O for `.rex/archive.json`.
 *
 * Used by prune, reshape, and reorganize to preserve a timestamped
 * history of items removed from the PRD tree.
 *
 * @module core/archive
 */

import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { PRDItem } from "../schema/index.js";
import { toCanonicalJSON } from "./canonical.js";

// ── Constants ────────────────────────────────────────────────────────

export const ARCHIVE_FILE = "archive.json";

/**
 * Maximum number of archive batches to retain.
 * Older batches are discarded when this limit is exceeded,
 * preventing unbounded growth of archive.json over time.
 */
export const MAX_ARCHIVE_BATCHES = 100;

// ── Types ────────────────────────────────────────────────────────────

export interface Archive {
  schema: "rex/archive/v1";
  batches: ArchiveBatch[];
}

/**
 * Entry for a single merge operation recorded in the archive.
 * Captures the merge decision, participant IDs, and merge reasoning.
 */
export interface MergeAuditEntry {
  /** ID of the item that survived the merge. */
  survivorId: string;
  /** IDs of items that were merged into the survivor (now archived). */
  mergedFromIds: string[];
  /** Reasoning for the merge: which fields were taken from which items. */
  reasoning: string;
  /** Pre-reshape git commit hash for rollback support. */
  preReshapeCommit: string;
  /** Timestamp of when the merge was archived. */
  timestamp: string;
}

/**
 * Entry for a title-collision rename recorded in the archive.
 * Captures the LLM-proposed rename for two siblings that shared a title
 * but were semantically distinct (not duplicates).
 */
export interface RenameAuditEntry {
  /** ID of the first item renamed. */
  itemAId: string;
  /** Original title of the first item. */
  oldTitleA: string;
  /** New title assigned to the first item by LLM. */
  newTitleA: string;
  /** ID of the second item renamed. */
  itemBId: string;
  /** Original title of the second item. */
  oldTitleB: string;
  /** New title assigned to the second item by LLM. */
  newTitleB: string;
  /** LLM reasoning for the rename choices. */
  reasoning: string;
  /** Timestamp of when the rename was applied. */
  timestamp: string;
}

/**
 * Entry for a group operation recorded in the archive.
 * Captures the parent-container creation for hash-suffix duplicate siblings.
 */
export interface GroupAuditEntry {
  /** ID of the newly created container item. */
  containerId: string;
  /** Title of the new container (suffix-stripped shared base title). */
  containerTitle: string;
  /** ID of the original common parent, or undefined for root-level items. */
  originalParentId: string | undefined;
  /** IDs of items moved under the new container. */
  movedItemIds: string[];
  /** Reasoning for grouping. */
  reasoning: string;
  /** Pre-reshape git commit hash for rollback support. */
  preReshapeCommit: string;
  /** Timestamp when the group was created. */
  timestamp: string;
}

export interface ArchiveBatch {
  timestamp: string;
  source: "prune" | "reshape" | "reorganize" | "rename";
  items: PRDItem[];
  count: number;
  reason?: string;
  /** Reshape/reorganize proposals that triggered this archival. */
  actions?: unknown[];
  /** Merge audit trail for reshape operations (if source === 'reshape'). */
  mergeAuditTrail?: MergeAuditEntry[];
  /** Rename audit trail for title-collision rename operations (if source === 'rename'). */
  renameAuditTrail?: RenameAuditEntry[];
  /** Group audit trail for hash-suffix parent-container operations (if source === 'reshape'). */
  groupAuditTrail?: GroupAuditEntry[];
}

// ── I/O ──────────────────────────────────────────────────────────────

/**
 * Load archive from disk. Returns an empty archive if the file
 * doesn't exist or can't be parsed.
 */
export async function loadArchive(archivePath: string): Promise<Archive> {
  try {
    return JSON.parse(await readFile(archivePath, "utf-8")) as Archive;
  } catch {
    return { schema: "rex/archive/v1", batches: [] };
  }
}

/**
 * Trim archive to retain only the most recent batches.
 * Returns the number of batches removed.
 */
export function trimArchive(archive: Archive, maxBatches: number = MAX_ARCHIVE_BATCHES): number {
  if (archive.batches.length <= maxBatches) return 0;
  const excess = archive.batches.length - maxBatches;
  archive.batches = archive.batches.slice(excess);
  return excess;
}

/**
 * Append a batch to the archive and persist to disk.
 * Automatically trims old batches if the limit is exceeded.
 */
export async function appendArchiveBatch(
  rexDir: string,
  batch: ArchiveBatch,
): Promise<void> {
  const archivePath = join(rexDir, ARCHIVE_FILE);
  const archive = await loadArchive(archivePath);
  archive.batches.push(batch);
  trimArchive(archive);
  await writeFile(archivePath, toCanonicalJSON(archive), "utf-8");
}
