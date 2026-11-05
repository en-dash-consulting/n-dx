/**
 * The tools every fake connection server offers: one annotated read-only,
 * one annotated destructive, one unannotated, plus test hooks. Plain JS so
 * the stdio fake can run under node without a build step.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Tools for the call-card tests, added only when asked for so the default tool
 * list stays what the other connection tests expect: a write with a rich input
 * schema and an idempotency key, two read tools that list choices (one a
 * structured object, one JSON text), and a write that answers a validation
 * error carrying a problems list.
 */
export function addCallCardTools(server) {
  server.registerTool(
    "create_ticket",
    {
      description: "Create a ticket.",
      inputSchema: {
        title: z.string(),
        estimate: z.number().int().optional(),
        ownerId: z.string().optional(),
        teamId: z.string().optional(),
        requestId: z.string().optional(),
      },
    },
    async ({ title, ownerId, teamId, requestId }) => ({
      content: [{ type: "text", text: `created ${title} for ${ownerId ?? "nobody"} in ${teamId ?? "no team"} (${requestId ?? "no key"})` }],
    }),
  );
  server.registerTool(
    "list_owners",
    { description: "List owners.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => ({
      content: [{ type: "text", text: "owners" }],
      structuredContent: { owners: [{ id: "u-1", name: "Ada" }, { id: "u-2", name: "Grace" }] },
    }),
  );
  server.registerTool(
    "find_teams",
    { description: "Find teams.", inputSchema: {}, annotations: { readOnlyHint: true } },
    async () => ({ content: [{ type: "text", text: JSON.stringify({ data: { teams: [{ key: "t-a", title: "Alpha" }, "t-b"] } }) }] }),
  );
  server.registerTool(
    "reject_ticket",
    { description: "Always fails validation.", inputSchema: { title: z.string() } },
    async () => ({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: "validation_failed", problems: [{ field: "title", message: "too long" }, "estimate is required"] }) }],
    }),
  );
}

/** A fake MCP server; `extra` lets a fixture add its own test hooks. */
export function createFakeMcpServer(name = "fake-connection", extra) {
  const server = new McpServer({ name, version: "1.0.0" });
  extra?.(server);
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
