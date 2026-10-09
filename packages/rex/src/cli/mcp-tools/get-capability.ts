/** `get_capability`: one v2 capability or constraint with its status and the changes and constraints related to it. */

import { z } from "zod";
import { capabilityReport, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, ProductReportError, RECENT_APPLIED, type ChangePageOptions } from "../../core/product-report.js";
import { loadPrdModel, prdLayout } from "../../store/prd-model-reader.js";
import { NO_PRODUCT_LAYER } from "./get-product.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleGetCapability(rexDir: string, args: { id: string } & ChangePageOptions): Promise<McpResult> {
  try {
    if ((await prdLayout(rexDir)) !== "v2") return textResult(`${NO_PRODUCT_LAYER} Use get_item.`, true);
    const { tree } = await loadPrdModel(rexDir);
    const { id, ...page } = args;
    return textResult(JSON.stringify(capabilityReport(tree, id, page), null, 2));
  } catch (err) {
    if (err instanceof ProductReportError) return textResult(err.message, true);
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const getCapabilityTool = defineTool({
  name: "get_capability",
  description:
    "Get one capability or constraint of a v2 PRD: its statement, capability criteria and requirements, parent chain, computed status " +
    "and health, one page of the changes that amend or touch it (changeCounts covers all), the constraints that bind it, and the nodes changed alongside it. " +
    `By default the changes are every open one plus the ${RECENT_APPLIED} most recently applied; use status, since and cursor (changesPage.nextCursor) to read more.`,
  schema: {
    id: z.string().describe("Capability or constraint id, display id (e.g. A1.2) or alias"),
    status: z
      .enum(["recent", "open", "applied", "all"])
      .optional()
      .describe("Which changes to list. Default recent: open plus the latest applied. all pages through the whole history"),
    since: z.string().optional().describe("Only changes released (shippedIn, else plannedRelease) in this version or later, e.g. 1.2.0"),
    cursor: z.string().optional().describe("changesPage.nextCursor from the previous call, with the same status and since"),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe(`Changes per page (default ${DEFAULT_PAGE_SIZE})`),
  },
  access: "read",
  run: (ws, args) => handleGetCapability(ws.rexDir, args),
});
