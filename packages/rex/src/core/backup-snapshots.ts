/**
 * Timestamped backup snapshots of the PRD tree.
 *
 * Before structural migrations (folder-per-task, single-child compaction, reshape),
 * snapshot the entire `.rex/prd_tree` directory to `.rex/.backups/prd_tree_<ISO-timestamp>/`
 * so failed migrations can be rolled back without data loss.
 *
 * Features:
 * - Idempotent: Safe to call multiple times
 * - Retention cap: Auto-delete oldest backups when count exceeds configured limit
 * - Restore: Restore from backup with verification
 *
 * @module core/backup-snapshots
 */

import { readdir, stat, mkdir, cp, rm, rename } from "node:fs/promises";
import { join } from "node:path";

/**
 * Result of a backup snapshot operation.
 */
export interface BackupSnapshot {
  /** ISO-8601 timestamp of the backup. */
  timestamp: string;
  /**
   * Filesystem-safe snapshot id — the suffix of the `prd_tree_<id>` directory
   * name, and the value `getAvailableBackups` returns. Pass this (or the raw
   * ISO timestamp) to `restoreFromBackup`.
   */
  id: string;
  /** Full path to the backed-up prd_tree. */
  backupPath: string;
}

/**
 * Encode an ISO-8601 timestamp into a directory-name-safe id.
 *
 * Windows forbids `: \ / * ? " < > |` in filenames — `:` is reserved for drive
 * letters and NTFS alternate data streams. ISO-8601 puts colons in the time
 * component (`2026-08-05T17:27:18.959Z`), so every snapshot mkdir/cp failed
 * with EINVAL on Windows. Because the failure was caught and downgraded to a
 * warning by callers, Windows users silently had NO backup coverage at all.
 *
 * Colons become `-`. The substitution is positional and length-preserving, so
 * lexicographic ordering still equals chronological ordering — which
 * `getAvailableBackups` relies on for "newest first".
 */
export function encodeSnapshotId(isoTimestamp: string): string {
  return isoTimestamp.replace(/:/g, "-");
}

/**
 * Validate a snapshot id before it is used to build a filesystem path.
 *
 * `id` reaches `restoreFromBackup` from external callers — the CLI arg, or
 * the web dashboard's JSON request body — and is joined into `stagingPath`
 * and `backupPath` there. It must never be trusted as path-safe: a crafted
 * id containing `..` segments or a path separator can make the join resolve
 * outside `.rex/.backups/`, and `restoreFromBackup` unconditionally runs
 * `fs.rm(..., { recursive: true, force: true })` on the result.
 *
 * Rejects: empty ids, forward slashes, backslashes, two consecutive dots
 * (`..`), and NUL bytes. `encodeSnapshotId`'s own output (colons replaced
 * with dashes) and legacy raw ISO-8601 timestamps (single dots only, before
 * the trailing `Z`) both still pass — neither contains any rejected
 * character.
 */
export function isValidSnapshotId(id: string): boolean {
  if (!id) return false;
  if (id.includes("/")) return false;
  if (id.includes("\\")) return false;
  if (id.includes("..")) return false;
  if (id.includes("\0")) return false;
  return true;
}

/**
 * Create a timestamped snapshot of the PRD tree.
 *
 * The snapshot is stored at `.rex/.backups/prd_tree_<ISO-timestamp>/`.
 * If the tree doesn't exist or is empty, returns null (no-op).
 *
 * The timestamp format is ISO-8601 (e.g., `2026-05-07T22:15:00.000Z`).
 *
 * @param rexDir  The `.rex/` directory
 * @returns Backup snapshot info, or null if tree doesn't exist
 * @throws If the backup operation fails
 */
export async function snapshotPRDTree(rexDir: string): Promise<BackupSnapshot | null> {
  const treeRoot = join(rexDir, "prd_tree");
  const backupsDir = join(rexDir, ".backups");

  // Check if tree exists
  const treeExists = await dirExists(treeRoot);
  if (!treeExists) {
    return null; // No-op if tree doesn't exist
  }

  // Check if tree is empty
  const isEmpty = await isDirEmpty(treeRoot);
  if (isEmpty) {
    return null; // No-op if tree is empty
  }

  // Create backups directory
  try {
    await mkdir(backupsDir, { recursive: true });
  } catch (err) {
    throw new Error(`Failed to create backups directory: ${String(err)}`);
  }

  // Create timestamped backup directory. The id is colon-free so the mkdir
  // succeeds on Windows — see encodeSnapshotId.
  const timestamp = new Date().toISOString();
  const id = encodeSnapshotId(timestamp);
  const backupPath = join(backupsDir, `prd_tree_${id}`);

  // Copy tree to backup location
  try {
    await cp(treeRoot, backupPath, { recursive: true });
  } catch (err) {
    throw new Error(`Failed to snapshot PRD tree to ${backupPath}: ${String(err)}`);
  }

  return { timestamp, id, backupPath };
}

