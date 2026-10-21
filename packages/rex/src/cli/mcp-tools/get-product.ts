/**
 * `get_product`: the v2 product layer. By default a summary, one row of counts
 * per area, because the whole map of a large tree exceeds what an MCP client
 * accepts; `area` returns one area's capabilities and constraints, `full` the
 * whole map.
 */

import { z } from "zod";
import { ProductReportError, productAreaReport, productReport, productSummary } from "../../core/product-report.js";
import { loadPrdModel, prdLayout } from "../../store/prd-model-reader.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

/** Refusal for a product-layer tool called on a v1 tree, which has no product layer. */
export const NO_PRODUCT_LAYER = "This PRD uses the v1 layout (.rex/prd_tree/), which has no product layer.";

/** How a summary answer says where the capabilities and constraints are. */
export const PRODUCT_SUMMARY_NEXT =
  "Pass area (an id or display id from areas) for its capabilities and constraints, or full: true for the whole map. get_capability gives one node's detail.";

export interface GetProductArgs {
  /** One area (id, display id or alias): its capabilities and constraints with status and health. */
  area?: string;
  /** The whole map. Ignored when `area` is set. */
  full?: boolean;
}

export async function handleGetProduct(rexDir: string, args: GetProductArgs = {}): Promise<McpResult> {
  try {
    if ((await prdLayout(rexDir)) !== "v2") return textResult(`${NO_PRODUCT_LAYER} Use get_prd_status.`, true);
    const { title, tree } = await loadPrdModel(rexDir);
    if (args.area !== undefined) return textResult(JSON.stringify({ title, area: productAreaReport(tree, args.area) }, null, 2));
    if (args.full) return textResult(JSON.stringify({ title, areas: productReport(tree) }, null, 2));
    return textResult(JSON.stringify({ title, areas: productSummary(tree), next: PRODUCT_SUMMARY_NEXT }, null, 2));
  } catch (err) {
    if (err instanceof ProductReportError) return textResult(err.message, true);
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const getProductTool = defineTool({
  name: "get_product",
  description:
    "Get the product layer of a v2 PRD. By default a summary: each area with its counts of capabilities and constraints by computed status " +
    "(proposed, changing, met, revised, retired), defective nodes and open changes. Pass area for that area's capabilities and constraints, " +
    "each with its statement, status and health (ok, defective); full: true returns every area that way, which can exceed the client's limit " +
    "on a large tree. Use get_capability for one node's detail.",
  schema: {
    area: z.string().optional().describe("Area id, display id (e.g. A1) or alias: return its capabilities and constraints"),
    full: z.boolean().optional().describe("Return the whole map, every area's capabilities and constraints. Ignored when area is set"),
  },
  access: "read",
  run: (ws, args) => handleGetProduct(ws.rexDir, args),
});
