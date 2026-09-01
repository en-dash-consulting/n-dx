/**
 * Folder-tree sync and read helpers.
 *
 * `syncFolderTree` — called after every PRD write mutation to re-serialize the
 * in-memory store to the `.rex/prd_tree/` folder structure.
 *
 * `loadItemsPreferFolderTree` — canonical read path for status, next, and
 * validate. Reads items from the required `.rex/prd_tree/` folder tree; throws if
 * the tree is absent (directing the user to run `rex migrate-to-folder-tree`).
 */

import { join } from "node:path";
import { serializeFolderTree, collectItemIds, parseFolderTree, withLock, PRD_TREE_DIRNAME, PRD_TREE_LOCK_FILENAME } from "../../store/index.js";
import { walkTree } from "../../core/tree.js";
import type { PRDStore } from "../../store/index.js";
import type { PRDItem } from "../../schema/index.js";

/**
 * Subdirectory name within `.rex/` that holds the folder tree.
 *
 * Re-exported under the `FOLDER_TREE_SUBDIR` name for legacy CLI consumers;
 * new code should import `PRD_TREE_DIRNAME` directly from `../../store/index.js`.
 */
export const FOLDER_TREE_SUBDIR = PRD_TREE_DIRNAME;

/**
 * Re-serialize the full PRD to the folder tree at `<rexDir>/<PRD_TREE_DIRNAME>/`.
 *
 * Loads the current document state from the store and writes it to the
 * folder structure. Errors propagate to the caller.
 *
 * This is a read-modify-write, so it holds the folder-tree lock across both
 * halves. Callers reach it after their own transaction has committed and
 * released the lock, at which point any writer that was queued behind that
 * transaction is free to run: loading outside the lock would hand this sync a
 * document taken before that writer's insert, and `serializeFolderTree`
 * deletes on-disk items absent from the document it is given. An acknowledged
 * write would vanish with no error.
 *
 * `knownItemIds` is passed for the same reason — without it `guardStaleEntries`
 * is disabled and deletions are applied silently. With the lock held the guard
 * should never fire; if it does, some writer reached the tree without taking
 * the lock, and failing loudly is the correct outcome.
 *
 * Never call this from inside `store.withTransaction` — the lock is not
 * reentrant, and the nested acquisition would block until its timeout.
 */
export async function syncFolderTree(rexDir: string, store: PRDStore): Promise<void> {
  const treeRoot = join(rexDir, FOLDER_TREE_SUBDIR);
  await withLock(join(rexDir, PRD_TREE_LOCK_FILENAME), async () => {
    // Taken from the document this load produced: the guard vouches only for
    // items the read actually saw, so anything on disk it did not see belongs
    // to a writer that bypassed the lock.
    const doc = await store.loadDocument();
    await serializeFolderTree(doc.items, treeRoot, {
      knownItemIds: collectItemIds(doc.items),
    });
  });
}

/**
 * Load PRD items from the folder tree at `<rexDir>/<PRD_TREE_DIRNAME>/`.
 *
 * Reads from the folder tree and merges the parsed items with the full-fidelity
 * store items to reattach routing/metadata fields that the tree format does
 * not store (e.g. `blockedBy`, `overrideMarker`, `branch`, `sourceFile`).
 *
 * The merge preserves store item ordering (insertion order) so that command
 * output is byte-for-byte identical across multiple reads of the same dataset.
 * Items present in the store but absent from the tree (e.g. tasks placed
 * directly under an epic without an intermediate feature) are preserved from
 * the store.
 *
 * The folder tree is required. If absent, an error is thrown directing the user
 * to run 'rex migrate-to-folder-tree'.
 *
 * The caller is expected to have already successfully called
 * `store.loadDocument()` before invoking this function. This ensures that if
 * no backing files exist at all, the error surfaces there (with a clear
 * user-facing message via `formatCLIError`) rather than here.
 *
 * Errors from the serializer or parser propagate to the caller.
 */
export async function loadItemsPreferFolderTree(
  rexDir: string,
  store: PRDStore,
): Promise<PRDItem[]> {
  const treeRoot = join(rexDir, FOLDER_TREE_SUBDIR);

  const [{ items: treeItems }, doc] = await Promise.all([
    parseFolderTree(treeRoot),
    store.loadDocument(),
  ]);

  // Build a flat map of tree items by ID so the merge can look up by ID.
  const treeById = new Map<string, PRDItem>();
  for (const { item } of walkTree(treeItems)) {
    treeById.set(item.id, item);
  }

  // Return store items merged with tree content (store order preserved).
  return mergeStoreWithTree(doc.items, treeById);
}

/**
 * Merge store items with tree items.
 *
 * Iterates store items in their original order. For each item that also
 * appears in the tree, spreads tree fields on top of the store item so
 * that:
 *  - Content fields (title, status, description, …) from the tree override
 *    the store in case of any divergence (e.g. a manual edit to index.md).
 *  - Routing/metadata fields absent from the tree (blockedBy, branch, …)
 *    are preserved from the store item unchanged.
 * Items absent from the tree are kept as-is from the store.
 */
function mergeStoreWithTree(
  storeItems: PRDItem[],
  treeById: Map<string, PRDItem>,
): PRDItem[] {
  return storeItems.map((storeItem) => {
    const treeItem = treeById.get(storeItem.id);
    if (!treeItem) return storeItem;

    // Spread store first (routing/metadata), then tree (content override).
    // Only spread enumerable own properties — avoids accidental prototype fields.
    // Preserve `level` from the store: the tree parser infers level from
    // directory depth and may produce a wrong level for items placed at
    // an incorrect hierarchy position (which `rex validate` is designed to
    // detect).
    const merged: PRDItem = { ...storeItem, ...treeItem, level: storeItem.level };

    // Children: recurse over store children (preserving store order and any
    // store-only children that were not representable in the tree).
    if (storeItem.children && storeItem.children.length > 0) {
      merged.children = mergeStoreWithTree(storeItem.children, treeById);
    }

    return merged;
  });
}
