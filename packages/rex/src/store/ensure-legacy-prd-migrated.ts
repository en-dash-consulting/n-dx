/**
 * Ensure legacy `.rex/prd.json` is detected, backed up, and migrated to folder-tree format.
 *
 * This helper is called by CLI commands, MCP tools, and web server entry points
 * to guarantee a one-shot, safe, recoverable migration of projects that still
 * contain a legacy prd.json file.
 *
 * Migration flow:
 * 1. Detect if `.rex/prd.json` exists — if not, return no-op
 * 2. Check for `.rex/prd.json.migrated` marker — if present, already migrated, return no-op
 * 3. Check if `.rex/<PRD_TREE_DIRNAME>/` exists and contains items — if yes, already migrated, return no-op
 * 4. Acquire file lock (`.rex/prd.json.lock`) to prevent concurrent races
 * 5. Create timestamped backup (`.rex/prd.json.backup-YYYYMMDD-HHMMSS`)
 * 6. Load and validate prd.json
 * 7. Invoke folder-tree migration logic
 * 8. On success: rename `.rex/prd.json` → `.rex/prd.json.migrated`
 * 9. On failure: throw typed error, leave prd.json + backup in place
 *
 * @module rex/store/ensure-legacy-prd-migrated
 */

import { join } from "node:path";
import { stat, readFile, copyFile, rename } from "node:fs/promises";
import { withLock } from "./file-lock.js";
import { validateDocument, PRDDocumentSchema } from "../schema/validate.js";
import { serializeFolderTree } from "./index.js";
import { atomicWriteJSON } from "./atomic-write.js";
import { discoverPRDFiles } from "./prd-discovery.js";
import { PRD_TREE_DIRNAME } from "./paths.js";
import type { z } from "zod";

/** Result of a legacy-PRD migration attempt. */
export interface LegacyPrdMigrationResult {
  /** `true` when prd.json was successfully migrated to the folder tree. */
  migrated: boolean;
  /** Reason the migration was skipped when `migrated` is `false`. */
  reason?:
    | "no-legacy-file"
    | "already-migrated"
    | "tree-exists"
    | "prd-json-invalid"
    | "branch-scoped-files-present";
  /** Path to the backup file when `migrated` is `true`. */
  backupPath?: string;
  /** Number of items migrated when `migrated` is `true`. */
  itemCount?: number;
}

/** Error thrown when legacy-PRD migration fails. */
export class LegacyPrdMigrationError extends Error {
  public readonly suggestion?: string;

  constructor(message: string, suggestion?: string) {
    super(message);
    this.name = "LegacyPrdMigrationError";
    this.suggestion = suggestion;
  }
}

// ── Timestamp formatting ─────────────────────────────────────────────────────

/**
 * Format a Date as `YYYYMMDD-HHMMSS`.
 */
function formatBackupTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}` +
    `${pad(date.getMonth() + 1)}` +
    `${pad(date.getDate())}-` +
    `${pad(date.getHours())}` +
    `${pad(date.getMinutes())}` +
    `${pad(date.getSeconds())}`
  );
}

// ── File system checks ───────────────────────────────────────────────────────

/**
 * Check if a file or directory exists.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a directory exists and is a directory.
 */
async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// ── Main migration logic ─────────────────────────────────────────────────────

/**
 * Ensure legacy `.rex/prd.json` is migrated to folder-tree format.
 *
 * This function is idempotent and safe to call from multiple entry points:
 * - CLI commands that touch the PRD
 * - MCP tools that read/write PRD items
 * - Web server startup
 *
 * Concurrency is protected via file locking: if another process is migrating,
 * this call will wait up to 10 seconds before timing out.
 *
 * @param dir - Project root directory (not `.rex/` — parent of `.rex/`)
 * @returns Migration result with status and optional backup path
 * @throws LegacyPrdMigrationError on migration failure (prd.json left in place for recovery)
 *
 * @example
 * ```ts
 * const result = await ensureLegacyPrdMigrated(projectDir);
 * if (result.migrated) {
 *   console.log(`Migrated ${result.itemCount} items, backed up to ${result.backupPath}`);
 * } else {
 *   console.log(`Skipped: ${result.reason}`);
 * }
 * ```
 */
export async function ensureLegacyPrdMigrated(dir: string): Promise<LegacyPrdMigrationResult> {
  const rexDir = join(dir, ".rex");
  const prdJsonPath = join(rexDir, "prd.json");
  const prdJsonMigratedMarker = join(rexDir, "prd.json.migrated");
  const treePath = join(rexDir, PRD_TREE_DIRNAME);
  const lockPath = join(rexDir, "prd.json.lock");

  // Auto-rename legacy `.rex/tree/` directory to the canonical `.rex/<PRD_TREE_DIRNAME>/`
  // location. The literal "tree" here is the legacy directory name and must
  // never be reused elsewhere in the codebase. The rename is a no-op while
  // PRD_TREE_DIRNAME itself is "tree" (oldTreePath === newTreePath); it
  // activates when the constant is renamed in a follow-up step. The
  // !existsSync(treePath) guard preserves all data — if both directories
  // already exist, the rename refuses silently and downstream reads continue
  // targeting the canonical path.
  const legacyTreePath = join(rexDir, "tree");
  if (
    legacyTreePath !== treePath &&
    (await dirExists(legacyTreePath)) &&
    !(await dirExists(treePath))
  ) {
    await rename(legacyTreePath, treePath);
  }

  // Step 1: Check if already migrated (marker file present)
  // This check comes first because prd.json may have been renamed to prd.json.migrated
  if (await fileExists(prdJsonMigratedMarker)) {
    return { migrated: false, reason: "already-migrated" };
  }

  // Step 2: Check if prd.json exists
  if (!(await fileExists(prdJsonPath))) {
    return { migrated: false, reason: "no-legacy-file" };
  }

  // Step 3: Check if tree exists — if it does, assume it's the target state
  // (even if empty or invalid, we don't want to overwrite potentially existing work)
  if (await dirExists(treePath)) {
    return { migrated: false, reason: "tree-exists" };
  }

  // Step 3b: Defer migration when branch-scoped legacy files (`prd_<branch>_<date>.json`)
  // are present alongside `prd.json`. The legacy multi-file model is still in
  // active use; running migration would silently lose the branch files'
  // source-file attribution that callers like `rex status --show-individual`
  // depend on. Once those files are removed or merged manually, migration runs.
  const branchFiles = await discoverPRDFiles(rexDir);
  if (branchFiles.length > 0) {
    return { migrated: false, reason: "branch-scoped-files-present" };
  }

  // Step 4-9: Migration pipeline (protected by lock to prevent concurrent races)
  return withLock(lockPath, async () => {
    // Re-check after acquiring lock (another process may have completed migration)
    if (await fileExists(prdJsonMigratedMarker)) {
      return { migrated: false, reason: "already-migrated" };
    }
    if (await dirExists(treePath)) {
      return { migrated: false, reason: "tree-exists" };
    }

    // Load and validate prd.json
    let rawContent: string;
    try {
      rawContent = await readFile(prdJsonPath, "utf-8");
    } catch (err) {
      throw new LegacyPrdMigrationError(
        `Failed to read .rex/prd.json: ${String(err)}`,
        "Ensure .rex/prd.json exists and is readable.",
      );
    }

    let prdData: unknown;
    try {
      prdData = JSON.parse(rawContent);
    } catch (err) {
      throw new LegacyPrdMigrationError(
        `Failed to parse .rex/prd.json: ${String(err)}`,
        "The file may be corrupted. Check its syntax or restore from backup.",
      );
    }

    const validated = validateDocument(prdData);
    if (!validated.ok) {
      throw new LegacyPrdMigrationError(
        `Invalid PRD schema in .rex/prd.json: ${String(validated.errors)}`,
        "The file format may have changed. Restore from backup or manually fix.",
      );
    }

    const doc: z.infer<typeof PRDDocumentSchema> = validated.data;

    // Create timestamped backup before any mutations
    const timestamp = formatBackupTimestamp(new Date());
    const backupPath = join(rexDir, `prd.json.backup-${timestamp}`);

    try {
      await copyFile(prdJsonPath, backupPath);
    } catch (err) {
      throw new LegacyPrdMigrationError(
        `Failed to create backup at ${backupPath}: ${String(err)}`,
        "Check disk space and file permissions.",
      );
    }

    // Migrate to folder tree
    try {
      await serializeFolderTree(doc.items as any, treePath);
    } catch (err) {
      throw new LegacyPrdMigrationError(
        `Failed to serialize folder tree: ${String(err)}`,
        "Check disk space and permissions in .rex/. Backup is at " + backupPath,
      );
    }

    // Persist the document title alongside the tree. Without this,
    // `FileStore.loadDocument()` defaults the title to "PRD" after migration.
    try {
      await atomicWriteJSON(join(rexDir, "tree-meta.json"), { title: doc.title });
    } catch (err) {
      throw new LegacyPrdMigrationError(
        `Failed to write tree-meta.json: ${String(err)}`,
        "Folder tree was written but document title was not persisted. Backup is at " + backupPath,
      );
    }

    // Mark migration as complete by renaming prd.json
    try {
      await rename(prdJsonPath, prdJsonMigratedMarker);
    } catch (err) {
      throw new LegacyPrdMigrationError(
        `Failed to complete migration marker: ${String(err)}`,
        "Folder tree was written successfully. " +
        "Check .rex/ for backup and manually remove .rex/prd.json if needed.",
      );
    }

    return {
      migrated: true,
      backupPath,
      itemCount: doc.items.length,
    };
  });
}
