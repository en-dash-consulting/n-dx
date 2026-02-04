import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveStore } from "../store/index.js";
import { SCHEMA_VERSION, LEVEL_HIERARCHY } from "../schema/index.js";
import { computeStats, findItem } from "../core/tree.js";
import { findNextTask, collectCompletedIds } from "../core/next-task.js";
import { TOOL_VERSION } from "./commands/constants.js";
import type { PRDItem, ItemLevel, ItemStatus, Priority } from "../schema/index.js";
import type { PRDStore } from "../store/index.js";

const REX_DIR = ".rex";

export async function startMcpServer(dir: string): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  const server = new McpServer({
    name: "rex",
    version: TOOL_VERSION,
  });

  // --- Tools ---

  server.tool("get_prd_status", "Get PRD title, overall stats, and per-epic stats", {}, async () => {
    try {
      const doc = await store.loadDocument();
      const overall = computeStats(doc.items);
      const epics = doc.items.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        stats: item.children ? computeStats(item.children) : null,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ title: doc.title, overall, epics }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error loading PRD: ${(err as Error).message}. Run "rex init" first.`,
          },
        ],
        isError: true,
      };
    }
  });

  server.tool("get_next_task", "Get the next actionable task based on priority and dependencies", {}, async () => {
    try {
      const doc = await store.loadDocument();
      const completedIds = collectCompletedIds(doc.items);
      const result = findNextTask(doc.items, completedIds);
      if (!result) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ next: null, message: "No actionable tasks remaining" }),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                item: result.item,
                parentChain: result.parents.map((p) => ({
                  id: p.id,
                  title: p.title,
                  level: p.level,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.tool(
    "update_task_status",
    "Update the status of a PRD item",
    {
      id: z.string().describe("Item ID"),
      status: z.enum(["pending", "in_progress", "completed", "deferred"]).describe("New status"),
    },
    async ({ id, status }) => {
      try {
        const existing = await store.getItem(id);
        if (!existing) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Item "${id}" not found. Use get_prd_status to see available items.`,
              },
            ],
            isError: true,
          };
        }
        await store.updateItem(id, { status: status as ItemStatus });
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "status_changed",
          itemId: id,
          detail: `${existing.status} → ${status}`,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id, title: existing.title, previousStatus: existing.status, newStatus: status }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "add_item",
    "Add a new item to the PRD",
    {
      title: z.string().describe("Item title"),
      level: z.enum(["epic", "feature", "task", "subtask"]).describe("Item level"),
      parentId: z.string().optional().describe("Parent item ID"),
      description: z.string().optional().describe("Item description"),
      priority: z.enum(["critical", "high", "medium", "low"]).optional().describe("Priority"),
      acceptanceCriteria: z.array(z.string()).optional().describe("Acceptance criteria"),
      tags: z.array(z.string()).optional().describe("Tags"),
      source: z.string().optional().describe("Source of this item"),
      blockedBy: z.array(z.string()).optional().describe("IDs of blocking items"),
    },
    async (args) => {
      try {
        const id = randomUUID();
        const item: PRDItem = {
          id,
          title: args.title,
          level: args.level as ItemLevel,
          status: "pending",
        };
        if (args.description) item.description = args.description;
        if (args.priority) item.priority = args.priority as Priority;
        if (args.acceptanceCriteria) item.acceptanceCriteria = args.acceptanceCriteria;
        if (args.tags) item.tags = args.tags;
        if (args.source) item.source = args.source;
        if (args.blockedBy) item.blockedBy = args.blockedBy;

        await store.addItem(item, args.parentId);
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "item_added",
          itemId: id,
          detail: `Added ${args.level}: ${args.title}`,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id, level: args.level, title: args.title }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_item",
    "Get full details of a PRD item including parent chain",
    {
      id: z.string().describe("Item ID"),
    },
    async ({ id }) => {
      try {
        const doc = await store.loadDocument();
        const entry = findItem(doc.items, id);
        if (!entry) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Item "${id}" not found. Use get_prd_status to see available items.`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  item: entry.item,
                  parentChain: entry.parents.map((p) => ({
                    id: p.id,
                    title: p.title,
                    level: p.level,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "append_log",
    "Append a structured log entry to the execution log",
    {
      event: z.string().describe("Event name"),
      itemId: z.string().optional().describe("Related item ID"),
      detail: z.string().optional().describe("Event details"),
    },
    async (args) => {
      try {
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: args.event,
          itemId: args.itemId,
          detail: args.detail,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ logged: true, event: args.event }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_recommendations",
    "Get SourceVision-based recommendations for PRD items (requires SourceVision)",
    {},
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              available: false,
              message: "SourceVision integration not yet configured. Use 'rex recommend' CLI command.",
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "get_capabilities",
    "Get Rex server capabilities and configuration",
    {},
    async () => {
      try {
        const config = await store.loadConfig();
        const caps = store.capabilities();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  schemaVersion: SCHEMA_VERSION,
                  toolVersion: TOOL_VERSION,
                  adapter: caps.adapter,
                  supportsTransactions: caps.supportsTransactions,
                  supportsWatch: caps.supportsWatch,
                  sourcevision: config.sourcevision ?? "disabled",
                  future: config.future ?? {},
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

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

  // --- Connect ---

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
