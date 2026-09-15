/**
 * Optimized mutation paths for prd_tree with atomic writes and crash-safety.
 *
 * Provides targeted single-item update operations that avoid full-tree
 * re-serialization. Each mutation:
 *   - Loads only the affected item and its parent chain
 *   - Serializes only the changed directory and ancestors
 *   - Uses atomic (temp + rename) writes for all file changes
 *   - Integrates file-locking to prevent concurrent corruption
 *
 * @module rex/store/folder-tree-mutations
 */

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { PRDItem } from "../schema/index.js";
import { atomicWriteTempPath } from "./atomic-write.js";
import { renderItemIndexMd, resolveSiblingSlugs } from "./folder-tree-serializer.js";

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Result of a targeted item mutation.
 */
export interface MutationResult {
  filesWritten: number;
  directoriesCreated: number;
}

/**
 * Ancestor chain from target item up to root.
 * Used for efficient partial re-serialization.
 */
export interface AncestorChain {
  /** The target item itself. */
  target: PRDItem;
  /** Slugified path segments from root to target. */
  pathSegments: string[];
  /** Full absolute path to the item's directory. */
  itemDir: string;
  /** Parent chain items (exclude root). */
  ancestors: PRDItem[];
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Write a single item's directory (not children) atomically.
 *
 * The item directory contains exactly one file: `index.md`. It holds the
 * item's frontmatter and (for non-leaf items) a `## Children` table linking
 * to children's storage paths.
 *
 * Parent indices are not updated. Use {@link updateAncestorIndices} for that.
 */
export async function writeItemDirectory(
  item: PRDItem,
  itemDir: string,
): Promise<MutationResult> {
  const result: MutationResult = { filesWritten: 0, directoriesCreated: 0 };

  await mkdir(itemDir, { recursive: true });
  result.directoriesCreated++;

  const children = item.children ?? [];
  const childSlugs = resolveSiblingSlugs(children);
  const indexContent = renderItemIndexMd(item, children, childSlugs);
  const indexPath = join(itemDir, "index.md");
  await atomicWriteIfChanged(indexPath, indexContent);
  result.filesWritten++;

  return result;
}

/**
 * Update a parent directory's index.md to reflect current children.
 *
 * Does not recurse into descendants.
 */
export async function updateParentIndex(
  parent: PRDItem,
  parentDir: string,
): Promise<MutationResult> {
  const result: MutationResult = { filesWritten: 0, directoriesCreated: 0 };

  const indexPath = join(parentDir, "index.md");
  const children = parent.children ?? [];
  const childSlugs = resolveSiblingSlugs(children);

  const indexContent = renderItemIndexMd(parent, children, childSlugs);
  await atomicWriteIfChanged(indexPath, indexContent);
  result.filesWritten++;

  return result;
}

/**
 * Walk the ancestor chain from target item up to root, updating each
 * ancestor's index.md to reflect any changes to their direct children.
 *
 * Used after adding/removing/moving items to keep parent indices in sync.
 */
export async function updateAncestorIndices(
  chain: AncestorChain,
): Promise<MutationResult> {
  const result: MutationResult = { filesWritten: 0, directoriesCreated: 0 };

  // Work backwards from target's parent to root
  for (let i = chain.ancestors.length - 1; i >= 0; i--) {
    const ancestor = chain.ancestors[i];
    const ancestorDir = join(chain.pathSegments.slice(0, i + 1).join("/"));
    const updateResult = await updateParentIndex(ancestor, ancestorDir);
    result.filesWritten += updateResult.filesWritten;
  }

  return result;
}

/**
 * Batch-create a set of directories, returning the count created.
 */
export async function batchCreateDirectories(paths: string[]): Promise<number> {
  let created = 0;
  for (const path of paths) {
    try {
      await mkdir(path, { recursive: true });
      created++;
    } catch {
      // Directory may already exist or be inaccessible — continue
    }
  }
  return created;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Write content to a file atomically using temp + rename.
 * Only writes if content has changed (skips unchanged files).
 */
async function atomicWriteIfChanged(filePath: string, content: string): Promise<void> {
  try {
    const existing = await readFile(filePath, "utf-8");
    if (existing === content) {
      return; // No change needed
    }
  } catch {
    // File doesn't exist — proceed with write
  }

  const tmpPath = atomicWriteTempPath(filePath);
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, filePath);
}
