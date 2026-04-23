/**
 * One-time migration: consolidate branch-scoped `prd_{branch}_{date}.json`
 * files (and any stray legacy layout) into the canonical single `prd.json`.
 *
 * Merges items from all discovered PRD files into a single document. The
 * first non-empty source's `schema` + `title` are used for the aggregated
 * document; remaining sources contribute only their items. Source files are
 * renamed to `<name>.backup.<timestamp>` after a successful merge so the
 * original data is never destroyed.
 *
 * Migration is idempotent: running twice is a no-op once only `prd.json`
 * remains. ID collisions across source files are reported as an error so
 * the caller can resolve them manually before data is lost.
 *
 * @module rex/store/prd-migration
 */

import { readdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { SCHEMA_VERSION } from "../schema/v1.js";
import { toCanonicalJSON } from "../core/canonical.js";
import { validateDocument } from "../schema/validate.js";
import { walkTree } from "../core/tree.js";
import { PRD_FILENAME } from "./file-adapter.js";
import type { PRDDocument, PRDItem } from "../schema/v1.js";

/** Pattern matching `prd_{branch}_{YYYY-MM-DD}.json` (branch-scoped legacy files). */
const BRANCH_PRD_RE = /^prd_(.+)_(\d{4}-\d{2}-\d{2})\.json$/;

/** Result of a migration attempt. */
export interface MigrationResult {
  /** `true` when one or more branch-scoped files were consolidated into prd.json. */
  migrated: boolean;
  /** Filenames that were merged (and renamed to backups). */
  mergedFiles?: string[];
  /** Backup filenames created during consolidation (parallel to `mergedFiles`). */
  backupFilenames?: string[];
  /** Reason when migration was skipped. */
  reason?: "no-branch-files";
}

/** Return filenames matching `prd_{branch}_{date}.json`, sorted lexicographically. */
async function discoverBranchPRDFiles(rexDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(rexDir);
  } catch {
    return [];
  }
  return entries.filter((name) => BRANCH_PRD_RE.test(name)).sort();
}

async function loadAndValidatePRD(path: string, filename: string): Promise<PRDDocument> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw);
  const result = validateDocument(parsed);
  if (!result.ok) {
    throw new Error(`Invalid ${filename}: ${result.errors.message}`);
  }
  return result.data as PRDDocument;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Consolidate any branch-scoped PRD files into the canonical `prd.json`.
 *
 * Steps:
 * 1. Discover `prd_*.json` files. If none exist, migration is a no-op.
 * 2. Load all discovered files plus any existing `prd.json`.
 * 3. Validate that item IDs do not collide across sources.
 * 4. Merge into a single document (schema + title from the first source,
 *    items concatenated in source order).
 * 5. Write the merged document to `prd.json` atomically.
 * 6. Rename each merged branch file to `<name>.backup.<timestamp>` so the
 *    original data is preserved but no longer picked up by future reads.
 *
 * @param rexDir  Path to the `.rex/` directory.
 */
export async function migrateLegacyPRD(rexDir: string): Promise<MigrationResult> {
  const branchFiles = await discoverBranchPRDFiles(rexDir);
  if (branchFiles.length === 0) {
    return { migrated: false, reason: "no-branch-files" };
  }

  const sources: Array<{ filename: string; path: string; doc: PRDDocument }> = [];

  // Include existing prd.json first (its title/schema win when present)
  const canonicalPath = join(rexDir, PRD_FILENAME);
  if (await pathExists(canonicalPath)) {
    const doc = await loadAndValidatePRD(canonicalPath, PRD_FILENAME);
    sources.push({ filename: PRD_FILENAME, path: canonicalPath, doc });
  }

  for (const filename of branchFiles) {
    const path = join(rexDir, filename);
    const doc = await loadAndValidatePRD(path, filename);
    sources.push({ filename, path, doc });
  }

  // Detect cross-file ID collisions before writing anything
  const idToFile = new Map<string, string>();
  const collisions: string[] = [];
  for (const { filename, doc } of sources) {
    for (const entry of walkTree(doc.items)) {
      const existing = idToFile.get(entry.item.id);
      if (existing) {
        collisions.push(`  ${entry.item.id} in ${existing} and ${filename}`);
      } else {
        idToFile.set(entry.item.id, filename);
      }
    }
  }
  if (collisions.length > 0) {
    throw new Error(
      `Cannot consolidate PRD files: item ID collision across sources:\n${collisions.join("\n")}`,
    );
  }

  // Merge: first source wins for schema/title; items concatenated in order.
  const first = sources[0];
  const mergedItems: PRDItem[] = [];
  for (const { doc } of sources) {
    mergedItems.push(...doc.items);
  }
  const merged: PRDDocument = {
    schema: first.doc.schema ?? SCHEMA_VERSION,
    title: first.doc.title,
    items: mergedItems,
  };

  const validation = validateDocument(merged);
  if (!validation.ok) {
    throw new Error(`Consolidated PRD failed validation: ${validation.errors.message}`);
  }

  // Write the merged document to prd.json atomically via a temp file + rename.
  const tmpPath = `${canonicalPath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, toCanonicalJSON(merged), "utf-8");
  await rename(tmpPath, canonicalPath);

  // Rename the branch-scoped sources to timestamped backups so future reads
  // ignore them but the original bytes remain recoverable.
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mergedFiles: string[] = [];
  const backupFilenames: string[] = [];
  for (const { filename, path } of sources) {
    if (filename === PRD_FILENAME) continue; // already the canonical target
    const backup = `${filename}.backup.${timestamp}`;
    await rename(path, join(rexDir, backup));
    mergedFiles.push(filename);
    backupFilenames.push(backup);
  }

  return {
    migrated: true,
    mergedFiles,
    backupFilenames,
  };
}
