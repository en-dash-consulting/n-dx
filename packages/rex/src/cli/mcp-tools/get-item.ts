import { z } from "zod";
import { resolveItem } from "../../core/tree.js";
import { loadPrdModel, prdLayout } from "../../store/prd-model-reader.js";
import { indexTree } from "../../schema/v2-rules.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

const notFound = (id: string): McpResult => textResult(`Item "${id}" not found. Use get_prd_status to see available items.`, true);

export async function handleGetItem(
  store: PRDStore,
  rexDir: string,
  args: { id: string },
): Promise<McpResult> {
  try {
    if ((await prdLayout(rexDir)) === "v2") return await getV2Item(rexDir, args.id);
    const doc = await store.loadDocument();
    const entry = resolveItem(doc.items, args.id);
    if (!entry) return notFound(args.id);
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

/** A v2 node by id, display id or alias, with its ancestors as `{ id, title, type }`. */
async function getV2Item(rexDir: string, ref: string): Promise<McpResult> {
  const { tree } = await loadPrdModel(rexDir);
  const { entries, resolve } = indexTree(tree);
  const item = resolve(ref);
  if (!item) return notFound(ref);
  const parentOf = new Map(entries.map((e) => [e.node, e.parent]));
  const parentChain = [];
  for (let p = parentOf.get(item); p; p = parentOf.get(p)) parentChain.unshift({ id: p.id, title: p.title, type: p.type });
  return textResult(JSON.stringify({ item, parentChain }, null, 2));
}

export const getItemTool = defineTool({
  name: "get_item",
  description: "Get full details of a PRD item including parent chain. Use to understand task context before starting work.",
  schema: {
    id: z.string().describe("Item ID"),
  },
  access: "read",
  run: (ws, args) => handleGetItem(ws.store, ws.rexDir, args),
});
