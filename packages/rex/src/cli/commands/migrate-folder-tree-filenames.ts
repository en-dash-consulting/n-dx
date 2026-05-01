/**
 * Migration command: rename legacy index.md files to title-based filenames.
 *
 * Walks the `.rex/prd_tree/` directory structure, reads the `title` field from each
 * `index.md`, and renames the file to match the normalized title-based filename.
 *
 * This prepares the folder tree for the schema evolution where `index.md` is
 * repurposed as a folder-level summary and each item gets its own title-based
 * markdown file.
 *
 * Idempotent: re-running after a successful migration is a no-op.
 *
 * @module rex/cli/commands/migrate-folder-tree-filenames
 */

import { join } from "node:path";
import { readdir, readFile, rename, stat, appendFile } from "node:fs/promises";
import { info } from "../output.js";
import { appendFilenameSuffix, titleToFilename } from "../../store/title-to-filename.js";
import { REX_DIR } from "./constants.js";
import { FOLDER_TREE_SUBDIR } from "./folder-tree-sync.js";

// ── Public types ──────────────────────────────────────────────────────────────

/** Summary of migration results. */
export interface MigrationResult {
  /** Number of files renamed. */
  filesRenamed: number;
  /** Number of files skipped (already migrated). */
  filesSkipped: number;
  /** Number of files with errors (kept as-is). */
  filesErrored: number;
  /** Set of collision warnings (filename conflicts among siblings). */
  collisionWarnings: string[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Migrate legacy index.md files to title-based filenames.
 *
 * Walks `.rex/prd_tree/` recursively, renames each `index.md` to its title-based
 * filename equivalent, logs each rename, and returns a summary.
 *
 * Idempotent: re-running after migration completes is a no-op.
 */
export async function cmdMigrateFolderTreeFilenames(
  dir: string,
  flags?: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const treeRoot = join(rexDir, FOLDER_TREE_SUBDIR);

  const result = await migrateFolderTreeFilenames(treeRoot);
  const isNoOp = result.filesRenamed === 0 && result.filesErrored === 0;

  if (isNoOp) {
    info(
      `Folder tree filename migration already complete at .rex/${FOLDER_TREE_SUBDIR}/` +
        (result.filesSkipped > 0 ? ` (${result.filesSkipped} file${result.filesSkipped === 1 ? "" : "s"} already migrated)` : ""),
    );
    return;
  }

  info(`Migrated folder tree filenames under .rex/${FOLDER_TREE_SUBDIR}/`);

  if (result.filesRenamed > 0) {
    info(`  ${result.filesRenamed} file${result.filesRenamed === 1 ? "" : "s"} renamed`);
  }

  if (result.collisionWarnings.length > 0) {
    info(`  ⚠ ${result.collisionWarnings.length} collision${result.collisionWarnings.length === 1 ? "" : "s"} resolved with ID suffix:`);
    for (const warning of result.collisionWarnings) {
      info(`    ${warning}`);
    }
  }

  if (result.filesErrored > 0) {
    info(`  ⚠ ${result.filesErrored} file${result.filesErrored === 1 ? "" : "s"} could not be migrated (see log)`);
  }
}

// ── Core migration logic ──────────────────────────────────────────────────────

/**
 * Walk the folder tree and migrate all legacy index.md files to title-based
 * filenames. Returns a summary of what was done.
 */
async function migrateFolderTreeFilenames(treeRoot: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    filesRenamed: 0,
    filesSkipped: 0,
    filesErrored: 0,
    collisionWarnings: [],
  };

  const treeExists = await isDirectory(treeRoot);
  if (!treeExists) {
    return result;
  }

  // Walk all directories and collect index.md files with their titles
  await walkAndMigrate(treeRoot, result);

  return result;
}

/**
 * Recursively walk directory tree, migrating index.md files found.
 * Detects collisions and reports warnings.
 */
async function walkAndMigrate(
  currentDir: string,
  result: MigrationResult,
): Promise<Map<string, string>> {
  // Map of final filenames: title-normalized -> filename used
  const siblingSuffixMap = new Map<string, string>();

  const entries = await listSubdirs(currentDir);

  // First pass: collect all subdirectories and their titles/IDs
  const titleMap = new Map<string, { id: string; title: string }>();
  for (const subdir of entries) {
    const subdirPath = join(currentDir, subdir);
    const indexMdPath = join(subdirPath, "index.md");

    // Try to read the title and ID from index.md
    const titleAndId = await tryExtractTitleAndId(indexMdPath);
    if (titleAndId) {
      titleMap.set(subdir, titleAndId);
    }

    // Recursively process subdirectories
    await walkAndMigrate(subdirPath, result);
  }

  // Second pass: detect collisions among siblings and compute final filenames
  const siblingSuffixes = detectCollisions(titleMap);

  // Third pass: rename files and track operations
  for (const subdir of entries) {
    const subdirPath = join(currentDir, subdir);
    const indexMdPath = join(subdirPath, "index.md");
    const info = titleMap.get(subdir);

    if (!info) continue;

    const baseFilename = titleToFilename(info.title);
    const suffix = siblingSuffixes.get(subdir) ?? "";
    const finalFilename = suffix ? appendFilenameSuffix(baseFilename, suffix) : baseFilename;

    // Only rename if target filename differs from index.md
    if (finalFilename === "index.md") {
      result.filesSkipped++;
      siblingSuffixMap.set(finalFilename, "index.md");
      continue;
    }

    const finalPath = join(subdirPath, finalFilename);

    try {
      await rename(indexMdPath, finalPath);
      result.filesRenamed++;

      // Log the rename operation
      const logEntry = {
        timestamp: new Date().toISOString(),
        event: "rename_item_file",
        itemId: subdir,
        detail: `Renamed index.md → ${finalFilename}`,
      };
      try {
        const logPath = join(currentDir, "..", "..", "..", "execution-log.jsonl");
        await appendFile(logPath, JSON.stringify(logEntry) + "\n", "utf-8");
      } catch {
        // Silently ignore log failures — renaming succeeded
      }

      // Track collision warnings
      if (suffix) {
        result.collisionWarnings.push(`${info.title} → ${finalFilename} (ID collision)`);
      }

      siblingSuffixMap.set(baseFilename, finalFilename);
    } catch (err) {
      result.filesErrored++;
      // Continue with next file
    }
  }

  return siblingSuffixMap;
}

/**
 * Detect filename collisions among siblings: if two items normalize to the
 * same filename, add an ID suffix to disambiguate.
 *
 * Returns a map of sibling subdir name → ID suffix (empty string if no collision).
 */
function detectCollisions(
  titleMap: Map<string, { id: string; title: string }>,
): Map<string, string> {
  const baseToItems = new Map<string, Array<{ subdir: string; id: string }>>();

  // Group siblings by their normalized base filename
  for (const [subdir, { id, title }] of titleMap) {
    const base = titleToFilename(title);
    if (!baseToItems.has(base)) {
      baseToItems.set(base, []);
    }
    baseToItems.get(base)!.push({ subdir, id });
  }

  // Detect collisions and assign suffixes
  const suffixes = new Map<string, string>();
  for (const [, items] of baseToItems) {
    if (items.length > 1) {
      // Collision: add ID suffix to all colliding items
      for (const { subdir, id } of items) {
        const suffix = id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "item";
        suffixes.set(subdir, suffix);
      }
    }
  }

  return suffixes;
}

/**
 * Extract the `title` and `id` fields from a markdown file's YAML frontmatter.
 * Returns { title, id } or null if the file doesn't exist or lacks a title field.
 */
async function tryExtractTitleAndId(filePath: string): Promise<{ title: string; id: string } | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const fm = extractFrontmatter(content);
    const title = fm?.title;
    const id = fm?.id;
    if (typeof title === "string" && typeof id === "string") {
      return { title, id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract YAML frontmatter as a plain object (minimal parsing).
 * Handles the `---` delimiters and basic key: value pairs.
 */
function extractFrontmatter(content: string): Record<string, unknown> | null {
  const lines = content.split("\n");
  let i = 0;

  // Skip empty lines and find opening ---
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length || lines[i].trim() !== "---") {
    return null;
  }
  i++;

  const result: Record<string, unknown> = {};

  // Parse key: value pairs until closing ---
  while (i < lines.length && lines[i].trim() !== "---") {
    const line = lines[i];
    const match = line.match(/^\s*(\w+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      const trimmedValue = value.trim();
      // Handle quoted strings
      if ((trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
          (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))) {
        result[key] = trimmedValue.slice(1, -1);
      } else if (trimmedValue === "true") {
        result[key] = true;
      } else if (trimmedValue === "false") {
        result[key] = false;
      } else if (/^\d+$/.test(trimmedValue)) {
        result[key] = parseInt(trimmedValue, 10);
      } else {
        result[key] = trimmedValue;
      }
    }
    i++;
  }

  return result;
}

// ── Directory utilities ───────────────────────────────────────────────────────

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Return direct subdirectory names in alphabetical order. */
async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    const dirs: string[] = [];
    for (const entry of entries) {
      try {
        if (await isDirectory(join(dir, entry))) {
          dirs.push(entry);
        }
      } catch {
        // Skip entries we can't stat
      }
    }
    return dirs.sort();
  } catch {
    return [];
  }
}
