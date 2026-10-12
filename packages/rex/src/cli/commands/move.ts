import { join } from "node:path";
import { resolveStore, isChangeLayerStore, ensureLegacyPrdMigrated, resolveRexPaths } from "../../store/index.js";
import { validateMove, moveItem, levelParentRule, changeLayerParentRule } from "../../core/move.js";

import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import { ensureSnapshot } from "../snapshot-guard.js";

export async function cmdMove(
  dir: string,
  id: string,
  flags: Record<string, string>,
): Promise<void> {
  // Ensure legacy .rex/prd.json is migrated to folder-tree format before writing PRD
  await ensureLegacyPrdMigrated(dir);

  const rexDir = resolveRexPaths(dir).rexDir;
  const store = await resolveStore(rexDir);

  // Snapshot the tree before any mutation so `rex restore` can undo this move.
  await ensureSnapshot(rexDir, "move", flags);
  const doc = await store.loadDocument();

  const newParentId = flags.parent || undefined;
  // A v2 tree has no levels: a change, task and subtask are told apart by type.
  const rule = isChangeLayerStore(store) ? changeLayerParentRule : levelParentRule;

  // Validate before mutating
  const validation = validateMove(doc.items, id, newParentId, rule);
  if (!validation.valid) {
    throw new CLIError(validation.error!, validation.suggestion);
  }

  // Perform the move
  const moveResult = moveItem(doc.items, id, newParentId, rule);

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
