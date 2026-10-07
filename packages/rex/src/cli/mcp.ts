import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "node:path";
import { TOOL_VERSION } from "./commands/constants.js";
import { openRexWorkspace, WorkspaceBinding, type RexWorkspace } from "./mcp-workspace.js";
import { REX_MCP_TOOLS } from "./mcp-tools/registry.js";
import type { Access } from "./mcp-tools/tool.js";
import type { McpResult } from "./mcp-tools/result.js";

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
    handler: (ws: RexWorkspace, ...args: T) => Promise<McpResult>,
  ): ((...args: T) => Promise<McpResult>) => {
    return async (...args: T): Promise<McpResult> => {
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

  // Registration order is the order of REX_MCP_TOOLS, which `tools/list`
  // reports and tests/unit/cli/mcp-tools-list-snapshot.test.ts pins.
  for (const tool of REX_MCP_TOOLS) {
    server.tool(tool.name, tool.description, tool.schema, withWorkspace(tool.access, tool.run));
  }

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
