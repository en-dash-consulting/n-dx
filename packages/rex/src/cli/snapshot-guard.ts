/**
 * Pre-command PRD tree snapshot guard.
 *
 * Every command that rewrites `.rex/prd_tree/` calls `ensureSnapshot` first, so
 * a user can always return to the state the tree was in before the command ran
 * (`rex restore`).
 *
 * Why this is a guard and not a best-effort warning: the previous behaviour
 * caught snapshot failures and downgraded them to a one-line warning, then
 * carried on and rewrote the tree anyway. Because the snapshot directory name
 * embedded a raw ISO-8601 timestamp — and `:` is illegal in Windows filenames —
 * that warning fired on *every* Windows invocation. The net effect was that
 * Windows users ran destructive tree rewrites with no rollback at all, and the
 * only signal was a line of text above the normal output. A safety net that
 * silently isn't there is worse than no safety net, because it is trusted.
 *
 * @module cli/snapshot-guard
 */

import { warn } from "./output.js";
import { CLIError } from "./errors.js";
import {
  snapshotPRDTree,
  pruneBackups,
  type BackupSnapshot,
} from "../core/backup-snapshots.js";

/** Number of snapshots to retain per project. */
const RETENTION_CAP = 10;

/**
 * Snapshot the PRD tree before a mutating command.
 *
 * Returns the snapshot, or null when there was nothing to snapshot (no tree
 * yet, or an empty tree — in both cases there is no data to lose).
 *
 * @param rexDir   The `.rex/` directory
 * @param command  Command name, used in error text (e.g. "add", "prune")
 * @param flags    Raw CLI flags. `--no-snapshot=true` opts out.
 * @throws CLIError if the snapshot cannot be created and the caller did not
 *   explicitly opt out. Failing closed is deliberate: the alternative is
 *   rewriting the tree with no way back.
 */
export async function ensureSnapshot(
  rexDir: string,
  command: string,
  flags: Record<string, string> = {},
): Promise<BackupSnapshot | null> {
  if (flags["no-snapshot"] === "true") {
    warn(`Skipping PRD snapshot (--no-snapshot). 'rex restore' cannot undo this ${command}.`);
    return null;
  }

  let snapshot: BackupSnapshot | null;
  try {
    snapshot = await snapshotPRDTree(rexDir);
  } catch (err) {
    throw new CLIError(
      `Could not snapshot the PRD tree before '${command}': ${String(err)}\n\n` +
        `Refusing to continue — without a snapshot there is no way to undo this command.`,
      `Fix the cause above, or re-run with --no-snapshot to proceed without a rollback point.`,
    );
  }

  // Retention is best-effort: a full backups directory must never block the
  // command that just successfully protected itself.
  if (snapshot !== null) {
    try {
      await pruneBackups(rexDir, RETENTION_CAP);
    } catch {
      // Ignore — stale snapshots are harmless.
    }
  }

  return snapshot;
}

/**
 * Format the recovery hint shown when a mutating command fails partway.
 *
 * Uses `rex restore` rather than a raw `cp -r`: the old hint suggested a Unix
 * command that does not exist in cmd.exe/PowerShell, and a plain recursive copy
 * overlays rather than replaces — leaving a tree that is the union of both
 * states instead of the snapshot's point in time.
 */
export function formatRecoveryHint(
  snapshot: BackupSnapshot | null,
  dir: string,
): string {
  if (snapshot === null) return "";
  return (
    `\n\nThe PRD tree was snapshotted before this command.` +
    `\nRoll back with: rex restore --id=${snapshot.id} ${dir}`
  );
}
