import { computeStats } from "../../core/stats.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleGetPrdStatus(store: PRDStore): Promise<McpResult> {
  try {
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
  description: "Get PRD title, overall stats, and per-epic stats. Use to understand project scope and progress.",
  schema: {},
  access: "read",
  run: (ws) => handleGetPrdStatus(ws.store),
});
