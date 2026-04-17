/**
 * Subprocess-backed MCP server proxy.
 *
 * After a package rebuild is detected by {@link mcp-schema-watcher.ts}, new
 * sessions use this proxy instead of the cached in-process factory. The proxy
 * spawns a fresh subprocess running the CLI's `mcp` command, connects to it
 * via the MCP stdio transport, mirrors its tool catalogue, and forwards every
 * tool call to the subprocess. Because the subprocess starts fresh for each
 * session, it always loads the latest compiled code from disk.
 *
 * Data flow for each tool call:
 *   HTTP client
 *     → StreamableHTTPServerTransport
 *     → proxy McpServer (registered by this module)
 *     → MCP Client (StdioClientTransport)
 *     → subprocess stdin/stdout
 *     → real McpServer (in subprocess)
 *
 * The `cleanup` function in the returned {@link McpServerWithLifecycle}
 * terminates the subprocess when the session is destroyed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import type { McpServerWithLifecycle } from "./routes-mcp.js";

/**
 * Spawn a subprocess MCP server and create a proxy {@link McpServer} that
 * mirrors its tools and forwards all calls to the subprocess.
 *
 * @param cliPath     Absolute path to the package CLI entry (e.g. `.../dist/cli/index.js`).
 * @param projectDir  Project directory passed as the positional arg to `<cli> mcp <dir>`.
 * @returns           A {@link McpServerWithLifecycle} whose `cleanup` terminates the subprocess.
 */
export async function createSubprocessMcpProxy(
  cliPath: string,
  projectDir: string,
): Promise<McpServerWithLifecycle> {
  const transport = new StdioClientTransport({
    command: process.execPath, // node binary that started this process
    args: [cliPath, "mcp", projectDir],
    stderr: "pipe", // keep subprocess stderr out of the server's log stream
  });

  const client = new Client(
    { name: "n-dx-hot-reload-proxy", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  const { tools } = await client.listTools();

  const server = new McpServer({ name: "hot-reload-proxy", version: "1.0.0" });

  for (const tool of tools) {
    const toolName = tool.name;
    const toolDescription = tool.description ?? "";

    // Use z.record(z.unknown()) so the handler receives all arguments that the
    // caller supplies, without stripping unknown keys. Real validation is
    // performed by the real server inside the subprocess.
    server.registerTool(
      toolName,
      {
        description: toolDescription,
        inputSchema: z.record(z.unknown()),
      },
      async (args: Record<string, unknown>) => {
        const result = await client.callTool({
          name: toolName,
          arguments: args,
        });
        // client.callTool may return either the standard { content: [...] }
        // format or the legacy { toolResult: ... } compat format.
        // Rex/sv use the standard format; normalise just in case.
        // isError is typed as `unknown` in the union — narrow to boolean | undefined.
        if ("content" in result && Array.isArray(result.content)) {
          return {
            content: result.content,
            isError: typeof result.isError === "boolean" ? result.isError : undefined,
          };
        }
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify((result as { toolResult: unknown }).toolResult),
          }],
        };
      },
    );
  }

  return {
    server,
    cleanup: async () => {
      await client.close().catch(() => {});
    },
  };
}
