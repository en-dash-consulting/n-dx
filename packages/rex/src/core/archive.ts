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

export interface ArchiveBatch {
  timestamp: string;
  source: "prune" | "reshape" | "reorganize";
  items: PRDItem[];
  count: number;
  reason?: string;
  /** Reshape/reorganize proposals that triggered this archival. */
  actions?: unknown[];
}

// ── I/O ──────────────────────────────────────────────────────────────

/**
 * Load archive from disk. Returns an empty archive if the file
 * doesn't exist or can't be parsed.
 */
export async function loadArchive(archivePath: string): Promise<Archive> {
  try {
    const raw = await readFile(archivePath, "utf-8");
    return JSON.parse(raw) as Archive;
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
