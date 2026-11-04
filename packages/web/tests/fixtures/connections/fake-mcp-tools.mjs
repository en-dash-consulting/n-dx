/**
 * The tools every fake connection server offers: one annotated read-only,
 * one annotated destructive, one unannotated, plus test hooks. Plain JS so
 * the stdio fake can run under node without a build step.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** A fake MCP server; `extra` lets a fixture add its own test hooks. */
export function createFakeMcpServer(name = "fake-connection") {
  const server = new McpServer({ name, version: "1.0.0" });
  server.registerTool(
    "read_item",
    {
      description: "Read an item by id.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    // "missing" answers the server's own tool error, which a caller must pass back unchanged.
    async ({ id }) =>
      id === "missing"
        ? { content: [{ type: "text", text: "no item missing" }], isError: true }
        : { content: [{ type: "text", text: `item ${id}` }] },
  );
  server.registerTool(
    "delete_item",
    {
      description: "Delete an item by id.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => ({ content: [{ type: "text", text: `deleted ${id}` }] }),
  );
  server.registerTool(
    "update_item",
    { description: "Update an item.", inputSchema: { id: z.string(), title: z.string() } },
    async ({ id, title }) => ({ content: [{ type: "text", text: `updated ${id}: ${title}` }] }),
  );
  return server;
}
