/**
 * Canonical folder-tree storage path.
 *
 * `PRD_TREE_DIRNAME` is the single source of truth for the subdirectory of
 * `.rex/` that holds the PRD folder-tree backend (one directory per item,
 * each with an `index.md`). Every read or write site — CLI, MCP, web server,
 * hench gateway — must compose its path from this constant rather than
 * hardcoding the literal string. Renaming the directory is therefore a
 * single-line change here.
 */
export const PRD_TREE_DIRNAME = "prd_tree";

/**
 * Lock file guarding writes to the folder tree, relative to `.rex/`.
 *
 * Every writer that serializes the tree must hold this lock across its whole
 * read-modify-write, not just the write: `serializeFolderTree` deletes on-disk
 * items absent from the document it is given, so a snapshot loaded outside the
 * lock can destroy a concurrent writer's work. Shared here rather than spelled
 * out at each site so a writer cannot drift onto a different lock file and
 * silently stop serializing against the others.
 *
 * `FolderTreeStore` used to take `prd.lock` here while `FileStore` took
 * `tree.lock`, so the two did not exclude each other over the same directory.
 * Unifying them needed no transition period: `FolderTreeStore` was instantiated
 * only by tests (`resolveStore` always returns a `FileStore`), so no live
 * process ever held `prd.lock`. Renaming this constant again would not be as
 * cheap — a process running the old build would hold the old name and the two
 * builds would stop serializing. Cut over via a release that acquires both
 * names, or accept the window knowingly.
 */
export const PRD_TREE_LOCK_FILENAME = "tree.lock";
