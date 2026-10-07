import { computeHealthScore } from "../../core/health.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleHealth(store: PRDStore): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const health = computeHealthScore(doc.items);
    return textResult(JSON.stringify(health, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const healthTool = defineTool({
  name: "health",
  description: "Get structure health score with dimensional breakdown (depth, balance, granularity, completeness, staleness)",
  schema: {},
  access: "read",
  run: (ws) => handleHealth(ws.store),
});
