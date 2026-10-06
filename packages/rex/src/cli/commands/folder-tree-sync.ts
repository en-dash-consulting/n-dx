/**
 * Folder-tree sync and read helpers.
 *
 * `syncFolderTree` — re-serialize the whole store to `.rex/prd_tree/`.
 * **No longer part of any write path**, and not to be added back to one.
 * It dates from a store that persisted JSON with the tree as a derived
 * mirror; since the tree became the backend, `FileStore.writeFolderTree`
 * has written it inside the same locked span as the mutation, so the 18
 * `await syncFolderTree(...)` calls that used to follow every mutation were
 * re-reading and re-writing a tree that was already correct — ~1.2 s per
 * mutation on a 431-item PRD, for no byte of change.
 *
 * They were also the *weaker* of the two writes. `writeFolderTree` also
 * records `tree-meta.json` and passes `loadedAt`/`loadedFiles` to the
 * serializer, which arms the stale-save guard; this function passes no
 * options, so `removeStaleEntries` returns early and the guard is off. A
 * second, unguarded full-tree rewrite immediately after a guarded one could
 * delete exactly what the guard had just refused to.
 *
 * It is kept because it is still the right tool for a deliberate, operator-
 * initiated full rebuild of the tree from the store, and its locking
 * behaviour is pinned by `concurrent-write-lost-update.test.ts` and
 * `write-path-parity.test.ts`.
 *
 * `loadItemsPreferFolderTree` — canonical read path for status, next, and
 * validate. Reads items from the required `.rex/prd_tree/` folder tree; throws if
 * the tree is absent (directing the user to run `rex migrate-to-folder-tree`).
 */

import { join } from "node:path";
import { serializeFolderTree, parseFolderTree, PRD_TREE_DIRNAME, prdLockPath, withLock, assertSlugRuleWritable, readPerfFlags } from "../../store/index.js";
import { walkTree } from "../../core/tree.js";
import type { PRDStore } from "../../store/index.js";
import type { PRDItem, PRDDocument } from "../../schema/index.js";

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
 * Runs under the folder-tree lock. This is a full read-modify-write of the
 * tree — it deletes every on-disk entry absent from the snapshot it just
 * loaded — so an unlocked sync racing a store write both crashed (the read
 * observes a half-created item directory and `parseFolderTree` throws ENOENT)
 * and silently dropped the other writer's items. Holding the lock across the
 * load and the serialize also makes the snapshot un-staleable, which is why
 * no `loadedAt` proof is needed here.
 *
 * Callers must not already hold the lock: it is not reentrant. Every call
 * site runs after its store mutation has committed and released.
 */
export async function syncFolderTree(rexDir: string, store: PRDStore): Promise<void> {
  const treeRoot = join(rexDir, FOLDER_TREE_SUBDIR);
  await withLock(prdLockPath(rexDir), async () => {
    const doc = await store.loadDocument();
    // This is a full-tree rewrite that calls the serializer directly rather
    // than going through a store, so it does not inherit the store's
    // slug-rule guard and must apply it itself. Today every caller happens to
    // perform a guarded store write first, which is the only reason a foreign
    // build is not already re-slugging the tree here — a shield made of
    // sixteen call sites, each of which has to keep holding for the guard to
    // mean anything. Checking here makes the guarantee a property of the
    // write instead of a property of who happened to call it.
    await assertSlugRuleWritable(rexDir, treeRoot);
    await serializeFolderTree(doc.items, treeRoot);
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
  loaded?: PRDDocument,
): Promise<PRDItem[]> {
  // Fast path (`performance.fastReads`): skip straight to the items.
  //
  // The merge below exists to reattach fields the *store* held and the tree
  // could not represent. That was true of a JSON-backed store; it has not
  // been true since the folder tree became the backend, because
  // `FileStore.loadDocument` reads the tree — so the merge is now
  // `{...x, ...x}` over two parses of the same directory, and the caller has
  // usually parsed it a third time before calling here.
  //
  // Equivalence holds on the legacy paths too: with no tree,
  // `parseFolderTree` yields nothing and the merge returns the store's items
  // unchanged, which is exactly what the fast path returns.
  // `fast-read-equivalence.test.ts` pins both against the slow path.
  if (readPerfFlags(rexDir).fastReads) {
    return (loaded ?? (await store.loadDocument())).items;
  }

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
