import { z } from "zod";
import { validateMove, moveItem, levelParentRule, changeLayerParentRule } from "../../core/move.js";
import { changeLayerType } from "../../core/layer-projection.js";
import { isChangeLayerStore, type PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

/**
 * On a v2 tree the parents follow the node types (a task moves between
 * changes; a change never goes under a task), and the answer adds `type`.
 */
export async function handleMoveItem(
  store: PRDStore,
  rexDir: string,
  args: { id: string; parentId?: string },
): Promise<McpResult> {
  try {
    const { id, parentId } = args;
    const rule = isChangeLayerStore(store) ? changeLayerParentRule : levelParentRule;

    // Validate and move inside one transaction so the lock covers the whole
    // read-modify-write — a concurrent writer's item survives this save.
    const outcome = await store.withTransaction(async (doc) => {
      const validation = validateMove(doc.items, id, parentId, rule);
      if (!validation.valid) {
        return {
          ok: false as const,
          message: `${validation.error}${validation.suggestion ? ` ${validation.suggestion}` : ""}`,
        };
      }
      return { ok: true as const, result: moveItem(doc.items, id, parentId, rule) };
    });
    if (!outcome.ok) {
      return textResult(outcome.message, true);
    }
    const result = outcome.result;

    const fromLabel = result.previousParentId ?? "root";
    const toLabel = result.newParentId ?? "root";
    const type = rule === changeLayerParentRule ? changeLayerType(result.item) : undefined;
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "item_moved",
      itemId: id,
      detail: `Moved ${type ?? result.item.level} "${result.item.title}" from ${fromLabel} to ${toLabel}`,
    });

    return textResult(
      JSON.stringify({
        id,
        title: result.item.title,
        level: result.item.level,
        ...(type ? { type } : {}),
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
