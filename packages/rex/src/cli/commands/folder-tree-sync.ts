/**
 * Folder-tree sync helper.
 *
 * Called after every PRD write mutation (add, edit, remove, move) to
 * re-serialize the in-memory store to the `.rex/tree/` folder structure.
 */

import { join } from "node:path";
import { serializeFolderTree } from "../../store/index.js";
import type { PRDStore } from "../../store/index.js";

/** Subdirectory name within `.rex/` that holds the folder tree. */
export const FOLDER_TREE_SUBDIR = "tree";

/**
 * Re-serialize the full PRD to the folder tree at `<rexDir>/tree/`.
 *
 * Loads the current document state from the store and writes it to the
 * folder structure. Errors propagate to the caller.
 */
export async function syncFolderTree(rexDir: string, store: PRDStore): Promise<void> {
  const doc = await store.loadDocument();
  const treeRoot = join(rexDir, FOLDER_TREE_SUBDIR);
  await serializeFolderTree(doc.items, treeRoot);
}
