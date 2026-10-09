/**
 * `place_change`: rank where a v2 change belongs on the product layer, or
 * record the placement chosen.
 *
 * Without `target` it reads: the rules' shortlist and relation. With `target`
 * it writes the change's `touches` or a `modified` amendment and clears
 * `needsPlacement` (`core/change-place.ts`).
 */

import { z } from "zod";
import { ChangePlacementError, recordPlacement, suggestPlacement } from "../../core/change-place.js";
import { loadPrdModel, prdLayout } from "../../store/prd-model-reader.js";
import { withPrdModelTransaction } from "../../store/prd-model-transaction.js";
import type { PRDStore } from "../../store/index.js";
import { NO_PRODUCT_LAYER } from "./get-product.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export interface PlaceChangeArgs {
  id: string;
  target?: string;
  relation?: "touches" | "amends";
  summary?: string;
}

export async function handlePlaceChange(store: PRDStore, rexDir: string, args: PlaceChangeArgs): Promise<McpResult> {
  try {
    if ((await prdLayout(rexDir)) !== "v2") return textResult(`${NO_PRODUCT_LAYER} Changes are placed on a v2 PRD only.`, true);
    if (args.target === undefined) {
      if (args.relation !== undefined || args.summary !== undefined) {
        return textResult("relation and summary record a placement: pass target with them, or leave all three out for the shortlist.", true);
      }
      const { tree } = await loadPrdModel(rexDir);
      return textResult(JSON.stringify(suggestPlacement(tree, args.id), null, 2));
    }
    const target = args.target;
    const now = new Date();
    const { result } = await withPrdModelTransaction(rexDir, (model) => {
      const placed = recordPlacement(model.tree, args.id, { target, relation: args.relation, summary: args.summary }, now);
      return { tree: placed.tree, result: placed };
    });
    const { change, placement } = result;
    await store.appendLog({
      timestamp: now.toISOString(),
      event: "change_placed",
      itemId: change,
      detail: `${placement.relation} ${placement.target}`,
    });
    return textResult(JSON.stringify({ change, ...placement }));
  } catch (err) {
    if (err instanceof ChangePlacementError) return textResult(err.message, true);
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const placeChangeTool = defineTool({
  name: "place_change",
  description:
    "Place a v2 change on the product layer. Without target: returns the rules' shortlist of capabilities and constraints the change " +
    "could amend or touch, best first, and the relation the rules chose. With target: records it (touches joins the change's touches; " +
    "amends adds a modified amendment) and clears needsPlacement. Only an open change is placed.",
  schema: {
    id: z.string().describe("Change id, display id (e.g. CH-12) or alias"),
    target: z.string().optional().describe("Capability or constraint to place the change on. Omit to get the shortlist without writing"),
    relation: z.enum(["touches", "amends"]).optional().describe("With target: touches (works on it) or amends (edits its requirements). Default: the rules' relation"),
    summary: z.string().optional().describe("With target and relation amends: the amendment's summary. Default: the change's title"),
  },
  access: (args) => (args.target === undefined ? "read" : "write"),
  run: (ws, args) => handlePlaceChange(ws.store, ws.rexDir, args),
});
