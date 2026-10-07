import { z } from "zod";
import { findItem } from "../../core/tree.js";
import { computeFacetDistribution, suggestFacets, getItemFacets } from "../../core/facets.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleFacets(
  store: PRDStore,
  args: { itemId?: string },
): Promise<McpResult> {
  try {
    const config = await store.loadConfig();
    const facetConfig = config.facets ?? {};
    const doc = await store.loadDocument();

    if (args.itemId) {
      // Suggest facets for a specific item
      const entry = findItem(doc.items, args.itemId);
      if (!entry) {
        return textResult(`Item "${args.itemId}" not found.`, true);
      }
      const parent = entry.parents.length > 0 ? entry.parents[entry.parents.length - 1] : undefined;
      const currentFacets = getItemFacets(entry.item);
      const suggestions = Object.keys(facetConfig).length > 0
        ? suggestFacets(entry.item, facetConfig, parent)
        : [];
      return textResult(JSON.stringify({ itemId: args.itemId, currentFacets, suggestions }, null, 2));
    }

    // List configured facets + distribution
    const distribution = Object.keys(facetConfig).length > 0
      ? computeFacetDistribution(doc.items, facetConfig)
      : {};
    return textResult(JSON.stringify({ facets: facetConfig, distribution }, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const facetsTool = defineTool({
  name: "facets",
  description: "List configured facets with distribution, or suggest facets for an item",
  schema: {
    itemId: z.string().optional().describe("Item ID to get facet suggestions for (omit for overview)"),
  },
  access: "read",
  run: (ws, args) => handleFacets(ws.store, args),
});
