/**
 * Structural migration pass for folder-per-task conformance.
 *
 * The folder-per-task schema requires:
 * 1. Each task (and lower levels) should live in its own directory
 * 2. The directory should contain a title-named .md file (e.g., task_title.md)
 * 3. Subtasks with children must be in a folder, not a bare .md file
 *
 * This pass scans the PRD tree and detects non-conforming structures:
 * - Bare .md files at the task level (should be in a folder)
 * - Subtask .md files that have orphaned child siblings (should be in a folder)
 *
 * The migration is idempotent: running it twice on a conforming tree produces
 * zero changes.
 *
 * @module core/folder-per-task-migration
 */

import { readdir, readFile, rm, rename, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, type ParseWarning } from "../store/folder-tree-parser.js";

/**
 * Result of running the folder-per-task structural migration.
 */
export interface FolderPerTaskMigrationResult {
  /** Number of files that were migrated. */
  migratedCount: number;
  /** Details of each migration. */
  migrations: Array<{
    path: string;
    type:
      | "bare-task-to-folder"
      | "subtask-with-children-to-folder"
      | "phantom-index-wrapper-merged"
      | "phantom-index-wrapper-removed"
      | "title-md-renamed-to-index";
    beforePath: string;
    afterPath: string;
  }>;
  /** Errors encountered during migration. */
  errors: Array<{ path: string; error: string }>;
}

/**
 * Scan the folder tree and detect/migrate non-conforming task-level structures.
 * Returns a summary of what was migrated.
 *
 * Pass order is significant:
 *   1. Phantom-index-wrapper cleanup runs first because it can leave a parent
 *      folder unparseable (no own `index.md`). Other passes assume a
 *      parser-readable tree.
 *   2. The recursive folder-per-task scan handles bare `<title>.md` files and
 *      subtask `.md` files with orphaned children.
 *   3. The title-md-to-index normalization renames `<title>.md` to `index.md`
 *      inside item folders so the canonical (index.md-only) shape lands on
 *      disk.
 */
