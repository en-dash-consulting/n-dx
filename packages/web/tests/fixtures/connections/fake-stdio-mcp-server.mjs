/**
 * A fake MCP server over stdio for the connection tests. Besides the shared
 * tools it offers `show_env` (its own environment), `exit_now` (exits mid-call,
 * as a crashed server would) and `add_tool` (registers a tool, which sends
 * notifications/tools/list_changed).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createFakeMcpServer } from "./fake-mcp-tools.mjs";

const server = createFakeMcpServer("fake-stdio");
server.registerTool("show_env", { description: "This process's environment." }, async () => ({
  content: [{ type: "text", text: JSON.stringify(process.env) }],
}));
server.registerTool("exit_now", { description: "Exit the server without answering." }, async () => {
  process.exit(1);
});
server.registerTool("add_tool", { description: "Register a tool.", inputSchema: { name: z.string() } }, async ({ name }) => {
  server.registerTool(name, { description: `Added ${name}.` }, async () => ({ content: [{ type: "text", text: name }] }));
  return { content: [{ type: "text", text: `added ${name}` }] };
});

await server.connect(new StdioServerTransport());
