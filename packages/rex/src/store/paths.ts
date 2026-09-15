import { join } from "node:path";

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
 * Name of the folder tree's sidecar file inside `.rex/`.
 *
 * It sits *beside* `.rex/<PRD_TREE_DIRNAME>/`, not inside it, but it is part of
 * the same backend: every store save rewrites it, and it is tracked in git like
 * the tree is. Anything that stages, discounts or skips the tree has to account
 * for this file too — hench's commit paths most of all, where forgetting it left
 * ` M .rex/tree-meta.json` dirty after every PRD write and the completion gate
 * refused every task.
 *
 * @see {@link file://./tree-meta.ts} for the contents.
 */
export const TREE_META_FILENAME = "tree-meta.json";

/**
 * Name of the advisory lock file that guards `.rex/<PRD_TREE_DIRNAME>/`.
 *
 * One lock name for one resource. `FileStore` and `FolderTreeStore` both
 * serialize the same folder tree, so both must contend on the same file —
 * two names would let a writer on each store rewrite the tree simultaneously
 * with neither seeing the other.
 */
export const PRD_LOCK_FILENAME = "prd.lock";

/** Path to the folder-tree lock file for a given `.rex` directory. */
export function prdLockPath(rexDir: string): string {
  return join(rexDir, PRD_LOCK_FILENAME);
}
