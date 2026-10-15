import { computeHealthScore } from "../../core/health.js";
import { isChangeLayerStore, type PRDStore } from "../../store/index.js";
import type { StructureHealthThresholds } from "../../schema/index.js";
import { computeV2Health } from "../commands/health.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

/**
 * The configured thresholds, or the defaults (undefined) when the project has
 * no .rex/config.json. The CLI refuses such a project; the MCP tool returns
 * its score, so a missing file must not turn into an error here.
 */
async function loadStructureHealth(store: PRDStore): Promise<StructureHealthThresholds | undefined> {
  try {
    return (await store.loadConfig()).structureHealth;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * The v1 score, unchanged. On a v2 tree it keeps every field and adds `v2`:
 * the tree rules, reader warnings and landing check `rex health` shows.
 */
export async function handleHealth(store: PRDStore, projectDir: string, rexDir: string): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const health = computeHealthScore(doc.items);
    const body = isChangeLayerStore(store)
      ? { ...health, v2: await computeV2Health(projectDir, rexDir, await loadStructureHealth(store)) }
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
