import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { resolve } from "node:path";
import { resolveRemoteStore, SyncEngine } from "../store/index.js";
import { TOOL_VERSION } from "./commands/constants.js";
import { getAllLevels } from "../schema/index.js";
import { RunSettingsSchema } from "../schema/validate.js";
import { openRexWorkspace, WorkspaceBinding, type RexWorkspace } from "./mcp-workspace.js";
import {
  handleGetPrdStatus,
  handleGetNextTask,
  handleUpdateTaskStatus,
  handleClaimTask,
  handleReleaseTask,
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
export interface CreateRexMcpServerOptions {
  /**
   * Follow the client's MCP roots (#499). Only the stdio entry point sets it,
   * and it takes effect only when `dir` is the process cwd — the implicit `.`
   * of a tracked `.mcp.json`. An explicit directory, and the web/hub factory,
   * keep the dir they were given.
   */
  resolveWorkspaceFromClientRoots?: boolean;
}

/** A tool result as the handlers in mcp-tools.ts build it. */
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  warning?: string;
};

/**
 * Whether a call writes the PRD or claims. Writes are refused while the
 * client's root cannot be served; reads answer from the startup dir.
 */
type Access = "read" | "write";

export async function createRexMcpServer(
  dir: string,
  options: CreateRexMcpServerOptions = {},
): Promise<McpServer> {
  const startup = await openRexWorkspace(dir, "startup", dir);
  const followRoots = options.resolveWorkspaceFromClientRoots === true && resolve(dir) === resolve(process.cwd());
  const binding = followRoots ? WorkspaceBinding.tracking(startup) : WorkspaceBinding.fixed(startup);

  const server = new McpServer({
    name: "rex",
    version: TOOL_VERSION,
  });

  if (followRoots) {
    const protocol = server.server;
    const resolveFromRoots = () =>
      binding.resolve(async (timeout) => (await protocol.listRoots(undefined, { timeout })).roots);
    // Roots exist only once the client has initialized.
    protocol.oninitialized = () => {
      if (protocol.getClientCapabilities()?.roots) void resolveFromRoots();
      else binding.settleWithoutRoots();
    };
    protocol.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      await resolveFromRoots();
    });
  }

  /**
   * Run a handler against the workspace current at call time — after any
   * in-flight roots resolution — refusing writes the client's root cannot
   * take, and attaching the one-time migration notice.
   */
  const withWorkspace = <T extends any[]>(
    access: Access | ((...args: T) => Access),
    handler: (ws: RexWorkspace, ...args: T) => Promise<ToolResult>,
  ): ((...args: T) => Promise<ToolResult>) => {
    return async (...args: T): Promise<ToolResult> => {
      const ws = await binding.ready();
      const kind = typeof access === "function" ? access(...args) : access;
      if (ws.refused && kind === "write") {
        return { content: [{ type: "text", text: `Error: ${ws.refused}` }], isError: true };
      }
      const result = await handler(ws, ...args);
      const warnings = [ws.refused, ws.migrationWarning].filter((w): w is string => Boolean(w));
      ws.migrationWarning = undefined;
      if (warnings.length > 0) result.warning = warnings.join("\n\n");
      return result;
    };
  };

  // --- Tools ---

  server.tool("get_prd_status", "Get PRD title, overall stats, and per-epic stats. Use to understand project scope and progress.", {},
    withWorkspace("read", (ws) => handleGetPrdStatus(ws.store)));

  server.tool(
    "get_next_task",
    "Get the next actionable task based on priority and dependencies, with explanation of why it was selected. Use when the user asks what to work on next.",
    {
      tags: z.array(z.string()).optional().describe("Only return tasks that have at least one of these tags. Omit to return any task regardless of tags."),
    },
    withWorkspace("read", (ws, args) => handleGetNextTask(ws.store, args, ws.claims)),
  );

  server.tool(
    "update_task_status",
    "Update the status of a PRD item. Use when starting work (in_progress), finishing (completed), or encountering blockers.",
    {
      id: z.string().describe("Item ID"),
      status: z.enum(["pending", "in_progress", "completed", "failing", "deferred", "blocked", "cancelled", "deleted"]).describe("New status"),
      force: z.boolean().optional().describe("Force the transition even if it violates transition rules (e.g. completed → pending)"),
      reason: z.string().optional().describe("Failure reason (used when status is 'failing')"),
      resolutionType: z.enum(["code-change", "config-override", "acknowledgment", "deferred", "unclassified"]).optional().describe("How the task was resolved (required when status is 'completed')"),
      resolutionDetail: z.string().optional().describe("Brief description of how the resolution was achieved"),
    },
    withWorkspace("write", (ws, args) => handleUpdateTaskStatus(ws.store, ws.projectDir, args, ws.claims)),
  );

  // Claims are how two worktrees of one repository avoid picking the same
  // task. `get_next_task` skips what is claimed elsewhere and
  // `update_task_status` claims on `in_progress`; these two make the hold
  // explicit for the gap between selecting a task and starting it.
  server.tool(
    "claim_task",
    "Claim a task for this worktree so other worktrees' agents skip it. Use right after selecting a task, before planning or editing. Claims are released by update_task_status when the task reaches a terminal status, or by release_task.",
    {
      id: z.string().describe("Task ID to claim"),
    },
    withWorkspace("write", (ws, args) => handleClaimTask(ws.store, args, ws.claims)),
  );

  server.tool(
    "release_task",
    "Release this worktree's claim on a task without changing its status. Use when abandoning a task you claimed but did not finish.",
    {
      id: z.string().describe("Task ID to release"),
    },
    withWorkspace("write", (ws, args) => handleReleaseTask(args, ws.claims)),
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
      run: RunSettingsSchema.optional().describe("Saved run settings for this item. Vendor-agnostic. Keys (all optional, unknown keys rejected): tier (light|standard|heavy), models ({claude?,codex?,google?,local?: model id} exact per-vendor pins), provider, permissionMode, review, reviewTier, reviewModels (same shape as models), reviewOptional, skipTestGate, maxTurns, tokenBudget, contextNotes."),
    },
    withWorkspace("write", (ws, args) => handleAddItem(ws.store, ws.projectDir, ws.rexDir, args)),
  );

  server.tool(
    "edit_item",
    "Edit content fields of a PRD item (title, description, acceptance criteria, priority, level, tags, run). Use for content changes — use update_task_status for status/lifecycle transitions.",
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
      run: RunSettingsSchema.nullable().optional().describe("Saved run settings. An object REPLACES the whole block (omitted keys are dropped); null removes it. Vendor-agnostic keys: tier (light|standard|heavy), models ({claude?,codex?,google?,local?: model id}), provider, permissionMode, review, reviewTier, reviewModels, reviewOptional, skipTestGate, maxTurns, tokenBudget, contextNotes."),
    },
    withWorkspace("write", (ws, args) => handleEditItem(ws.store, ws.projectDir, args)),
  );

  server.tool(
    "move_item",
    "Move an item to a different parent in the PRD tree (reparent). Use to reorganize items that are under the wrong epic or feature.",
    {
      id: z.string().describe("Item ID to move"),
      parentId: z.string().optional().describe("New parent ID (omit to move to root)"),
    },
    withWorkspace("write", (ws, args) => handleMoveItem(ws.store, ws.rexDir, args)),
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
    withWorkspace(
      (args) => (args.preview ? "read" : "write"),
      (ws, args) => handleMergeItems(ws.store, ws.rexDir, args),
    ),
  );

  server.tool(
    "get_item",
    "Get full details of a PRD item including parent chain. Use to understand task context before starting work.",
    {
      id: z.string().describe("Item ID"),
    },
    withWorkspace("read", (ws, args) => handleGetItem(ws.store, args)),
  );

  server.tool(
    "append_log",
    "Append a structured log entry to the execution log",
    {
      event: z.string().describe("Event name"),
      itemId: z.string().optional().describe("Related item ID"),
      detail: z.string().optional().describe("Event details"),
    },
    withWorkspace("write", (ws, args) => handleAppendLog(ws.store, args)),
  );

  server.tool(
    "sync_with_remote",
    "Sync local PRD with a remote adapter (e.g. Notion)",
    {
      direction: z.enum(["push", "pull", "sync"]).optional().describe("Sync direction (default: sync)"),
      adapter: z.string().optional().describe("Adapter name (default: notion)"),
    },
    withWorkspace("write", (ws, args) => handleSyncWithRemote(ws.store, ws.rexDir, args, resolveRemoteStore, SyncEngine)),
  );

  server.tool("get_recommendations", "Get SourceVision-based recommendations for PRD items. Use alongside get_findings for data-driven planning.", {},
    withWorkspace("read", () => handleGetRecommendations()));

  server.tool(
    "verify_criteria",
    "Map acceptance criteria to test files, and optionally run the repository's test command against them. Tests run only when runTests is true AND the repository's execution config is trusted (see `ndx trust`); the mapping is always returned.",
    {
      taskId: z.string().optional().describe("Task ID to verify (omit for all tasks)"),
      runTests: z.boolean().optional().describe("Execute the test command from .rex/config.json (default: false). Ignored, with a note in the result, while the repository is not trusted."),
    },
    withWorkspace("read", (ws, args) => handleVerifyCriteria(ws.store, ws.projectDir, args)),
  );

  server.tool(
    "reorganize",
    "Detect structural issues in the PRD and propose reorganizations (merge, move, delete, prune, collapse, split). Runs both programmatic detectors and LLM analysis by default.",
    {
      accept: z.string().optional().describe("Apply proposals: 'low-risk' (default when set), 'all', or comma-separated IDs like '1,3'"),
      includeCompleted: z.boolean().optional().describe("Include completed items in similarity analysis (default: false)"),
      mode: z.enum(["fast", "full"]).optional().describe("Analysis mode: 'fast' (programmatic only) or 'full' (programmatic + LLM, default)"),
    },
    withWorkspace(
      (args) => (args.accept ? "write" : "read"),
      (ws, args) => handleReorganize(ws.store, ws.projectDir, args),
    ),
  );

  server.tool("health", "Get structure health score with dimensional breakdown (depth, balance, granularity, completeness, staleness)", {},
    withWorkspace("read", (ws) => handleHealth(ws.store)));

  server.tool(
    "facets",
    "List configured facets with distribution, or suggest facets for an item",
    {
      itemId: z.string().optional().describe("Item ID to get facet suggestions for (omit for overview)"),
    },
    withWorkspace("read", (ws, args) => handleFacets(ws.store, args)),
  );

  server.tool(
    "get_token_usage",
    "Roll up hench run token usage and work duration across every PRD item. Returns `{ tokens, duration }` per item, where tokens is self+descendants+total counts and duration is { totalMs, runningMs, isRunning }. Completed subtrees report stable totalMs; running subtrees update on each call. Orphan runs (whose itemId is no longer in the PRD) are reported separately. Pass `id` to narrow to a single item.",
    {
      id: z.string().optional().describe("Optional: only return rollup for this item"),
    },
    withWorkspace("read", (ws, args) => handleGetTokenUsage(ws.store, ws.projectDir, args)),
  );

  server.tool("get_capabilities", "Get Rex server capabilities and configuration", {},
    withWorkspace("read", (ws) => handleGetCapabilities(ws.store, {
      projectDir: ws.projectDir,
      rexDir: ws.rexDir,
      source: ws.source,
      startupDir: ws.startupDir,
      ...(ws.refused ? { refused: ws.refused } : {}),
    })));

  // --- Resources ---

  server.resource("prd", "rex://prd", async (uri) => {
    const { store } = await binding.ready();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await store.loadDocument(), null, 2),
        },
      ],
    };
  });

  server.resource("workflow", "rex://workflow", async (uri) => {
    const { store } = await binding.ready();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: await store.loadWorkflow(),
        },
      ],
    };
  });

  server.resource("log", "rex://log", async (uri) => {
    const { store } = await binding.ready();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await store.readLog(50), null, 2),
        },
      ],
    };
  });

  return server;
}

/**
 * Start the Rex MCP server over stdio (for `rex mcp <dir>` CLI command).
 *
 * Follows the client's MCP roots when `dir` is the cwd, so a session in a
 * linked worktree is served that worktree even when its client spawned the
 * server in the main checkout (#499). For HTTP or other transports, use
 * {@link createRexMcpServer} instead.
 */
export async function startMcpServer(dir: string): Promise<void> {
  const server = await createRexMcpServer(dir, { resolveWorkspaceFromClientRoots: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