/**
 * Restore a PRD tree from a timestamped backup.
 *
 * This replaces the current prd_tree with the backed-up version.
 * The backup directory itself remains in `.rex/.backups/` for audit.
 *
 * Restoring is a REPLACE, not an overlay: the current tree is deleted before
 * the backup is copied in. An overlay (plain recursive copy with force) leaves
 * behind any file the run created that the snapshot never had, so the tree
 * ends up as a union of both states rather than the point-in-time it claims
 * to be — which is worse than useless for a rollback.
 *
 * @param rexDir      The `.rex/` directory
 * @param id          Snapshot id from `getAvailableBackups`, or a raw ISO-8601
 *                    timestamp (legacy snapshots created before the
 *                    colon-encoding fix are still found).
 * @throws If the backup doesn't exist or restore fails
 */
export async function restoreFromBackup(rexDir: string, id: string): Promise<void> {
  if (!isValidSnapshotId(id)) {
    throw new Error(`Invalid snapshot id: ${JSON.stringify(id)}`);
  }

  const treeRoot = join(rexDir, "prd_tree");
  const backupsDir = join(rexDir, ".backups");

  // Accept both the encoded id and a raw ISO timestamp. Snapshots written on
  // Unix before the encoding fix still carry colons in their directory names.
  const candidates = [
    join(backupsDir, `prd_tree_${encodeSnapshotId(id)}`),
    join(backupsDir, `prd_tree_${id}`),
  ];

  let backupPath: string | null = null;
  for (const candidate of candidates) {
    if (await dirExists(candidate)) {
      backupPath = candidate;
      break;
    }
  }
  if (backupPath === null) {
    throw new Error(`Backup not found at ${candidates[0]}`);
  }

  // Stage the restore beside the live tree, then swap. Deleting the tree first
  // and copying second would leave the project with no PRD at all if the copy
  // failed halfway.
  const stagingPath = join(backupsDir, `.restore_staging_${encodeSnapshotId(id)}`);
  try {
    await rm(stagingPath, { recursive: true, force: true });
    await cp(backupPath, stagingPath, { recursive: true });
  } catch (err) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Failed to stage restore from backup: ${String(err)}`);
  }

  try {
    await rm(treeRoot, { recursive: true, force: true });
    await rename(stagingPath, treeRoot);
  } catch (err) {
    // rename can fail across devices; fall back to a copy so the restore still
    // completes rather than leaving the tree missing.
    try {
      await cp(stagingPath, treeRoot, { recursive: true });
      await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    } catch {
      throw new Error(
        `Failed to restore from backup: ${String(err)}. ` +
          `The snapshot is intact at ${backupPath} — copy it to ${treeRoot} manually.`,
      );
    }
  }
}

/**
 * Get available backups sorted by timestamp (newest first).
 *
 * @param rexDir The `.rex/` directory
 * @returns Array of backup timestamps in descending order
 */
export async function getAvailableBackups(rexDir: string): Promise<string[]> {
  const backupsDir = join(rexDir, ".backups");

  const backupDirExists = await dirExists(backupsDir);
  if (!backupDirExists) {
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(backupsDir);
  } catch {
    return [];
  }

  // Extract timestamps from backup directory names
  const backups = entries
    .filter((name) => name.startsWith("prd_tree_"))
    .map((name) => name.slice("prd_tree_".length))
    .sort()
    .reverse(); // Newest first

  return backups;
}

/**
 * Prune old backups, keeping only the most recent `retentionCap`.
 *
 * Scans `.rex/.backups/` and deletes the oldest backups when count exceeds the cap.
 * Silently succeeds if backups directory doesn't exist.
 *
 * @param rexDir        The `.rex/` directory
 * @param retentionCap  Number of backups to keep (default: 10)
 */
export async function pruneBackups(rexDir: string, retentionCap: number = 10): Promise<void> {
  const backupsDir = join(rexDir, ".backups");

  // If backups directory doesn't exist, nothing to prune
  const backupDirExists = await dirExists(backupsDir);
  if (!backupDirExists) {
    return;
  }

  // Get all available backups (newest first)
  const backups = await getAvailableBackups(rexDir);

  // If we're under the cap, nothing to prune
  if (backups.length <= retentionCap) {
    return;
  }

  // Delete the oldest backups
  const toDelete = backups.slice(retentionCap);

  for (const timestamp of toDelete) {
    const backupPath = join(backupsDir, `prd_tree_${timestamp}`);
    try {
      // Recursively remove directory
      await rm(backupPath, { recursive: true, force: true });
    } catch {
      // Silently skip failures (best-effort cleanup)
    }
  }
}

/**
 * Check if a directory exists.
 */
async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a directory is empty (has no entries).
 */
async function isDirEmpty(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0;
  } catch {
    return true;
  }
}