export async function migrateToFolderPerTask(
  treeRoot: string,
): Promise<FolderPerTaskMigrationResult> {
  const result: FolderPerTaskMigrationResult = {
    migratedCount: 0,
    migrations: [],
    errors: [],
  };

  const rootExists = await stat(treeRoot)
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (!rootExists) {
    return result; // Tree doesn't exist - nothing to migrate
  }

  try {
    await cleanupPhantomIndexWrappers(treeRoot, result);
  } catch (err) {
    result.errors.push({
      path: treeRoot,
      error: `Phantom-wrapper cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  try {
    await migrateDirRecursive(treeRoot, "epic", 0, result);
  } catch (err) {
    result.errors.push({
      path: treeRoot,
      error: `Failed to scan tree: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  try {
    await renameTitleMdToIndexMd(treeRoot, result);
  } catch (err) {
    result.errors.push({
      path: treeRoot,
      error: `Title-md normalization failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return result;
}

/**
 * Walk the tree and remove `index-{hash}/` phantom wrapper folders. These are
 * artifacts of the previous migration: when an item folder's `index.md` was
 * itself wrapped (because the migration treated it as a bare file), the result
 * was a sibling folder named `index-{hash}` containing a single `index.md`
 * with the parent's metadata, leaving the parent folder with no own
 * `index.md` and rendering the entire subtree unparseable.
 *
 * For each match we promote the wrapped `index.md` back to the parent folder
 * (or just delete the phantom if the parent already has its own `index.md`).
 */
async function cleanupPhantomIndexWrappers(
  treeRoot: string,
  result: FolderPerTaskMigrationResult,
): Promise<void> {
  const stack: string[] = [treeRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(dir, entry);
      const isDir = await stat(entryPath).then((s) => s.isDirectory()).catch(() => false);
      if (!isDir) continue;

      // Phantom pattern: name starts with `index-` and contains only `index.md`.
      if (/^index-[A-Za-z0-9-]+$/.test(entry)) {
        const phantomEntries = await readdir(entryPath).catch(() => [] as string[]);
        if (phantomEntries.length === 1 && phantomEntries[0] === "index.md") {
          const phantomIndex = join(entryPath, "index.md");
          const parentIndex = join(dir, "index.md");
          const parentHasIndex = await stat(parentIndex).then(() => true).catch(() => false);

          try {
            if (parentHasIndex) {
              // Parent already has its content file; the phantom is a dupe.
              await rm(entryPath, { recursive: true, force: true });
              result.migrations.push({
                path: entryPath,
                type: "phantom-index-wrapper-removed",
                beforePath: phantomIndex,
                afterPath: parentIndex,
              });
            } else {
              // Promote the wrapped index.md back to the parent folder.
              await rename(phantomIndex, parentIndex);
              await rm(entryPath, { recursive: true, force: true });
              result.migrations.push({
                path: entryPath,
                type: "phantom-index-wrapper-merged",
                beforePath: phantomIndex,
                afterPath: parentIndex,
              });
            }
            result.migratedCount++;
          } catch (err) {
            result.errors.push({
              path: entryPath,
              error: `Failed to merge phantom wrapper: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
          continue; // Don't recurse into the phantom; it's gone.
        }
      }

      stack.push(entryPath);
    }
  }
}

/**
 * Walk the tree and, for each folder that contains exactly one item-level
 * `<title>.md` file alongside an `index.md`, delete the `<title>.md` (the
 * canonical content lives in `index.md` per the new schema). For folders
 * with only a `<title>.md` (no `index.md`), rename it to `index.md`.
 *
 * Leaf-subtask `.md` files at parent level (Rule 1b) are left untouched —
 * they live alongside the parent's `index.md` and are identified by their
 * frontmatter `level` being one below the parent folder's expected level.
 * We conservatively keep any `.md` file we cannot positively identify as the
 * folder's own `<title>.md`; the serializer's `removeStaleEntries` will
 * sweep up actual leftovers on the next save.
 */
async function renameTitleMdToIndexMd(
  treeRoot: string,
  result: FolderPerTaskMigrationResult,
): Promise<void> {
  // `expectedLevel` is the level of the item whose `index.md` lives directly
  // in `dir`. The treeRoot itself is not a PRD item, so its expectedLevel is
  // null; its immediate subdirectories are epic folders, and so on.
  type Frame = { dir: string; expectedLevel: "epic" | "feature" | "task" | "subtask" | null };
  const stack: Frame[] = [{ dir: treeRoot, expectedLevel: null }];

  while (stack.length > 0) {
    const { dir, expectedLevel } = stack.pop()!;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    const subdirs: string[] = [];
    const mdFiles: string[] = [];
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      const isDir = await stat(entryPath).then((s) => s.isDirectory()).catch(() => false);
      if (isDir) subdirs.push(entry);
      else if (entry.endsWith(".md")) mdFiles.push(entry);
    }

    if (expectedLevel !== null) {
      const ownContentFiles: string[] = [];
      for (const mdFile of mdFiles) {
        const lvl = await readItemLevel(join(dir, mdFile));
        if (lvl === expectedLevel) ownContentFiles.push(mdFile);
      }

      const hasIndex = ownContentFiles.includes("index.md");
      const titleNamed = ownContentFiles.filter((f) => f !== "index.md");

      if (hasIndex && titleNamed.length > 0) {
        for (const stale of titleNamed) {
          const stalePath = join(dir, stale);
          try {
            await rm(stalePath, { force: true });
            result.migrations.push({
              path: stalePath,
              type: "title-md-renamed-to-index",
              beforePath: stalePath,
              afterPath: join(dir, "index.md"),
            });
            result.migratedCount++;
          } catch (err) {
            result.errors.push({
              path: stalePath,
              error: `Failed to remove redundant <title>.md: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      } else if (!hasIndex && titleNamed.length === 1) {
        const stalePath = join(dir, titleNamed[0]);
        const indexPath = join(dir, "index.md");
        try {
          await rename(stalePath, indexPath);
          result.migrations.push({
            path: stalePath,
            type: "title-md-renamed-to-index",
            beforePath: stalePath,
            afterPath: indexPath,
          });
          result.migratedCount++;
        } catch (err) {
          result.errors.push({
            path: stalePath,
            error: `Failed to rename <title>.md to index.md: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    const childExpected: "epic" | "feature" | "task" | "subtask" =
      expectedLevel === null ? "epic"
        : expectedLevel === "epic" ? "feature"
          : expectedLevel === "feature" ? "task"
            : "subtask";
    for (const sub of subdirs) {
      stack.push({ dir: join(dir, sub), expectedLevel: childExpected });
    }
  }
}

/**
 * Recursively scan and migrate a directory and its children.
 * currentLevel is the level of items we expect to find AT this directory.
 * depth is the actual nesting depth: 0 (root), 1 (epic), 2 (feature), 3 (task), 4+ (subtask).
 */
async function migrateDirRecursive(
  dir: string,
  currentLevel: "epic" | "feature" | "task" | "subtask",
  depth: number,
  result: FolderPerTaskMigrationResult,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  // Categorize entries
  const subdirs: string[] = [];
  const mdFiles: string[] = [];

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const isDir = await stat(entryPath)
      .then((s) => s.isDirectory())
      .catch(() => false);

    if (isDir) {
      subdirs.push(entry);
    } else if (entry.endsWith(".md") && !entry.startsWith(".")) {
      mdFiles.push(entry);
    }
  }

  // Check if this directory itself is an item folder
  // An item folder should have index.md or a title-based file at the currentLevel
  // For conforming structures, index.md is preferred. For legacy structures, title-based files are OK.
  // We know this is an item folder if:
  // - It has index.md at currentLevel, OR
  // - It has a title-based file at currentLevel AND it has no other files at currentLevel
  // The second condition helps us detect task-slug/task_title.md where task_title.md is the item
  let dirIsItemFolder = false;
  const filesAtCurrentLevel = [];
  for (const mdFile of mdFiles) {
    const level = await readItemLevel(join(dir, mdFile));
    if (level === currentLevel) {
      filesAtCurrentLevel.push(mdFile);
    }
  }
  // If there's exactly one file at currentLevel, it's probably the item's own file
  // (either index.md or a title-based file like task_title.md)
  if (filesAtCurrentLevel.length === 1) {
    dirIsItemFolder = true;
  }

  // The child level is what we expect to find in subdirectories
  const childLevel = currentLevel === "epic"
    ? "feature"
    : currentLevel === "feature"
      ? "task"
      : currentLevel === "task"
        ? "subtask"
        : "subtask" as const;

  // Detect and migrate non-conforming files:
  // - Subtask .md files with children (check this FIRST)
  // - Bare task/subtask .md files that should be in folders
  for (const mdFile of mdFiles) {
    const itemLevel = await readItemLevel(join(dir, mdFile));

    // Check for subtask .md files with children BEFORE bare file migration
    if (itemLevel === "subtask" && currentLevel === "task") {
      // At task level, check for subtask .md files with children
      const hasChildren = await hasChildrenSiblings(dir, mdFile);
      if (hasChildren) {
        try {
          await migrateSubtaskWithChildrenToFolder(dir, mdFile, result);
          result.migratedCount++;
        } catch (err) {
          result.errors.push({
            path: join(dir, mdFile),
            error: `Failed to migrate: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        // Skip further processing for this file since we handled the children
        continue;
      }
      // If no children, fall through to bare file migration below
    }

    // Check if this is a bare task file that has child subdirectories
    // If so, migrate it to a folder (this handles non-conforming structures with task1.md + task1-sub1/)
    if (itemLevel === "task" && currentLevel === "task") {
      // This might be a bare task file with children
      const hasChildren = await hasChildrenSiblings(dir, mdFile);
      if (hasChildren) {
        try {
          await migrateBareFileToFolder(dir, mdFile, result);
          result.migratedCount++;
        } catch (err) {
          result.errors.push({
            path: join(dir, mdFile),
            error: `Failed to migrate: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        continue;
      }
      // If no children, fall through to the next check
    }

    // Bare task/subtask file in a container that is NOT an item folder.
    // Under the unified leaf rule a bare `<slug>.md` at the parent level is
    // the correct shape for a leaf, so we only wrap it into a folder when it
    // has child siblings (sibling subdirs whose names extend the leaf's
    // base name) — that combination is the ambiguous legacy shape.
    if (!dirIsItemFolder && itemLevel === currentLevel && (itemLevel === "task" || itemLevel === "subtask")) {
      const hasChildren = await hasChildrenSiblings(dir, mdFile);
      if (hasChildren) {
        try {
          await migrateBareFileToFolder(dir, mdFile, result);
          result.migratedCount++;
        } catch (err) {
          result.errors.push({
            path: join(dir, mdFile),
            error: `Failed to migrate: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        continue;
      }
    }

    // A file at child-level (e.g. a feature .md at epic-dir level) is a
    // leaf under the new schema and must stay bare unless it has children.
    if (itemLevel === childLevel && currentLevel !== childLevel) {
      const hasChildren = await hasChildrenSiblings(dir, mdFile);
      if (hasChildren) {
        try {
          await migrateBareFileToFolder(dir, mdFile, result);
          result.migratedCount++;
        } catch (err) {
          result.errors.push({
            path: join(dir, mdFile),
            error: `Failed to migrate: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }
  }

  // Recurse into subdirectories
  for (const subdir of subdirs) {
    const subdirPath = join(dir, subdir);
    // The next level is one level deeper
    const nextLevel = childLevel;
    const nextDepth = depth + 1;
    await migrateDirRecursive(subdirPath, nextLevel, nextDepth, result);
  }
}

/**
 * Read the `level` field from an item's markdown file frontmatter.
 * Returns null when the file is missing, malformed, or has no level field.
 */
async function readItemLevel(mdPath: string): Promise<string | null> {
  try {
    const content = await readFile(mdPath, "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const levelMatch = fmMatch[1].match(/^level:\s*"?([^"\n]+)"?/m);
    return levelMatch ? levelMatch[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Check if a directory has child siblings (slug-prefixed directories) for a
 * given subtask .md file. This indicates orphaned children.
 */
async function hasChildrenSiblings(dir: string, mdFile: string): Promise<boolean> {
  // Extract the base name from the .md file
  const baseName = mdFile.replace(/\.md$/, "");

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return false;
  }

  // Look for directories that start with the base name (likely children)
  for (const entry of entries) {
    if (entry.startsWith(baseName + "-") && !entry.endsWith(".md")) {
      const entryPath = join(dir, entry);
      const isDir = await stat(entryPath)
        .then((s) => s.isDirectory())
        .catch(() => false);
      if (isDir) {
        return true; // Found a child directory
      }
    }
  }

  return false;
}

/**
 * Migrate a bare task/subtask .md file to a folder structure.
 *
 * 1. Create a new folder with the task's slug
 * 2. Move the .md file into the folder
 * 3. Optionally rename it to index.md (or keep the title-based name)
 *
 * For now, we'll create a folder with a slug and move the file as index.md.
 */
async function migrateBareFileToFolder(
  dir: string,
  mdFile: string,
  result: FolderPerTaskMigrationResult,
): Promise<void> {
  const mdPath = join(dir, mdFile);

  // Read the file to get the ID and title for slug generation
  const content = await readFile(mdPath, "utf-8");
  const parseWarnings: ParseWarning[] = [];
  const fm = parseFrontmatter(content, mdPath, parseWarnings);

  if (!fm || !fm.id || !fm.title) {
    throw new Error(`Invalid frontmatter: missing id or title`);
  }

  // Generate a slug based on the item's ID and title
  const slug = `${mdFile.replace(/\.md$/, "")}-${String(fm.id).slice(0, 6)}`;
  const folderPath = join(dir, slug);

  // Create the folder
  await mkdir(folderPath, { recursive: true });

  // Move the .md file to the folder as index.md (or as the title-based name)
  const newMdPath = join(folderPath, "index.md");
  await rename(mdPath, newMdPath);

  result.migrations.push({
    path: mdPath,
    type: "bare-task-to-folder",
    beforePath: mdPath,
    afterPath: newMdPath,
  });
}

/**
 * Migrate a subtask .md file with children to a folder structure.
 *
 * 1. Create a new folder for the subtask
 * 2. Move the .md file to the folder
 * 3. Move any child directories into the folder
 */
async function migrateSubtaskWithChildrenToFolder(
  dir: string,
  mdFile: string,
  result: FolderPerTaskMigrationResult,
): Promise<void> {
  const mdPath = join(dir, mdFile);
  const baseName = mdFile.replace(/\.md$/, "");

  // Read the file to get the ID for slug generation
  const content = await readFile(mdPath, "utf-8");
  const parseWarnings: ParseWarning[] = [];
  const fm = parseFrontmatter(content, mdPath, parseWarnings);

  if (!fm || !fm.id) {
    throw new Error(`Invalid frontmatter: missing id`);
  }

  // Generate a slug
  const slug = `${baseName}-${String(fm.id).slice(0, 6)}`;
  const folderPath = join(dir, slug);

  // Create the folder
  await mkdir(folderPath, { recursive: true });

  // Move the .md file to the folder
  const newMdPath = join(folderPath, "index.md");
  await rename(mdPath, newMdPath);

  // Move child directories to the folder
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === slug) continue; // Skip the folder we just created
    if (entry.startsWith(baseName + "-") && !entry.endsWith(".md")) {
      const entryPath = join(dir, entry);
      const isDir = await stat(entryPath)
        .then((s) => s.isDirectory())
        .catch(() => false);
      if (isDir) {
        // Move this child to the subtask folder
        const newChildPath = join(folderPath, entry);
        await rename(entryPath, newChildPath);
      }
    }
  }

  result.migrations.push({
    path: mdPath,
    type: "subtask-with-children-to-folder",
    beforePath: mdPath,
    afterPath: newMdPath,
  });
}
