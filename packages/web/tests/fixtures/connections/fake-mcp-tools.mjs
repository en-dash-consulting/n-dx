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
 * structured object, one JSON text), a read tool that never answers, and a
 * write that answers a validation error carrying a problems list.
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
    "stall_owners",
    { description: "Never answers.", inputSchema: {}, annotations: { readOnlyHint: true } },
    () => new Promise(() => {}),
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

const CAOS_STATUSES = [
  "backlog", "ready", "inProgress", "waitingOnOthers", "pause", "blocked",
  "readyForReview", "inReview", "pendingDelivery", "done", "canceled",
];
const CAOS_READ = { readOnlyHint: true };
const CAOS_WRITE = { readOnlyHint: false, destructiveHint: false };
const requestId = z.string().min(8).max(128);

/**
 * CAOS's work-item tools by name and input schema (its MCP contract), with
 * canned answers: the server the built-in CAOS profile is checked against.
 * `replies[tool]` answers in place of a work-item tool's canned answer when it
 * returns one (a duplicate, a validation failure). Never the real server.
 */
export function addCaosTools(server, replies = {}) {
  const answer = (tool, canned) => async (args) => replies[tool]?.(args) ?? canned(args);
  server.registerTool(
    "get_work_item",
    { description: "Get work item.", inputSchema: { workItemId: z.string() }, annotations: CAOS_READ },
    answer("get_work_item", ({ workItemId }) => ({ content: [{ type: "text", text: JSON.stringify({ id: workItemId, status: "backlog" }) }] })),
  );
  server.registerTool(
    "list_epics",
    { description: "List epics.", inputSchema: { query: z.string().optional(), cursor: z.string().optional() }, annotations: CAOS_READ },
    async () => ({
      content: [{ type: "text", text: "epics" }],
      structuredContent: { items: [{ id: "ep-1", name: "ndx 0.10.0 - Sidecar" }, { id: "ep-2", name: "ndx 1.0.0 - Freeze" }], nextCursor: null, total: 2 },
    }),
  );
  server.registerTool(
    "get_creation_options",
    { description: "Get creation options.", inputSchema: {}, annotations: CAOS_READ },
    async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          types: ["Story", "Bug", "Task"],
          priorities: ["High", "Medium", "Low"],
          estimates: ["1", "2", "3", "5", "8"],
          statuses: CAOS_STATUSES.map((status) => ({ status, label: status })),
        }),
      }],
    }),
  );
  server.registerTool(
    "create_work_item",
    {
      description: "Create work item.",
      inputSchema: {
        requestId,
        title: z.string(),
        epicId: z.string(),
        type: z.enum(["Story", "Bug", "Task"]).optional(),
        priority: z.enum(["High", "Medium", "Low"]).optional(),
        estimate: z.enum(["1", "2", "3", "5", "8"]).optional(),
        description: z.string().optional(),
        acceptanceCriteria: z.string().optional(),
        assigneeNotionUserId: z.string().optional(),
        initialStatus: z.enum(CAOS_STATUSES).optional(),
      },
      annotations: CAOS_WRITE,
    },
    answer("create_work_item", ({ title }) => ({ content: [{ type: "text", text: JSON.stringify({ id: "wi-1", title, created: true }) }] })),
  );
  server.registerTool(
    "edit_work_item",
    {
      description: "Edit work item.",
      inputSchema: { requestId, workItemId: z.string(), patch: z.object({ title: z.string().optional() }) },
      annotations: CAOS_WRITE,
    },
    answer("edit_work_item", ({ workItemId }) => ({ content: [{ type: "text", text: JSON.stringify({ id: workItemId }) }] })),
  );
  server.registerTool(
    "move_work_item",
    {
      description: "Move work item.",
      inputSchema: {
        requestId,
        workItemId: z.string(),
        toStatus: z.enum(CAOS_STATUSES),
        review: z.object({ reviewerNotionUserId: z.string(), reviewLink: z.string().optional() }).optional(),
        stalled: z.object({
          kind: z.enum(["waitingOnOthers", "pause", "blocked"]),
          blockedBy: z.string().optional(),
          whoCanUnblock: z.string().optional(),
        }).optional(),
        delivery: z.object({ note: z.string() }).optional(),
      },
      annotations: CAOS_WRITE,
    },
    answer("move_work_item", ({ workItemId, toStatus }) => ({ content: [{ type: "text", text: JSON.stringify({ id: workItemId, status: toStatus }) }] })),
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
