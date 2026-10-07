/**
 * Rex MCP tools.
 *
 * One module per tool, each owning its name, description, input schema and
 * handler; `registry.ts` lists them in registration order and `mcp.ts`
 * registers whatever it lists.
 *
 * This barrel exists for consumers that want a handler directly rather than
 * through the server — `rex next` reads the claim helpers, `public.ts`
 * re-exports `handleEditItem`, and the tests drive handlers in-process.
 */

export { REX_MCP_TOOLS } from "./registry.js";
export { defineTool, type Access, type ToolDefinition } from "./tool.js";
export { textResult, type McpResult } from "./result.js";
export {
  collectForeignClaims,
  acquireClaim,
  describeHeldClaim,
  CLAIM_RELEASING_STATUSES,
  type ClaimsContext,
  type SkippedClaim,
} from "./claims.js";

export { handleGetPrdStatus } from "./get-prd-status.js";
export { handleGetNextTask } from "./get-next-task.js";
export { handleUpdateTaskStatus } from "./update-task-status.js";
export { handleClaimTask } from "./claim-task.js";
export { handleReleaseTask } from "./release-task.js";
export { handleAddItem } from "./add-item.js";
export { handleEditItem } from "./edit-item.js";
export { handleMoveItem } from "./move-item.js";
export { handleMergeItems } from "./merge-items.js";
export { handleGetItem } from "./get-item.js";
export { handleAppendLog } from "./append-log.js";
export { handleGetRecommendations } from "./get-recommendations.js";
export { handleVerifyCriteria } from "./verify-criteria.js";
export { handleReorganize } from "./reorganize.js";
export { handleHealth } from "./health.js";
export { handleFacets } from "./facets.js";
export { handleGetTokenUsage } from "./get-token-usage.js";
export { handleGetCapabilities, type WorkspaceInfo } from "./get-capabilities.js";
