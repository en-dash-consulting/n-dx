import { z } from "zod";
import { resolveItem } from "../../core/tree.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleGetItem(
  store: PRDStore,
  args: { id: string },
): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const entry = resolveItem(doc.items, args.id);
    if (!entry) {
      return textResult(`Item "${args.id}" not found. Use get_prd_status to see available items.`, true);
    }
    return textResult(
      JSON.stringify(
        {
          item: entry.item,
          parentChain: entry.parents.map((p) => ({
            id: p.id,
            title: p.title,
            level: p.level,
          })),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const getItemTool = defineTool({
  name: "get_item",
  description: "Get full details of a PRD item including parent chain. Use to understand task context before starting work.",
  schema: {
    id: z.string().describe("Item ID"),
  },
  access: "read",
  run: (ws, args) => handleGetItem(ws.store, args),
});
