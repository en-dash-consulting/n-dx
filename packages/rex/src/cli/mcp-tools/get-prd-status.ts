/**
 * `get_prd_status`, dispatched on the PRD layout.
 *
 * - **v1**: title, overall stats and per-epic stats.
 * - **v2**: title, change counts, the Inbox count, product status per area
 *   and change counts per release (`core/product-report.ts`).
 */

import { computeStats } from "../../core/stats.js";
import { prdStatusReport } from "../../core/product-report.js";
import { loadPrdModel, prdLayout } from "../../store/prd-model-reader.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleGetPrdStatus(store: PRDStore, rexDir: string): Promise<McpResult> {
  try {
    if ((await prdLayout(rexDir)) === "v2") {
      const model = await loadPrdModel(rexDir);
      return textResult(JSON.stringify({ title: model.title, layout: "v2", ...prdStatusReport(model.tree) }, null, 2));
    }
    const doc = await store.loadDocument();
    const overall = computeStats(doc.items);
    const epics = doc.items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      branch: item.branch ?? null,
      sourceFile: item.sourceFile ?? null,
      stats: item.children ? computeStats(item.children) : null,
    }));
    return textResult(JSON.stringify({ title: doc.title, overall, epics }, null, 2));
  } catch (err) {
    return textResult(`Error loading PRD: ${(err as Error).message}. Run "rex init" first.`, true);
  }
}

export const getPrdStatusTool = defineTool({
  name: "get_prd_status",
  description:
    "Get PRD title, overall stats, and per-epic stats. Use to understand project scope and progress. " +
    "On a v2 PRD: change counts, the Inbox count, product status per area and change counts per release.",
  schema: {},
  access: "read",
  run: (ws) => handleGetPrdStatus(ws.store, ws.rexDir),
});
