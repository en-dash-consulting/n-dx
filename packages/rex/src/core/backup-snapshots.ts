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
import { isAtomicWriteTempPath } from "../store/atomic-write.js";

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
/** How many clock re-reads before a colliding snapshot gives up. */
const CLAIM_ATTEMPTS = 20;

/** Pause between claim attempts — long enough for the millisecond to tick over. */
const CLAIM_RETRY_MS = 2;

/** How many times the tree copy is re-walked after an entry vanished under it. */
const COPY_ATTEMPTS = 3;

/** Pause before re-walking, so the writer that is mid-rename can finish. */
const COPY_RETRY_MS = 5;

/**
 * Copy the live tree into an already-claimed snapshot directory.
 *
 * Two things make this more than a plain `cp`:
 *
 * **Temp files are filtered out.** The atomic writers in `store/` create
 * `<file>.<pid>.<uuid>.tmp` beside their target and rename it into place. Those
 * files are not PRD content and must not appear in a rollback point — and,
 * because `cp` reads a directory and then `lstat`s each entry, one that is
 * renamed away in between raises ENOENT and fails the whole command. Filtering
 * removes the file from the walk before it can be stat'd. The predicate lives
 * next to the writer (`isAtomicWriteTempPath`) so the two cannot drift.
 *
 * **A vanished entry is retried, not tolerated.** The filter closes the
 * dominant window but not the only one: `serializeToFolderTree` deletes stale
 * directories (`rm(entry.path, { recursive: true })`) as part of a normal save,
 * and this snapshot runs *before* the PRD lock is taken, so any entry can
 * disappear mid-walk. The alternative — skip the missing entry and keep going —
 * was rejected: a snapshot silently missing content is exactly the "safety net
 * that isn't there" `snapshot-guard` exists to avoid, and it would be
 * indistinguishable from a complete one at restore time. Instead the copy is
 * re-walked from scratch. `cp` overwrites by default, so a retry is idempotent,
 * and the next walk simply does not see an entry that is genuinely gone.
 * Retries are bounded; a persistent ENOENT still fails the command loudly.
 */
async function copyTree(treeRoot: string, backupPath: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await cp(treeRoot, backupPath, {
        recursive: true,
        filter: (src) => !isAtomicWriteTempPath(src),
      });
      return;
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : undefined;
      if (code !== "ENOENT" || attempt >= COPY_ATTEMPTS) {
        throw new Error(`Failed to snapshot PRD tree to ${backupPath}: ${String(err)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, COPY_RETRY_MS));
    }
  }
}

/**
 * Exclusively claim a snapshot directory, retrying on a name already taken.
 *
 * Returns the claimed directory, which the caller then owns and can copy into.
 * The id format is unchanged — `encodeSnapshotId`'s colon-free ISO-8601 — so
 * `isValidSnapshotId`, `rex restore --id=`, the display in `formatSnapshotId`,
 * and the lexicographic-equals-chronological ordering `getAvailableBackups`
 * depends on all keep working. Uniqueness comes from re-reading the clock, not
 * from decorating the name.
 *
 * @throws If a free name cannot be claimed, or the claim fails for any reason
 *   other than the name being taken.
 */
async function claimBackupDir(
  backupsDir: string,
): Promise<{ timestamp: string; id: string; backupPath: string }> {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    const timestamp = new Date().toISOString();
    const id = encodeSnapshotId(timestamp);
    const backupPath = join(backupsDir, `prd_tree_${id}`);

    try {
      // Not recursive: this must fail when the directory already exists, which
      // is precisely the signal that another writer claimed this millisecond.
      await mkdir(backupPath);
      return { timestamp, id, backupPath };
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err
        ? (err as { code?: string }).code
        : undefined;
      if (code !== "EEXIST") {
        throw new Error(`Failed to create snapshot directory ${backupPath}: ${String(err)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, CLAIM_RETRY_MS));
    }
  }

  throw new Error(
    `Could not claim a snapshot directory in ${backupsDir} after ${CLAIM_ATTEMPTS} attempts. ` +
      `Another process appears to be snapshotting continuously.`,
  );
}

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

  // Claim a timestamped backup directory. The id is colon-free so the mkdir
  // succeeds on Windows — see encodeSnapshotId.
  //
  // The claim is an exclusive `mkdir` rather than letting `cp` create the
  // destination, because the name is only as unique as the clock behind it.
  // `toISOString()` is millisecond-resolution, and this runs *before* the PRD
  // lock is taken — deliberately, so a declined `--replace` confirmation does
  // not burn a retention slot — so nothing serialises two writers here. Two
  // `rex import-bundle` processes starting in the same millisecond derived the
  // same directory name, raced inside `cp`'s own mkdir, and the loser failed
  // the whole command with `EEXIST: file already exists`. Observed as an
  // intermittent suite failure.
  //
  // A non-recursive `mkdir` fails atomically when the name is taken, the same
  // way the PRD lock claims its file with the `wx` flag, so the loser learns it
  // lost and re-reads the clock instead of colliding. The pause is there so the
  // millisecond can actually advance — retrying against the same clock reading
  // would just lose again.
  const { timestamp, id, backupPath } = await claimBackupDir(backupsDir);

  // Copy tree into the directory we now exclusively own. This is the second
  // race in this function: the claim above fixed two snapshots colliding on a
  // directory name, and `copyTree` handles a concurrent *writer* mutating the
  // tree while it is being read.
  await copyTree(treeRoot, backupPath);

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
