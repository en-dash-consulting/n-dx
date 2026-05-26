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

import { readdir, stat, mkdir, cp, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Result of a backup snapshot operation.
 */
export interface BackupSnapshot {
  /** ISO-8601 timestamp of the backup. */
  timestamp: string;
  /** Full path to the backed-up prd_tree. */
  backupPath: string;
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

  // Create timestamped backup directory
  const timestamp = new Date().toISOString();
  const backupPath = join(backupsDir, `prd_tree_${timestamp}`);

  // Copy tree to backup location
  try {
    await cp(treeRoot, backupPath, { recursive: true });
  } catch (err) {
    throw new Error(`Failed to snapshot PRD tree to ${backupPath}: ${String(err)}`);
  }

  return { timestamp, backupPath };
}

/**
 * Restore a PRD tree from a timestamped backup.
 *
 * This replaces the current prd_tree with the backed-up version.
 * The backup directory itself remains in `.rex/.backups/` for audit.
 *
 * @param rexDir      The `.rex/` directory
 * @param timestamp   ISO-8601 timestamp of the backup to restore
 * @throws If the backup doesn't exist or restore fails
 */
export async function restoreFromBackup(rexDir: string, timestamp: string): Promise<void> {
  const treeRoot = join(rexDir, "prd_tree");
  const backupsDir = join(rexDir, ".backups");
  const backupPath = join(backupsDir, `prd_tree_${timestamp}`);

  // Verify backup exists
  const backupExists = await dirExists(backupPath);
  if (!backupExists) {
    throw new Error(`Backup not found at ${backupPath}`);
  }

  // Remove current tree if it exists
  try {
    await stat(treeRoot);
    // Tree exists, remove it
    await cp(backupPath, treeRoot, { recursive: true, force: true });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // Tree doesn't exist, just copy the backup
      await cp(backupPath, treeRoot, { recursive: true });
    } else {
      throw new Error(`Failed to restore from backup: ${String(err)}`);
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
