import { z } from "zod";
import { validateMove, moveItem } from "../../core/move.js";
import { syncFolderTree } from "../commands/folder-tree-sync.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleMoveItem(
  store: PRDStore,
  rexDir: string,
  args: { id: string; parentId?: string },
): Promise<McpResult> {
  try {
    const { id, parentId } = args;

    // Validate and move inside one transaction so the lock covers the whole
    // read-modify-write — a concurrent writer's item survives this save.
    const outcome = await store.withTransaction(async (doc) => {
      const validation = validateMove(doc.items, id, parentId);
      if (!validation.valid) {
        return {
          ok: false as const,
          message: `${validation.error}${validation.suggestion ? ` ${validation.suggestion}` : ""}`,
        };
      }
      return { ok: true as const, result: moveItem(doc.items, id, parentId) };
    });
    if (!outcome.ok) {
      return textResult(outcome.message, true);
    }
    const result = outcome.result;

    const fromLabel = result.previousParentId ?? "root";
    const toLabel = result.newParentId ?? "root";
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "item_moved",
      itemId: id,
      detail: `Moved ${result.item.level} "${result.item.title}" from ${fromLabel} to ${toLabel}`,
    });

    await syncFolderTree(rexDir, store);

    return textResult(
      JSON.stringify({
        id,
        title: result.item.title,
        level: result.item.level,
        previousParentId: result.previousParentId,
        newParentId: result.newParentId,
      }),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const moveItemTool = defineTool({
  name: "move_item",
  description: "Move an item to a different parent in the PRD tree (reparent). Use to reorganize items that are under the wrong epic or feature.",
  schema: {
    id: z.string().describe("Item ID to move"),
    parentId: z.string().optional().describe("New parent ID (omit to move to root)"),
  },
  access: "write",
  run: (ws, args) => handleMoveItem(ws.store, ws.rexDir, args),
});
