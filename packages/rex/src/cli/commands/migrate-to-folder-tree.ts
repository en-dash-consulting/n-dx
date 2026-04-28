import { join } from "node:path";
import { info } from "../output.js";
import { resolveStore, serializeFolderTree } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import { FOLDER_TREE_SUBDIR } from "./folder-tree-sync.js";

/**
 * One-shot migration from prd.md to the folder-tree format.
 *
 * Reads the current PRD from the store (prd.md / prd.json), serializes it
 * to the folder tree at `.rex/tree/`, and prints a creation summary.
 *
 * Idempotent: re-running on an already-migrated project updates changed
 * items without duplicating directories.
 */
export async function cmdMigrateToFolderTree(dir: string): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();
  const treeRoot = join(rexDir, FOLDER_TREE_SUBDIR);

  const result = await serializeFolderTree(doc.items, treeRoot);

  const { directoriesCreated, filesWritten, filesSkipped, directoriesRemoved } = result;

  if (directoriesCreated === 0 && filesWritten === 0 && directoriesRemoved === 0) {
    info(
      `Folder tree already up to date at .rex/${FOLDER_TREE_SUBDIR}/` +
        (filesSkipped > 0 ? ` (${filesSkipped} file${filesSkipped === 1 ? "" : "s"} unchanged)` : ""),
    );
    return;
  }

  info(`Migrated .rex/prd.md → .rex/${FOLDER_TREE_SUBDIR}/`);
  const parts: string[] = [];
  if (directoriesCreated > 0) {
    parts.push(`${directoriesCreated} folder${directoriesCreated === 1 ? "" : "s"} created`);
  }
  if (filesWritten > 0) {
    parts.push(`${filesWritten} index.md file${filesWritten === 1 ? "" : "s"} written`);
  }
  if (directoriesRemoved > 0) {
    parts.push(`${directoriesRemoved} stale folder${directoriesRemoved === 1 ? "" : "s"} removed`);
  }
  if (parts.length > 0) {
    info(`  ${parts.join(", ")}`);
  }
}
