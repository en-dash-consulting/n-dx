/**
 * Automatic migration from legacy single `prd.json` to branch-scoped multi-file format.
 *
 * Detects when `.rex/prd.json` exists as the only PRD file (no `prd_*.json` branch files)
 * and renames it to `prd_{branch}_{date}.json`, creating a timestamped backup first.
 *
 * Migration is idempotent: running twice is harmless because the second run
 * either finds branch files already present (no-op) or finds the target filename
 * already exists (no-op).
 *
 * @module rex/store/prd-migration
 */

import { copyFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  resolveGitBranch,
  getFirstCommitDate,
  generatePRDFilename,
} from "./branch-naming.js";
import { discoverPRDFiles } from "./prd-discovery.js";

/** Result of a migration attempt. */
export interface MigrationResult {
  /** `true` when prd.json was migrated to a branch-scoped file. */
  migrated: boolean;
  /** The branch-scoped filename (only set when `migrated` is true). */
  filename?: string;
  /** The backup filename (only set when `migrated` is true). */
  backupFilename?: string;
  /** Reason when migration was skipped. */
  reason?: "no-legacy-file" | "branch-files-exist" | "target-exists" | "no-git-context";
}

/**
 * Migrate a legacy `prd.json` to the branch-scoped naming convention.
 *
 * Steps:
 * 1. Check preconditions: legacy `prd.json` must exist, no branch files.
 * 2. Create a timestamped backup of `prd.json`.
 * 3. Rename `prd.json` to `prd_{branch}_{date}.json`.
 *
 * The file contents are preserved exactly — no item IDs or parent
 * references are modified.
 *
 * @param rexDir  Path to the `.rex/` directory.
 * @param cwd     Working directory for git operations (project root).
 */
export async function migrateLegacyPRD(
  rexDir: string,
  cwd: string,
): Promise<MigrationResult> {
  // 1. Check if branch-scoped files already exist
  const branchFiles = await discoverPRDFiles(rexDir);
  if (branchFiles.length > 0) {
    return { migrated: false, reason: "branch-files-exist" };
  }

  // 2. Check if legacy prd.json exists
  const prdPath = join(rexDir, "prd.json");
  try {
    await stat(prdPath);
  } catch {
    return { migrated: false, reason: "no-legacy-file" };
  }

  // 3. Determine target filename — skip if no git context
  const branch = resolveGitBranch(cwd);
  if (branch === "unknown") {
    return { migrated: false, reason: "no-git-context" };
  }
  const date = getFirstCommitDate(cwd);
  const filename = generatePRDFilename(branch, date);
  const targetPath = join(rexDir, filename);

  // 4. Idempotency: if target already exists, skip (previous migration was interrupted)
  try {
    await stat(targetPath);
    return { migrated: false, reason: "target-exists" };
  } catch {
    // Good — target doesn't exist yet
  }

  // 5. Create timestamped backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFilename = `prd.json.backup.${timestamp}`;
  await copyFile(prdPath, join(rexDir, backupFilename));

  // 6. Rename prd.json to branch-scoped filename
  await rename(prdPath, targetPath);

  return { migrated: true, filename, backupFilename };
}
