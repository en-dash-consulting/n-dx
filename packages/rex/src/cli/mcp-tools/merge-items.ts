import { z } from "zod";
import { validateMerge, previewMerge, mergeItems } from "../../core/merge.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleMergeItems(
  store: PRDStore,
  rexDir: string,
  args: {
    sourceIds: string[];
    targetId: string;
    preview?: boolean;
    title?: string;
    description?: string;
  },
): Promise<McpResult> {
  try {
    const { sourceIds, targetId, preview, title, description } = args;

    const options = {
      ...(title ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
    };

    if (preview) {
      const doc = await store.loadDocument();
      const validation = validateMerge(doc.items, sourceIds, targetId);
      if (!validation.valid) {
        return textResult(`${validation.error}`, true);
      }
      const previewResult = previewMerge(doc.items, sourceIds, targetId, options);
      return textResult(JSON.stringify(previewResult, null, 2));
    }

    // Validate and merge inside one transaction so the lock covers the whole
    // read-modify-write — a concurrent writer's item survives this save.
    const outcome = await store.withTransaction(async (doc) => {
      const validation = validateMerge(doc.items, sourceIds, targetId);
      if (!validation.valid) {
        return { ok: false as const, message: `${validation.error}` };
      }
      return { ok: true as const, result: mergeItems(doc.items, sourceIds, targetId, options) };
    });
    if (!outcome.ok) {
      return textResult(outcome.message, true);
    }
    const result = outcome.result;

    const absorbedTitles = result.absorbedIds
      .map((id) => `"${id}"`)
      .join(", ");
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "items_merged",
      itemId: targetId,
      detail: `Merged ${sourceIds.length} items into "${targetId}". Absorbed: ${absorbedTitles}. ${result.reparentedChildIds.length} children reparented, ${result.rewrittenDependencyCount} dependency references rewritten.`,
    });

    return textResult(JSON.stringify(result, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const mergeItemsTool = defineTool({
  name: "merge_items",
  description: "Consolidate multiple sibling items into one, combining descriptions, acceptance criteria, and tags. Use when duplicate or overlapping items are found.",
  schema: {
    sourceIds: z.array(z.string()).describe("IDs of items to merge (must be siblings at the same level)"),
    targetId: z.string().describe("ID of the item that survives (must be in sourceIds)"),
    preview: z.boolean().optional().describe("If true, return a preview without executing the merge"),
    title: z.string().optional().describe("New title for the merged item (default: keep target's title)"),
    description: z.string().optional().describe("New description (default: combine all descriptions)"),
  },
  // A preview reads the tree and writes nothing, so it is still served while
  // the client's root is refused for writes.
  access: (args) => (args.preview ? "read" : "write"),
  run: (ws, args) => handleMergeItems(ws.store, ws.rexDir, args),
});
