/** `get_product`: the v2 product layer, areas → capabilities and constraints, with computed status and health. */

import { productReport } from "../../core/product-report.js";
import { loadPrdModel, prdLayout } from "../../store/prd-model-reader.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

/** Refusal for a product-layer tool called on a v1 tree, which has no product layer. */
export const NO_PRODUCT_LAYER = "This PRD uses the v1 layout (.rex/prd_tree/), which has no product layer.";

export async function handleGetProduct(rexDir: string): Promise<McpResult> {
  try {
    if ((await prdLayout(rexDir)) !== "v2") return textResult(`${NO_PRODUCT_LAYER} Use get_prd_status.`, true);
    const model = await loadPrdModel(rexDir);
    return textResult(JSON.stringify({ title: model.title, areas: productReport(model.tree) }, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const getProductTool = defineTool({
  name: "get_product",
  description:
    "Get the product layer of a v2 PRD: areas, and the capabilities and constraints under them, each with its computed status " +
    "(proposed, changing, met, revised, retired) and health (ok, defective). Use get_capability for one node's detail.",
  schema: {},
  access: "read",
  run: (ws) => handleGetProduct(ws.rexDir),
});
