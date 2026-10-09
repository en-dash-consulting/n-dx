/** `get_capability`: one v2 capability or constraint with its status and the changes and constraints related to it. */

import { z } from "zod";
import { capabilityReport, ProductReportError } from "../../core/product-report.js";
import { loadPrdModel, prdLayout } from "../../store/prd-model-reader.js";
import { NO_PRODUCT_LAYER } from "./get-product.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleGetCapability(rexDir: string, args: { id: string }): Promise<McpResult> {
  try {
    if ((await prdLayout(rexDir)) !== "v2") return textResult(`${NO_PRODUCT_LAYER} Use get_item.`, true);
    const { tree } = await loadPrdModel(rexDir);
    return textResult(JSON.stringify(capabilityReport(tree, args.id), null, 2));
  } catch (err) {
    if (err instanceof ProductReportError) return textResult(err.message, true);
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const getCapabilityTool = defineTool({
  name: "get_capability",
  description:
    "Get one capability or constraint of a v2 PRD: its statement, capability criteria and requirements, parent chain, computed status " +
    "and health, the changes that amend or touch it, the constraints that bind it, and the nodes changed alongside it.",
  schema: {
    id: z.string().describe("Capability or constraint id, display id (e.g. A1.2) or alias"),
  },
  access: "read",
  run: (ws, args) => handleGetCapability(ws.rexDir, args),
});
