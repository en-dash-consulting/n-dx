/**
 * One-time migration: rename the legacy `prd.json` to a branch-scoped
 * `prd_{branch}_{date}.json` file so the project enters multi-file mode.
 *
 * The migration is idempotent:
 * - Skipped when branch-scoped files already exist (`reason: "branch-files-exist"`).
 * - Skipped when `prd.json` does not exist (`reason: "no-legacy-file"`).
 * - Skipped when the target filename already exists (`reason: "target-exists"`).
 * - Skipped when the git branch cannot be resolved (`reason: "no-git-context"`).
 *
 * On success, `prd.json` is renamed (not copied) to the branch-scoped filename
 * so no data is duplicated. The rename is atomic on POSIX filesystems.
 *
 * @module rex/store/prd-migration
 */

import { stat, rename } from "node:fs/promises";
import { join } from "node:path";
import { discoverPRDFiles } from "./prd-discovery.js";
import { resolveGitBranch, getFirstCommitDate, generatePRDFilename } from "./branch-naming.js";

/** Result of a migration attempt. */
export interface MigrationResult {
  /** `true` when `prd.json` was renamed to a branch-scoped file. */
  migrated: boolean;
  /** The new branch-scoped filename when `migrated` is `true`. */
  filename?: string;
  /** Reason the migration was skipped when `migrated` is `false`. */
  reason?: "no-legacy-file" | "branch-files-exist" | "target-exists" | "no-git-context";
}

/**
 * Migrate a legacy single `prd.json` to a branch-scoped `prd_{branch}_{date}.json`.
 *
 * @param rexDir  Path to the `.rex/` directory.
 * @param cwd     Working directory used for git branch/date resolution.
 */
export async function migrateLegacyPRD(rexDir: string, cwd: string): Promise<MigrationResult> {
  // Skip if branch-scoped files already exist — project is already in multi-file mode
  const existing = await discoverPRDFiles(rexDir);
  if (existing.length > 0) {
    return { migrated: false, reason: "branch-files-exist" };
  }

  // Resolve git context — needed to generate the target filename
  const branch = resolveGitBranch(cwd);
  if (!branch || branch === "unknown") {
    return { migrated: false, reason: "no-git-context" };
  }

  // Skip if prd.json does not exist — nothing to migrate
  const canonicalPath = join(rexDir, "prd.json");
  try {
    await stat(canonicalPath);
  } catch {
    return { migrated: false, reason: "no-legacy-file" };
  }

  const date = getFirstCommitDate(cwd);
  const filename = generatePRDFilename(branch, date);
  const targetPath = join(rexDir, filename);

  // Skip if the target filename already exists (idempotent across retries)
  try {
    await stat(targetPath);
    return { migrated: false, reason: "target-exists" };
  } catch {
    // Target does not exist — proceed with rename
  }

  await rename(canonicalPath, targetPath);
  return { migrated: true, filename };
}
