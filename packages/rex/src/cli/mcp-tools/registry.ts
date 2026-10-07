/**
 * The rex MCP tool surface, in registration order.
 *
 * `mcp.ts` registers exactly this list and holds no per-tool knowledge, so
 * adding or changing a tool touches that tool's module and one line here.
 *
 * **Order is part of the contract.** The SDK returns tools from `tools/list`
 * in the order they were registered, and
 * `tests/unit/cli/mcp-tools-list-snapshot.test.ts` pins the whole response.
 * Reordering this array is a visible change to every client.
 */

import { getPrdStatusTool } from "./get-prd-status.js";
import { getNextTaskTool } from "./get-next-task.js";
import { updateTaskStatusTool } from "./update-task-status.js";
import { claimTaskTool } from "./claim-task.js";
import { releaseTaskTool } from "./release-task.js";
import { addItemTool } from "./add-item.js";
import { editItemTool } from "./edit-item.js";
import { moveItemTool } from "./move-item.js";
import { mergeItemsTool } from "./merge-items.js";
import { getItemTool } from "./get-item.js";
import { appendLogTool } from "./append-log.js";
import { getRecommendationsTool } from "./get-recommendations.js";
import { verifyCriteriaTool } from "./verify-criteria.js";
import { reorganizeTool } from "./reorganize.js";
import { healthTool } from "./health.js";
import { facetsTool } from "./facets.js";
import { getTokenUsageTool } from "./get-token-usage.js";
import { getCapabilitiesTool } from "./get-capabilities.js";
import type { ToolDefinition } from "./tool.js";

export const REX_MCP_TOOLS: readonly ToolDefinition[] = [
  getPrdStatusTool,
  getNextTaskTool,
  updateTaskStatusTool,
  claimTaskTool,
  releaseTaskTool,
  addItemTool,
  editItemTool,
  moveItemTool,
  mergeItemsTool,
  getItemTool,
  appendLogTool,
  getRecommendationsTool,
  verifyCriteriaTool,
  reorganizeTool,
  healthTool,
  facetsTool,
  getTokenUsageTool,
  getCapabilitiesTool,
];
