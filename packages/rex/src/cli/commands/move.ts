import { join } from "node:path";
import { resolveStore, ensureLegacyPrdMigrated } from "../../store/index.js";
import { validateMove, moveItem } from "../../core/move.js";
import { REX_DIR } from "./constants.js";
import { syncFolderTree } from "./folder-tree-sync.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";

export async function cmdMove(
  dir: string,
  id: string,
  flags: Record<string, string>,
): Promise<void> {
  // Ensure legacy .rex/prd.json is migrated to folder-tree format before writing PRD
  await ensureLegacyPrdMigrated(dir);

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  const newParentId = flags.parent || undefined;

  // Validate before mutating
  const validation = validateMove(doc.items, id, newParentId);
  if (!validation.valid) {
    throw new CLIError(validation.error!, validation.suggestion);
  }

  // Perform the move
  const moveResult = moveItem(doc.items, id, newParentId);

  // Persist the modified tree
  await store.saveDocument(doc);

  // Log the move
  const fromLabel = moveResult.previousParentId ?? "root";
  const toLabel = moveResult.newParentId ?? "root";
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "item_moved",
    itemId: id,
    detail: `Moved ${moveResult.item.level} "${moveResult.item.title}" from ${fromLabel} to ${toLabel}`,
  });

  await syncFolderTree(rexDir, store);

  if (flags.format === "json") {
    result(JSON.stringify({
      id,
      title: moveResult.item.title,
      level: moveResult.item.level,
      previousParentId: moveResult.previousParentId,
      newParentId: moveResult.newParentId,
    }, null, 2));
  } else {
    result(`Moved ${moveResult.item.level}: ${moveResult.item.title}`);
    info(`  From: ${fromLabel}`);
    info(`  To:   ${toLabel}`);
  }
}
