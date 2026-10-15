import { computeHealthScore } from "../../core/health.js";
import type { PRDStore } from "../../store/index.js";
import { prdLayout } from "../../store/prd-model-reader.js";
import { computeV2Health } from "../v2-health.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

/**
 * The v1 score, unchanged. On a v2 tree it keeps every field and adds `v2`:
 * the tree rules, reader warnings and landing check `rex health` shows.
 */
export async function handleHealth(store: PRDStore, projectDir: string, rexDir: string): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const health = computeHealthScore(doc.items);
    const body = (await prdLayout(rexDir)) === "v2"
      ? { ...health, v2: await computeV2Health(projectDir, rexDir, store) }
      : health;
    return textResult(JSON.stringify(body, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const healthTool = defineTool({
  name: "health",
  description: "Get structure health score with dimensional breakdown (depth, balance, granularity, completeness, staleness)",
  schema: {},
  access: "read",
  run: (ws) => handleHealth(ws.store, ws.projectDir, ws.rexDir),
});
