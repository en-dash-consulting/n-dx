import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "node:path";
import { resolveStore, resolveRemoteStore, SyncEngine, ensureLegacyPrdMigrated } from "../store/index.js";
import { REX_DIR, TOOL_VERSION } from "./commands/constants.js";
import { getAllLevels } from "../schema/index.js";
import { formatMigrationBanner, getMigrationMcpWarning } from "./migration-notification.js";
import {
  handleGetPrdStatus,
  handleGetNextTask,
  handleUpdateTaskStatus,
  handleAddItem,
  handleMoveItem,
  handleMergeItems,
  handleGetItem,
  handleAppendLog,
  handleSyncWithRemote,
  handleGetRecommendations,
  handleVerifyCriteria,
  handleGetCapabilities,
  handleReorganize,
  handleHealth,
  handleFacets,
  handleEditItem,
  handleGetTokenUsage,
} from "./mcp-tools.js";

/**
 * Create a configured Rex MCP server without connecting a transport.
 *
 * Returns the McpServer instance with all tools and resources registered.
 * The caller is responsible for connecting a transport (stdio, HTTP, etc.):
 *
 * ```ts
 * // Stdio (CLI usage)
 * const server = await createRexMcpServer(dir);
 * await server.connect(new StdioServerTransport());
 *
 * // HTTP (web server usage)
 * const server = await createRexMcpServer(dir);
 * const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
 * await server.connect(transport);
 * ```
 */
