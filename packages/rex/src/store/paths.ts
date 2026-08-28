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
 */
export const PRD_TREE_LOCK_FILENAME = "tree.lock";