export async function createRexMcpServer(dir: string): Promise<McpServer> {
  const rexDir = join(dir, REX_DIR);

  // Ensure legacy .rex/prd.json is migrated to folder-tree format before any PRD operations
  const migrationResult = await ensureLegacyPrdMigrated(dir);
  if (migrationResult.migrated) {
    const banner = formatMigrationBanner(
      migrationResult.backupPath ?? "(unknown)",
      migrationResult.itemCount ?? 0,
    );
    console.error(banner);
  }

  const store = await resolveStore(rexDir);

  const server = new McpServer({
    name: "rex",
    version: TOOL_VERSION,
  });

  // Store migration warning for first tool call injection
  const migrationWarning = migrationResult.migrated
    ? getMigrationMcpWarning(migrationResult)
    : undefined;
  let migrationWarningEmitted = false;

  // Helper to inject migration warning into first tool call
  const withMigrationWarning = <T extends any[], R extends { warning?: string }>(
    handler: (...args: T) => Promise<R>,
  ): ((...args: T) => Promise<R>) => {
    return async (...args: T): Promise<R> => {
      const result = await handler(...args);
      if (migrationWarning && !migrationWarningEmitted) {
        migrationWarningEmitted = true;
        result.warning = migrationWarning;
      }
      return result;
    };
  };

  // --- Tools ---

  server.tool("get_prd_status", "Get PRD title, overall stats, and per-epic stats. Use to understand project scope and progress.", {},
    withMigrationWarning(() => handleGetPrdStatus(store)));

  server.tool(
    "get_next_task",
    "Get the next actionable task based on priority and dependencies, with explanation of why it was selected. Use when the user asks what to work on next.",
    {
      tags: z.array(z.string()).optional().describe("Only return tasks that have at least one of these tags. Omit to return any task regardless of tags."),
    },
    withMigrationWarning((args) => handleGetNextTask(store, args)),
  );

  server.tool(
    "update_task_status",
    "Update the status of a PRD item. Use when starting work (in_progress), finishing (completed), or encountering blockers.",
    {
      id: z.string().describe("Item ID"),
      status: z.enum(["pending", "in_progress", "completed", "failing", "deferred", "blocked", "deleted"]).describe("New status"),
      force: z.boolean().optional().describe("Force the transition even if it violates transition rules (e.g. completed → pending)"),
      reason: z.string().optional().describe("Failure reason (used when status is 'failing')"),
      resolutionType: z.enum(["code-change", "config-override", "acknowledgment", "deferred", "unclassified"]).optional().describe("How the task was resolved (required when status is 'completed')"),
      resolutionDetail: z.string().optional().describe("Brief description of how the resolution was achieved"),
    },
    withMigrationWarning((args) => handleUpdateTaskStatus(store, dir, args)),
  );

  server.tool(
    "add_item",
    "Add a new item to the PRD. Use when the user discusses a new feature, requirement, or work item that should be tracked.",
    {
      title: z.string().describe("Item title"),
      level: z.enum(getAllLevels() as [string, ...string[]]).describe("Item level"),
      parentId: z.string().optional().describe("Parent item ID"),
      description: z.string().optional().describe("Item description"),
      priority: z.enum(["critical", "high", "medium", "low"]).optional().describe("Priority"),
      acceptanceCriteria: z.array(z.string()).optional().describe("Acceptance criteria"),
      tags: z.array(z.string()).optional().describe("Tags"),
      source: z.string().optional().describe("Source of this item"),
      blockedBy: z.array(z.string()).optional().describe("IDs of blocking items"),
    },
    withMigrationWarning((args) => handleAddItem(store, dir, rexDir, args)),
  );

  server.tool(
    "edit_item",
    "Edit content fields of a PRD item (title, description, acceptance criteria, priority, level, tags). Use for content changes — use update_task_status for status/lifecycle transitions.",
    {
      id: z.string().describe("Item ID"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      acceptanceCriteria: z.array(z.string()).optional().describe("New acceptance criteria"),
      priority: z.enum(["critical", "high", "medium", "low"]).optional().describe("New priority"),
      level: z.enum(["epic", "feature", "task", "subtask"]).optional().describe("New level (epic, feature, task, subtask)"),
      tags: z.array(z.string()).optional().describe("New tags"),
      source: z.string().optional().describe("New source"),
      blockedBy: z.array(z.string()).optional().describe("New blocked-by IDs"),
    },
    withMigrationWarning((args) => handleEditItem(store, dir, args)),
  );

  server.tool(
    "move_item",
    "Move an item to a different parent in the PRD tree (reparent). Use to reorganize items that are under the wrong epic or feature.",
    {
      id: z.string().describe("Item ID to move"),
      parentId: z.string().optional().describe("New parent ID (omit to move to root)"),
    },
    withMigrationWarning((args) => handleMoveItem(store, rexDir, args)),
  );

  server.tool(
    "merge_items",
    "Consolidate multiple sibling items into one, combining descriptions, acceptance criteria, and tags. Use when duplicate or overlapping items are found.",
    {
      sourceIds: z.array(z.string()).describe("IDs of items to merge (must be siblings at the same level)"),
      targetId: z.string().describe("ID of the item that survives (must be in sourceIds)"),
      preview: z.boolean().optional().describe("If true, return a preview without executing the merge"),
      title: z.string().optional().describe("New title for the merged item (default: keep target's title)"),
      description: z.string().optional().describe("New description (default: combine all descriptions)"),
    },
    withMigrationWarning((args) => handleMergeItems(store, rexDir, args)),
  );

  server.tool(
    "get_item",
    "Get full details of a PRD item including parent chain. Use to understand task context before starting work.",
    {
      id: z.string().describe("Item ID"),
    },
    withMigrationWarning((args) => handleGetItem(store, args)),
  );

  server.tool(
    "append_log",
    "Append a structured log entry to the execution log",
    {
      event: z.string().describe("Event name"),
      itemId: z.string().optional().describe("Related item ID"),
      detail: z.string().optional().describe("Event details"),
    },
    withMigrationWarning((args) => handleAppendLog(store, args)),
  );

  server.tool(
    "sync_with_remote",
    "Sync local PRD with a remote adapter (e.g. Notion)",
    {
      direction: z.enum(["push", "pull", "sync"]).optional().describe("Sync direction (default: sync)"),
      adapter: z.string().optional().describe("Adapter name (default: notion)"),
    },
    withMigrationWarning((args) => handleSyncWithRemote(store, rexDir, args, resolveRemoteStore, SyncEngine)),
  );

  server.tool("get_recommendations", "Get SourceVision-based recommendations for PRD items. Use alongside get_findings for data-driven planning.", {},
    withMigrationWarning(() => handleGetRecommendations()));

  server.tool(
    "verify_criteria",
    "Map acceptance criteria to test files and optionally run tests to verify them",
    {
      taskId: z.string().optional().describe("Task ID to verify (omit for all tasks)"),
      runTests: z.boolean().optional().describe("Whether to execute tests (default: true)"),
    },
    withMigrationWarning((args) => handleVerifyCriteria(store, dir, args)),
  );

  server.tool(
    "reorganize",
    "Detect structural issues in the PRD and propose reorganizations (merge, move, delete, prune, collapse, split). Runs both programmatic detectors and LLM analysis by default.",
    {
      accept: z.string().optional().describe("Apply proposals: 'low-risk' (default when set), 'all', or comma-separated IDs like '1,3'"),
      includeCompleted: z.boolean().optional().describe("Include completed items in similarity analysis (default: false)"),
      mode: z.enum(["fast", "full"]).optional().describe("Analysis mode: 'fast' (programmatic only) or 'full' (programmatic + LLM, default)"),
    },
    withMigrationWarning((args) => handleReorganize(store, dir, args)),
  );

  server.tool("health", "Get structure health score with dimensional breakdown (depth, balance, granularity, completeness, staleness)", {},
    withMigrationWarning(() => handleHealth(store)));

  server.tool(
    "facets",
    "List configured facets with distribution, or suggest facets for an item",
    {
      itemId: z.string().optional().describe("Item ID to get facet suggestions for (omit for overview)"),
    },
    withMigrationWarning((args) => handleFacets(store, args)),
  );

  server.tool(
    "get_token_usage",
    "Roll up hench run token usage and work duration across every PRD item. Returns `{ tokens, duration }` per item, where tokens is self+descendants+total counts and duration is { totalMs, runningMs, isRunning }. Completed subtrees report stable totalMs; running subtrees update on each call. Orphan runs (whose itemId is no longer in the PRD) are reported separately. Pass `id` to narrow to a single item.",
    {
      id: z.string().optional().describe("Optional: only return rollup for this item"),
    },
    withMigrationWarning((args) => handleGetTokenUsage(store, dir, args)),
  );

  server.tool("get_capabilities", "Get Rex server capabilities and configuration", {},
    withMigrationWarning(() => handleGetCapabilities(store)));

  // --- Resources ---

  server.resource("prd", "rex://prd", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(await store.loadDocument(), null, 2),
      },
    ],
  }));

  server.resource("workflow", "rex://workflow", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: await store.loadWorkflow(),
      },
    ],
  }));

  server.resource("log", "rex://log", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(await store.readLog(50), null, 2),
      },
    ],
  }));

  return server;
}

/**
 * Start the Rex MCP server over stdio (for `rex mcp <dir>` CLI command).
 *
 * This is the original entry point preserved for backward compatibility.
 * For HTTP or other transports, use {@link createRexMcpServer} instead.
 */
export async function startMcpServer(dir: string): Promise<void> {
  const server = await createRexMcpServer(dir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
